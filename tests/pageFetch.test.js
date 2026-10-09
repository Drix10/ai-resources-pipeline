const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchPage, isPrivateIp, assertPublicHost, extractHtml, extractMarkdown } = require("../src/utils/pageFetch");

const PUBLIC = "93.184.216.34"; // public IP literal: no DNS needed
const para = (n, word = "engineers") => `<p>${Array.from({ length: n }, (_, i) => `${word} ship real systems and measure the results ${i}.`).join(" ")}</p>`;
const html = (body, head = "") => `<!doctype html><html><head><title>Test Page</title>${head}</head><body>${body}</body></html>`;
const reply = (body, { status = 200, type = "text/html; charset=utf-8", headers = {} } = {}) =>
  new Response(body, { status, headers: { "content-type": type, ...headers } });
const router = (routes) => async (url) => {
  const r = routes[url];
  if (!r) return new Response("not found", { status: 404 });
  return typeof r === "function" ? r() : r;
};

test("isPrivateIp covers loopback, private, link-local, CGNAT, multicast and v6", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "100.63.0.1", "2606:4700:4700::1111"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("assertPublicHost rejects internal names and addresses, accepts public IPs", async () => {
  for (const h of ["localhost", "foo.localhost", "box.local", "svc.internal", "127.0.0.1", "[::1]", "169.254.169.254", "10.0.0.5"]) {
    await assert.rejects(assertPublicHost(h), undefined, h);
  }
  await assert.doesNotReject(assertPublicHost(PUBLIC));
});

test("extractHtml drops chrome, keeps the real article, prefers the largest article block", () => {
  const page = extractHtml(html(`
    <nav><a>Home</a><a>Pricing and plans and more menu text here to pad</a></nav>
    <article><p>Related teaser story that is just long enough to be a paragraph here.</p></article>
    <article><h1>Launch of Foo 2</h1>${para(12)}<ul><li>Latency dropped from 120 ms to 45 ms on the benchmark</li></ul></article>
    <footer><p>Copyright notice that must not appear in the extracted text at all today</p></footer>
    <script>var secret = "SCRIPTCONTENT";</script>`));
  assert.match(page.text, /Latency dropped from 120 ms to 45 ms/);
  assert.doesNotMatch(page.text, /SCRIPTCONTENT|Copyright notice|Related teaser/);
  assert.equal(page.title, "Test Page");
});

test("extractHtml keeps the article when a wrapper class contains 'comment' or 'cookie'", () => {
  const page = extractHtml(html(`<div class="comments-open cookie-ready"><article><h1>Real Story</h1>${para(10)}</article></div>`));
  assert.match(page.text, /ship real systems/);
});

test("extractHtml uses og:title and description", () => {
  const page = extractHtml(html("<main>" + para(8) + "</main>", '<meta property="og:title" content="OG Title"><meta name="description" content="Plain description">'));
  assert.equal(page.title, "OG Title");
  assert.equal(page.description, "Plain description");
});

test("extractMarkdown strips badges, images, links and html", () => {
  const page = extractMarkdown("# Cool Tool\n\n[![build](https://img/badge.svg)](https://ci)\n\n![logo](x.png)\n\nCool Tool is a [fast](https://x.dev) CLI. <b>Install</b> it with npm.\n\n---\n");
  assert.equal(page.title, "Cool Tool");
  assert.match(page.text, /Cool Tool is a fast CLI\. Install it with npm\./);
  assert.doesNotMatch(page.text, /badge|logo|<b>|https:/);
});

test("fetchPage returns readable text for a normal article", async () => {
  const url = `https://${PUBLIC}/post`;
  const page = await fetchPage(url, { fetchImpl: router({ [url]: reply(html(`<article><h1>Foo</h1>${para(20)}</article>`)) }) });
  assert.ok(page);
  assert.equal(page.url, url);
  assert.ok(page.text.length >= 400 && page.text.length <= 6000);
});

test("fetchPage truncates very long text to the cap", async () => {
  const url = `https://${PUBLIC}/long`;
  const page = await fetchPage(url, { fetchImpl: router({ [url]: reply(html(`<article>${para(400)}</article>`)) }) });
  assert.equal(page.text.length, 6000);
});

test("fetchPage follows a redirect chain and reports the final URL", async () => {
  const a = `https://${PUBLIC}/short`, b = `https://${PUBLIC}/mid`, c = `https://${PUBLIC}/final`;
  const page = await fetchPage(a, {
    fetchImpl: router({
      [a]: new Response(null, { status: 301, headers: { location: b } }),
      [b]: new Response(null, { status: 302, headers: { location: "/final" } }),
      [c]: reply(html(`<article>${para(20)}</article>`)),
    }),
  });
  assert.equal(page.url, c);
});

test("fetchPage blocks a redirect into a private address", async () => {
  const a = `https://${PUBLIC}/r`;
  for (const target of ["http://127.0.0.1/admin", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "http://localhost/x", "file:///etc/passwd"]) {
    const page = await fetchPage(a, { fetchImpl: router({ [a]: new Response(null, { status: 302, headers: { location: target } }) }) });
    assert.equal(page, null, target);
  }
});

test("fetchPage refuses a redirect that lands on a social/login host", async () => {
  const a = `https://${PUBLIC}/r`;
  const page = await fetchPage(a, { fetchImpl: router({ [a]: new Response(null, { status: 301, headers: { location: "https://x.com/someone/status/1" } }) }) });
  assert.equal(page, null);
});

test("fetchPage gives up after too many redirects (loop)", async () => {
  const a = `https://${PUBLIC}/loop`;
  const page = await fetchPage(a, { fetchImpl: router({ [a]: () => new Response(null, { status: 302, headers: { location: a } }) }) });
  assert.equal(page, null);
});

test("fetchPage returns null for non-text content, errors and empty pages", async () => {
  const u = (p) => `https://${PUBLIC}/${p}`;
  const cases = {
    pdf: reply("%PDF-1.4", { type: "application/pdf" }),
    img: reply("binary", { type: "image/png" }),
    json: reply("{}", { type: "application/json" }),
    notfound: reply("gone", { status: 404 }),
    server: reply("boom", { status: 500 }),
    tiny: reply(html("<p>Short.</p>")),
    empty: reply(""),
  };
  for (const [name, res] of Object.entries(cases)) {
    assert.equal(await fetchPage(u(name), { fetchImpl: router({ [u(name)]: res }) }), null, name);
  }
});

test("fetchPage rejects login/paywall/captcha interstitials but not articles that mention them", async () => {
  const u = (p) => `https://${PUBLIC}/${p}`;
  const wall = await fetchPage(u("wall"), { fetchImpl: router({ [u("wall")]: reply(html(`<main><p>Just a moment... Verify you are human by completing the action below to continue to the site.</p>${"<p>Enable JavaScript and cookies to continue browsing this website today.</p>".repeat(8)}</main>`)) }) });
  assert.equal(wall, null);
  const real = await fetchPage(u("real"), { fetchImpl: router({ [u("real")]: reply(html(`<article>${para(60)}<p>Some sites ask you to sign in to continue reading, which this article discusses at length.</p></article>`)) }) });
  assert.ok(real);
});

test("fetchPage rejects non-English pages", async () => {
  const u = `https://${PUBLIC}/ja`;
  const jp = "<p>" + "これは日本語のテスト文章です。エンジニアは実際のシステムを構築します。".repeat(30) + "</p>";
  assert.equal(await fetchPage(u, { fetchImpl: router({ [u]: reply(html(`<article>${jp}</article>`)) }) }), null);
});

test("fetchPage skips social hosts and bad URLs without any request", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return reply("x"); };
  for (const bad of ["https://x.com/a/status/1", "https://twitter.com/a", "https://www.youtube.com/watch?v=1", "https://youtu.be/1", "https://www.linkedin.com/posts/x", "not a url", "ftp://example.com/x", "javascript:alert(1)", ""]) {
    assert.equal(await fetchPage(bad, { fetchImpl }), null, bad);
  }
  assert.equal(called, 0);
});

test("fetchPage times out a hanging server", async () => {
  const u = `https://${PUBLIC}/slow`;
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
  const t0 = Date.now();
  assert.equal(await fetchPage(u, { fetchImpl, timeoutMs: 200 }), null);
  assert.ok(Date.now() - t0 < 3000);
});

test("fetchPage caps the bytes it reads", async () => {
  const u = `https://${PUBLIC}/huge`;
  const chunk = para(200);
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent > 8) return controller.close();
      sent++;
      controller.enqueue(new TextEncoder().encode(sent === 1 ? `<html><body><article>${chunk}` : chunk.repeat(40)));
    },
  });
  const page = await fetchPage(u, { fetchImpl: router({ [u]: new Response(stream, { status: 200, headers: { "content-type": "text/html" } }) }) });
  assert.ok(page);
  assert.ok(page.text.length <= 6000);
  assert.ok(sent < 9, "stopped reading before the end of the stream");
});

test("fetchPage reads a bare GitHub repo URL through its README", async () => {
  const requested = [];
  const readme = "# Zephon\n\nZephon is an open source data loader with elastic determinism and on-the-fly tokenization at scale. " + "It shards deterministically across workers so a resumed run sees the same samples. ".repeat(8);
  const page = await fetchPage("https://github.com/example/zephon", {
    fetchImpl: async (url) => {
      requested.push(url);
      return url.startsWith("https://raw.githubusercontent.com/example/zephon/") ? reply(readme, { type: "text/plain" }) : reply("html", { status: 500 });
    },
  });
  assert.ok(page);
  assert.equal(page.title, "Zephon");
  assert.match(requested[0], /raw\.githubusercontent\.com\/example\/zephon\/HEAD\/README\.md/);
});

test("fetchPage never throws on malformed responses", async () => {
  const u = `https://${PUBLIC}/weird`;
  for (const make of [
    () => { throw new Error("network down"); },
    () => new Response(null, { status: 301 }), // redirect without Location
    () => new Response("<html><body><article><p>" + "\u0000￿".repeat(300) + "</p></article></body></html>", { status: 200, headers: { "content-type": "text/html" } }),
  ]) {
    await assert.doesNotReject(async () => { await fetchPage(u, { fetchImpl: async () => make() }); });
  }
});

// ---- hardening round: embedded IPv4 in IPv6, extra reserved ranges, ports, pinned connection ----
const http = require("node:http");
const { secureFetch } = require("../src/utils/pageFetch");

test("isPrivateIp blocks IPv6 forms that embed a private IPv4, and reserved test ranges", () => {
  for (const ip of ["::7f00:1", "::127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3", "64:ff9b::7f00:1", "2002:7f00:1::", "2002:c0a8:101::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "ff02::1", "192.0.0.5", "192.0.2.1", "198.18.0.1", "198.19.1.1", "198.51.100.7", "203.0.113.9", "255.255.255.255", "not-an-ip"]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "2606:4700:4700::1111", "2a00:1450:4009:81f::200e", "::ffff:5db8:d822", "172.32.0.1", "100.63.255.255"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("assertPublicHost blocks every spelling of loopback", async () => {
  for (const h of ["localhost.", "LOCALHOST", "a.localhost", "[::7f00:1]", "[64:ff9b::7f00:1]", "2130706433", "0x7f.1", "0177.0.0.1", "127.1"]) {
    await assert.rejects(assertPublicHost(h), undefined, h);
  }
});

test("only ports 80 and 443 are fetched", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return reply(html(`<article>${para(30)}</article>`)); };
  assert.ok(await fetchPage(`https://${PUBLIC}:443/a`, { fetchImpl }));
  assert.equal(await fetchPage(`https://${PUBLIC}:8443/a`, { fetchImpl }), null);
  assert.equal(await fetchPage(`http://${PUBLIC}:6379/`, { fetchImpl }), null);
  assert.equal(called, 1);
});

test("the real transport never reaches a local server, even on an allowed port path", async () => {
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.end("secret"); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  try {
    assert.equal(await fetchPage(`http://127.0.0.1:${port}/`), null);
    assert.equal(await fetchPage(`http://localhost:${port}/`), null);
    await assert.rejects(secureFetch(`http://localhost:${port}/`, {}), /blocked/i, "the pinned lookup itself refuses loopback");
    assert.equal(hits, 0, "no request ever arrived");
  } finally {
    server.close();
  }
});

test("GitHub section pages are not treated as repositories, and a missing README falls back to the page", async () => {
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url.includes("raw.githubusercontent.com")) return reply("nope", { status: 404 });
    return reply(html(`<article><h1>Repo page</h1>${para(30)}</article>`));
  };
  assert.ok(await fetchPage("https://github.com/features/copilot", { fetchImpl }));
  assert.ok(requested.every((u) => u.startsWith("https://github.com/")), "reserved path goes straight to the page");
  requested.length = 0;
  const page = await fetchPage("https://github.com/someone/repo", { fetchImpl });
  assert.ok(page, "falls back to the HTML page when the README is missing");
  assert.equal(requested.length, 2);
});

// ---- review round: site-local/translated IPv6, charsets, sockets released, DNS inside the budget ----
test("isPrivateIp blocks site-local fec0::/10 and IPv4-translated ::ffff:0:0/96", () => {
  for (const ip of ["fec0::1", "feff::1", "::ffff:0:7f00:1", "::ffff:0:808:808"]) assert.equal(isPrivateIp(ip), true, ip);
  assert.equal(isPrivateIp("fe00::1"), false, "fe00:: is outside both blocks");
});

test("pages are decoded by their declared charset, falling back to UTF-8", async () => {
  const body = (head = "") => Buffer.from(`<html><head>${head}<title>Caf\xe9 \x93launch\x94 notes from the team</title></head><body><article>${para(20)}<p>The team saved 40\x80 per seat on every caf\xe9 plan in this cycle of releases.</p></article></body></html>`, "latin1");
  const u = `https://${PUBLIC}/cp`;
  const viaHeader = await fetchPage(u, { fetchImpl: async () => new Response(body(), { status: 200, headers: { "content-type": "text/html; charset=windows-1252" } }) });
  assert.match(viaHeader.text, /saved 40€ per seat on every café plan/);
  assert.equal(viaHeader.title, "Café “launch” notes from the team");
  const viaMeta = await fetchPage(u, { fetchImpl: async () => new Response(body('<meta charset="windows-1252">'), { status: 200, headers: { "content-type": "text/html" } }) });
  assert.match(viaMeta.text, /40€ per seat/);
  const utf8 = Buffer.from(`<html><body><article>${para(20)}<p>The team saved 40€ per seat on every café plan in this cycle of releases.</p></article></body></html>`, "utf8");
  for (const type of ["text/html", "text/html; charset=no-such-charset"]) {
    const page = await fetchPage(u, { fetchImpl: async () => new Response(utf8, { status: 200, headers: { "content-type": type } }) });
    assert.match(page.text, /40€ per seat on every café plan/, type);
  }
});

// A body that never ends on its own, recording whether the reader released it.
const endless = () => {
  const state = { cancelled: false };
  state.stream = new ReadableStream({
    pull(c) { c.enqueue(new TextEncoder().encode("x".repeat(1024))); return new Promise((r) => setTimeout(r, 5)); },
    cancel() { state.cancelled = true; },
  });
  return state;
};

test("unread redirect and error bodies are released, and the request is aborted when fetchPage returns", async () => {
  const a = `https://${PUBLIC}/r`, b = `https://${PUBLIC}/final`;
  const redirectBody = endless();
  let signal;
  const page = await fetchPage(a, {
    fetchImpl: async (url, opts) => {
      signal = opts.signal;
      if (url === a) return new Response(redirectBody.stream, { status: 302, headers: { location: b } });
      return reply(html(`<article>${para(20)}</article>`));
    },
  });
  assert.ok(page);
  assert.equal(redirectBody.cancelled, true, "redirect body cancelled, not drained");
  assert.equal(signal.aborted, true, "the shared signal is aborted once fetchPage is done");
  for (const [status, type] of [[500, "text/html"], [200, "application/pdf"]]) {
    const body = endless();
    assert.equal(await fetchPage(a, { fetchImpl: async () => new Response(body.stream, { status, headers: { "content-type": type } }) }), null);
    assert.equal(body.cancelled, true, `${status} ${type} body cancelled before giving up`);
  }
});

test("a stalled DNS lookup is bounded by the fetch budget", async () => {
  const dns = require("node:dns");
  const orig = dns.promises.lookup;
  let lookups = 0;
  dns.promises.lookup = () => { lookups++; return new Promise(() => {}); }; // never answers
  try {
    const t0 = Date.now();
    assert.equal(await fetchPage("https://stalled-resolver.example/post", { fetchImpl: async () => reply("x"), timeoutMs: 150 }), null);
    assert.ok(Date.now() - t0 < 2000, "returned at the budget, not when DNS gave up");
    assert.equal(lookups, 1);
    const aborted = AbortSignal.abort();
    await assert.rejects(assertPublicHost("another.example", aborted), /aborted/);
    assert.equal(lookups, 1, "no lookup is started once the budget is spent");
  } finally { dns.promises.lookup = orig; }
});
