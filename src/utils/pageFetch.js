/**
 * pageFetch.js
 *
 * Fetches the page a post links to and reduces it to readable text, so an article
 * can be written from the real announcement instead of a 40-word tweet. Free (plain
 * HTTP), safe (public hosts only, size/time limits) and best-effort: every failure
 * returns null and the caller falls back to the post alone.
 */

const dns = require("dns");
const dnsPromises = dns.promises;
const http = require("http");
const https = require("https");
const net = require("net");
const { Readable } = require("stream");
const cheerio = require("cheerio");

const MAX_BYTES = 1500000;
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const MIN_TEXT_CHARS = 400;
const MAX_TEXT_CHARS = 6000;
const USER_AGENT = "Mozilla/5.0 (compatible; ai-resources-bot/1.0; +https://blogs.drix10.com)";

// Hosts that never yield article text (login walls, video, social shells).
const SKIP_HOST_RE = /(^|\.)(x\.com|twitter\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|tiktok\.com|linkedin\.com|lnkd\.in|discord\.com|discord\.gg|open\.spotify\.com|twitch\.tv|t\.me|reddit\.com|pbs\.twimg\.com)$/i;
// Interstitials and walls that look like pages but carry no content.
const WALL_RE = /(enable javascript|javascript is (?:disabled|required)|verify you are (?:a )?human|are you a robot|just a moment|access denied|sign in to (?:continue|view|read)|log in to (?:continue|view|read)|subscribe to (?:continue|read)|403 forbidden|404 not found|page not found|captcha)/i;
// github.com/<first>/<second> is a repo only when <first> is a user or org, not one of GitHub's own sections.
const GITHUB_RESERVED = new Set(["features", "orgs", "topics", "collections", "sponsors", "marketplace", "settings", "pricing", "enterprise", "about", "login", "join", "explore", "notifications", "organizations", "users", "apps", "search", "security", "customer-stories", "readme", "resources", "solutions", "trending"]);
const TEXT_TYPES = /^(text\/html|application\/xhtml\+xml|text\/plain|text\/markdown)\b/i;

// Eight 16-bit groups of an IPv6 address (handles "::" and an embedded dotted IPv4 tail).
function ipv6Groups(ip) {
  let text = ip.toLowerCase().split("%")[0];
  const tail = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) {
    const o = tail[1].split(".").map(Number);
    text = text.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [head, rest] = text.split("::");
  const h = head ? head.split(":") : [];
  const t = rest !== undefined && rest !== "" ? rest.split(":") : [];
  const fill = rest === undefined ? [] : Array(Math.max(0, 8 - h.length - t.length)).fill("0");
  const groups = [...h, ...fill, ...t].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateV4(a, b, c) {
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split(".").map(Number);
    return isPrivateV4(a, b, c);
  }
  if (net.isIPv6(ip)) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    const v4 = (hi, lo) => isPrivateV4(hi >> 8, hi & 255, lo >> 8);
    if (g.slice(0, 6).every((x) => x === 0)) return true; // ::, ::1 and the deprecated IPv4-compatible block
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return v4(g[6], g[7]); // IPv4-mapped
    if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return true; // IPv4-translated (::ffff:0:0/96)
    if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64: reaches whatever the embedded IPv4 is
    if (g[0] === 0x2002) return true; // 6to4
    if (g[0] === 0x2001 && (g[1] === 0 || g[1] === 0xdb8)) return true; // Teredo, documentation
    if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard prefix
    // Unique-local, link-local, deprecated site-local (fec0::/10), multicast.
    return (g[0] & 0xfe00) === 0xfc00 || (g[0] & 0xffc0) === 0xfe80 || (g[0] & 0xffc0) === 0xfec0 || (g[0] & 0xff00) === 0xff00;
  }
  return true;
}

// Runs start() and settles with it, or rejects as soon as the signal aborts (never starts when already aborted).
function abortable(start, signal) {
  if (!signal) return start();
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    start().then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

// Rejects loopback, private, link-local and metadata addresses, including hostnames
// that resolve to them, so a post can never point the fetcher at internal services.
async function assertPublicHost(hostname, signal) {
  const host = hostname.replace(/^\[|\]$/g, "");
  const bare = host.toLowerCase().replace(/\.+$/, ""); // "localhost." is localhost
  if (!bare || bare === "localhost" || bare.endsWith(".localhost") || bare.endsWith(".local") || bare.endsWith(".internal")) {
    throw new Error("blocked host");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("blocked address");
    return;
  }
  // dns.lookup takes no signal, so a stalled resolver is raced against the fetch budget.
  const records = await abortable(() => dnsPromises.lookup(host, { all: true }), signal);
  if (records.length === 0 || records.some((r) => isPrivateIp(r.address))) throw new Error("blocked address");
}

// The address checked here is the address connected to: validating a name and then letting
// fetch() resolve it again would let a DNS answer change in between (rebinding).
function pinnedLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) return callback(new Error("blocked address"));
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

// A fetch()-shaped GET over http(s) with the pinned lookup. No redirects are followed here;
// getText() does that itself so every hop is validated.
function secureFetch(url, { headers = {}, signal } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    // Node skips the lookup hook for literal IPs, so pinnedLookup alone would let 127.0.0.1 through.
    const literal = target.hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(literal) && isPrivateIp(literal)) return reject(new Error("blocked address"));
    const transport = target.protocol === "https:" ? https : http;
    const req = transport.request(target, { method: "GET", headers, lookup: pinnedLookup, signal }, (res) => {
      const out = new Headers();
      for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) out.append(k, Array.isArray(v) ? v.join(", ") : v);
      const status = res.statusCode || 0;
      const empty = status < 200 || status === 204 || status === 205 || status === 304 || (status >= 300 && status < 400);
      // A redirect body is never read: close the socket instead of draining a body that may never end.
      if (empty) res.destroy();
      resolve(new Response(empty ? null : Readable.toWeb(res), { status, headers: out }));
    });
    req.on("error", reject);
    req.end();
  });
}

// The page's declared charset: the Content-Type header, else a <meta> in the first bytes.
function detectCharset(type, bytes) {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return "utf-8";
  const header = (String(type).match(/charset\s*=\s*["']?([\w.:-]+)/i) || [])[1];
  if (header) return header;
  const head = bytes.subarray(0, 4096).toString("latin1");
  const meta = (head.match(/<meta[^>]+charset\s*=\s*["']?\s*([\w.:-]+)/i) || [])[1] || "utf-8";
  return /^utf-?16/i.test(meta) ? "utf-8" : meta; // a page that could declare it in ASCII is not UTF-16

}

function decodeBody(bytes, type) {
  try {
    return new TextDecoder(detectCharset(type, bytes), { fatal: false }).decode(bytes);
  } catch (e) {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes); // unknown label
  }
}

// Releases a response body that will not be read, so its socket closes now.
async function discard(response) {
  try { await response.body?.cancel(); } catch (e) { /* already closed */ }
}

async function readCapped(response, type = "") {
  const reader = response.body?.getReader?.();
  if (!reader) return decodeBody(Buffer.from(await response.arrayBuffer()).subarray(0, MAX_BYTES), type);
  const chunks = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  try { await reader.cancel(); } catch (e) { /* already closed */ }
  return decodeBody(Buffer.concat(chunks.map((c) => Buffer.from(c))).subarray(0, MAX_BYTES), type);
}

// Follows redirects by hand so every hop is checked against the host rules.
async function getText(startUrl, { fetchImpl = secureFetch, signal } = {}) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error("unsupported protocol");
    if (hop > 0 && SKIP_HOST_RE.test(u.hostname)) throw new Error("skipped host");
    if (u.port && u.port !== "80" && u.port !== "443") throw new Error("blocked port"); // no probing of internal services
    await assertPublicHost(u.hostname, signal);
    const res = await fetchImpl(url, {
      redirect: "manual",
      signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1", "Accept-Language": "en" },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await discard(res);
      url = new URL(res.headers.get("location"), url).toString();
      continue;
    }
    const type = res.headers.get("content-type") || "";
    const length = Number(res.headers.get("content-length"));
    const problem = !res.ok ? `HTTP ${res.status}` : !TEXT_TYPES.test(type) ? `unsupported content type ${type}` : length > MAX_BYTES * 4 ? "page too large" : "";
    if (problem) {
      await discard(res); // an unread body would keep its socket open past the budget
      throw new Error(problem);
    }
    return { finalUrl: url, type, body: await readCapped(res, type) };
  }
  throw new Error("too many redirects");
}

const decodeEntities = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

function extractHtml(html) {
  const $ = cheerio.load(html);
  const meta = (name) => ($(`meta[property="${name}"]`).attr("content") || $(`meta[name="${name}"]`).attr("content") || "").replace(/\s+/g, " ").trim();
  const title = (meta("og:title") || $("title").first().text() || $("h1").first().text()).replace(/\s+/g, " ").trim();
  const description = meta("og:description") || meta("description");

  $("script, style, noscript, svg, iframe, form, nav, header, footer, aside, button, select, template, [role=navigation], [role=banner], [aria-hidden=true], [hidden]").remove();
  // Junk-by-class removal must never take the article with it (a body or wrapper can
  // carry a class like "comments-open"), so skip containers that hold the page heading.
  $("[class*=cookie], [id*=cookie], [class*=consent], [id*=consent], [class*=newsletter], [class*=subscribe], [class*=sidebar], [class*=comment]").each((_, el) => {
    if (/^(html|body|main|article)$/i.test(el.tagName) || $(el).find("h1, article, main").length) return;
    $(el).remove();
  });

  // The real content is the largest article/main block, not the first teaser <article>.
  let root = $("body");
  let best = 0;
  $("article, main, [role=main]").each((_, el) => {
    const len = $(el).text().replace(/\s+/g, " ").length;
    if (len > best) { best = len; root = $(el); }
  });
  if (best < 300) root = $("body");
  const lines = [];
  const seen = new Set();
  root.find("h1, h2, h3, h4, p, li, pre, blockquote, td, dd").each((_, el) => {
    const isHeading = /^h\d$/i.test(el.tagName);
    const text = $(el).text().replace(/\s+/g, " ").trim();
    // Short fragments are menu/button residue; headings and list items may be short.
    if (text.length < (isHeading ? 3 : el.tagName === "li" ? 20 : 40) || seen.has(text)) return;
    seen.add(text);
    lines.push(isHeading ? `## ${text}` : text);
  });
  return { title, description, text: lines.join("\n") };
}

function extractMarkdown(markdown) {
  const text = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "") // badge: [![alt](img)](link)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")
    .split(/\r?\n/)
    .map((l) => decodeEntities(l).trim())
    .filter((l) => l.length >= 3)
    .join("\n");
  const heading = (markdown.match(/^#\s+(.+)$/m) || [])[1] || "";
  return { title: heading.replace(/[*_`]/g, "").trim(), description: "", text };
}

// Returns { url, title, text } or null when there is nothing worth reading.
async function fetchPage(rawUrl, { fetchImpl, timeoutMs = TIMEOUT_MS } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch (e) {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  // t.co and other shorteners resolve through redirects; everything else is checked up front.
  if (SKIP_HOST_RE.test(url.hostname.replace(/\.+$/, ""))) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // A bare GitHub repo URL: the README is the content, the HTML page is mostly chrome.
    const repo = url.hostname.replace(/^www\./, "") === "github.com" && url.pathname.match(/^\/([\w.-]+)\/([\w.-]+)\/?$/);
    if (repo && !GITHUB_RESERVED.has(repo[1].toLowerCase())) {
      try {
        const raw = await getText(`https://raw.githubusercontent.com/${repo[1]}/${repo[2]}/HEAD/README.md`, { fetchImpl, signal: controller.signal });
        const page = extractMarkdown(raw.body);
        const done = finish(url.toString(), { ...page, title: page.title || `${repo[1]}/${repo[2]}` });
        if (done) return done;
      } catch (e) {
        // No README at that path: fall through and read the repository page itself.
      }
    }
    const got = await getText(url.toString(), { fetchImpl, signal: controller.signal });
    if (SKIP_HOST_RE.test(new URL(got.finalUrl).hostname)) return null;
    const page = /html/i.test(got.type) ? extractHtml(got.body) : extractMarkdown(got.body);
    return finish(got.finalUrl, page);
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort(); // closes any request or body still open, whichever way we got here
  }
}

// Drops tracking parameters so a cited URL is the clean, canonical address.
function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|mc_|pk_|hsa_)/i.test(key) || /^(fbclid|gclid|dclid|msclkid|igshid|ref|ref_src|ref_url|source|s|si|cmpid|trk)$/i.test(key)) u.searchParams.delete(key);
    }
    u.hash = "";
    return u.toString().replace(/\?$/, "");
  } catch (e) {
    return raw;
  }
}

function finish(finalUrl, { title, description, text }) {
  const body = [description && !text.includes(description.slice(0, 60)) ? description : "", text].filter(Boolean).join("\n");
  if (body.length < MIN_TEXT_CHARS) return null;
  if (WALL_RE.test(body.slice(0, 700)) && body.length < 2500) return null;
  const letters = body.match(/\p{L}/gu) || [];
  const ascii = body.match(/[A-Za-z]/g) || [];
  if (letters.length > 0 && ascii.length / letters.length < 0.6) return null; // non-English page
  // "Real headline | Blog | Site" -> "Real headline"
  const headline = title.split(/\s[|·–—]\s/)[0].trim();
  return { url: cleanUrl(finalUrl), title: (headline.length >= 12 ? headline : title).slice(0, 120), text: body.slice(0, MAX_TEXT_CHARS) };
}

module.exports = { fetchPage, isPrivateIp, assertPublicHost, extractHtml, extractMarkdown, secureFetch };
