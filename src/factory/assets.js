/**
 * Real material for a piece: screenshots of the pages the article links to (GitHub repos,
 * docs, the blog) and the images those pages publish (og:image). Free, and factual by
 * construction: every pixel comes from a URL that is already in the source.
 *
 * Captures run in Remotion's own headless Chrome (no new dependency), driven over the
 * DevTools protocol on a pipe (no debugging port; Chrome exits when we do).
 *
 * Network safety: Chrome sends ALL traffic (documents, subresources, iframes, workers,
 * WebSockets) through an in-process proxy that resolves every host itself and refuses
 * private/local addresses and ports other than 80/443. One choke point, so DNS rebinding,
 * names that resolve to 10.x/169.254.x, LAN names and literal IPs are all refused alike.
 *
 * Per page: a desktop viewport shot (dark scheme), a 900-wide "card" whose text reads at
 * phone size, a tall mobile shot to scroll through, and the page's og:image when it has
 * one. Written to <job>/assets/ with assets.json.
 */
const fs = require("fs");
const os = require("os");
const net = require("net");
const http = require("http");
const path = require("path");
const dns = require("dns");
const { spawn, spawnSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { isPrivateIp, secureFetch } = require("../utils/pageFetch");
const { FACTORY_DIR, ffmpeg } = require("./render");

const NAV_TIMEOUT_MS = 25000;
const CALL_TIMEOUT_MS = 30000;
const CAPTURE_DEADLINE_MS = 75000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const SHOTS = {
  desktop: { width: 1440, height: 900, dpr: 1.5, mobile: false },
  // Narrow desktop layout at 2x: the page's own text stays readable inside a 4:5 slide.
  card: { width: 900, height: 620, dpr: 2, mobile: false },
  mobile: { width: 390, height: 844, dpr: 3, mobile: true, fullMax: 2600 },
};

/** Remotion's downloaded chrome-headless-shell, or REMOTION_BROWSER (only if it exists). */
function chromeBinary() {
  const own = config.factory.browserExecutable;
  if (own) return fs.existsSync(own) ? own : null;
  const root = path.join(FACTORY_DIR, "node_modules/.remotion/chrome-headless-shell");
  if (!fs.existsSync(root)) return null;
  for (const plat of fs.readdirSync(root)) {
    const dir = path.join(root, plat);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const sub of fs.readdirSync(dir)) {
      for (const name of ["chrome-headless-shell.exe", "chrome-headless-shell"]) {
        const exe = path.join(dir, sub, name);
        if (fs.existsSync(exe)) return exe;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- egress proxy

const LOCAL_NAME = /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home\.arpa$|\.corp$)/i;
const ALLOWED_PORTS = new Set([80, 443]);

/** Resolves a host to one public address, or throws. Single-label names (LAN) are refused. */
async function resolvePublic(host) {
  const bare = String(host || "").replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
  if (!bare || LOCAL_NAME.test(bare)) throw new Error(`blocked host ${bare}`);
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new Error(`blocked address ${bare}`);
    return bare;
  }
  if (!bare.includes(".")) throw new Error(`blocked host ${bare}`);
  const records = await dns.promises.lookup(bare, { all: true });
  if (!records.length || records.some((r) => isPrivateIp(r.address))) throw new Error(`blocked address for ${bare}`);
  return records[0].address;
}

/** A URL is capturable: http(s) on 80/443 to a public host. Throws otherwise. */
async function assertCapturable(rawUrl) {
  const u = new URL(rawUrl);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`refusing ${u.protocol} URL`);
  const port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!ALLOWED_PORTS.has(port)) throw new Error(`refusing port ${port}`);
  await resolvePublic(u.hostname);
  return u;
}

/** Starts the proxy Chrome must use. Every connection is resolved and checked here. */
function startProxy() {
  const sockets = new Set();
  const track = (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); s.setTimeout(60000, () => s.destroy()); };
  const server = http.createServer((req, res) => {
    // Plain http: the request line carries the absolute URL.
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    const port = Number(u.port || 80);
    if (u.protocol !== "http:" || !ALLOWED_PORTS.has(port)) { res.writeHead(403).end(); return; }
    resolvePublic(u.hostname).then((addr) => {
      const headers = { ...req.headers, host: u.host };
      delete headers["proxy-connection"];
      delete headers["proxy-authorization"];
      const up = http.request({ host: addr, port, path: `${u.pathname}${u.search}`, method: req.method, headers }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      });
      up.setTimeout(30000, () => up.destroy());
      up.on("error", () => res.destroy());
      req.pipe(up);
    }, () => res.writeHead(403).end());
  });
  server.on("connection", track);
  server.on("connect", (req, sock, head) => {
    // https and WebSockets: CONNECT host:port, then a raw tunnel to the checked address.
    // The error handler goes first: Node removes its own before 'connect', so a reset on a refused
    // socket would otherwise be an uncaught exception that takes the whole bot down.
    sock.on("error", () => {});
    let u;
    try { u = new URL(`http://${req.url}`); } catch { sock.destroy(); return; }
    const port = Number(u.port || 443);
    if (!ALLOWED_PORTS.has(port)) { sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
    resolvePublic(u.hostname).then((addr) => {
      const up = net.connect(port, addr, () => {
        sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head && head.length) up.write(head);
        up.pipe(sock);
        sock.pipe(up);
      });
      track(up);
      up.on("error", () => sock.destroy());
      sock.on("close", () => up.destroy());
    }, () => sock.end("HTTP/1.1 403 Forbidden\r\n\r\n"));
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({
      port: server.address().port,
      close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }),
    }));
  });
}

// ---------------------------------------------------------------- CDP over a pipe

/** Launches Chrome behind the proxy. Resolves to a client whose close() always cleans up. */
async function launch() {
  const exe = chromeBinary();
  if (!exe) throw Object.assign(new Error("No headless Chrome: run npm run factory:sample once (Remotion downloads it) or set REMOTION_BROWSER."), { code: "NO_BROWSER" });
  const proxy = await startProxy();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "factory-shot-"));
  const args = [
    "--headless", "--remote-debugging-pipe", `--user-data-dir=${profile}`,
    `--proxy-server=http://127.0.0.1:${proxy.port}`, "--proxy-bypass-list=<-loopback>",
    "--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--disable-background-networking", "--dns-prefetch-disable", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--mute-audio", "--disable-extensions", "about:blank",
  ];
  let child;
  try {
    child = spawn(exe, args, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"], windowsHide: true });
  } catch (e) {
    await proxy.close();
    removeProfile(profile);
    throw e;
  }
  const out = child.stdio[3];
  const inp = child.stdio[4];
  let nextId = 1;
  let dead = null;
  const pending = new Map();
  const listeners = new Set();
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const die = (why) => {
    if (dead) return;
    dead = why;
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error(`Chrome gone: ${why}`)); }
    pending.clear();
  };
  child.on("error", (e) => die(e.message));
  child.on("exit", (code) => die(`exited (${code})`));
  out.on("error", (e) => die(e.message));
  inp.on("error", (e) => die(e.message));
  inp.on("close", () => die("pipe closed"));
  let buf = "";
  inp.setEncoding("utf8");
  inp.on("data", (chunk) => {
    buf += chunk;
    let end;
    while ((end = buf.indexOf("\0")) >= 0) {
      const raw = buf.slice(0, end);
      buf = buf.slice(end + 1);
      let msg;
      try { msg = JSON.parse(raw); } catch { continue; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, timer } = pending.get(msg.id);
        pending.delete(msg.id);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      } else if (msg.method) for (const fn of listeners) fn(msg);
    }
  });
  const send = (method, params = {}, sessionId, timeoutMs = CALL_TIMEOUT_MS) => new Promise((resolve, reject) => {
    if (dead) return reject(new Error(`Chrome gone: ${dead}`));
    const id = nextId++;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    out.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });
  let closing = null;
  const close = () => (closing ??= (async () => {
    if (!dead) await send("Browser.close", {}, undefined, 3000).catch(() => {});
    const gone = await Promise.race([exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
    if (!gone) killTree(child.pid);
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    await proxy.close();
    removeProfile(profile);
  })());
  // The pipe is up as soon as Chrome answers; a browser that never answers is torn down.
  try {
    await send("Browser.getVersion", {}, undefined, 20000);
  } catch (e) {
    await close();
    throw new Error(`headless Chrome did not start (${e.message})`);
  }
  return { send, on: (fn) => listeners.add(fn), off: (fn) => listeners.delete(fn), close, isDead: () => !!dead };
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", timeout: 10000 });
  else try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
}

/** Chrome's helper processes can hold the profile for a moment on Windows: retry, never throw. */
function removeProfile(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch (e) { logger.warn(`Factory: could not remove ${dir} (${e.code || e.message}).`); }
}

const withDeadline = (promise, ms, what) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took longer than ${Math.round(ms / 1000)}s`)), ms); })]).finally(() => clearTimeout(timer));
};

/** Opens a tab with the shot's viewport. Dialogs are dismissed so they can never block it. */
async function openTab(cdp, shot, dark) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  let sessionId;
  const onDialog = (msg) => {
    if (msg.sessionId === sessionId && msg.method === "Page.javascriptDialogOpening") cdp.send("Page.handleJavaScriptDialog", { accept: false }, sessionId).catch(() => {});
  };
  const close = async () => { cdp.off(onDialog); await cdp.send("Target.closeTarget", { targetId }, undefined, 5000).catch(() => {}); };
  try {
    ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }));
    cdp.on(onDialog);
    const s = (m, p, t) => cdp.send(m, p, sessionId, t);
    await s("Page.enable");
    await s("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: shot.dpr, mobile: shot.mobile });
    if (shot.mobile) await s("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA });
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
    return { s, sessionId, close };
  } catch (e) {
    await close();
    throw e;
  }
}

async function navigate(cdp, tab, url, shot) {
  let timer;
  let onLoad;
  const loaded = new Promise((resolve) => {
    onLoad = (msg) => { if (msg.sessionId === tab.sessionId && msg.method === "Page.loadEventFired") resolve(); };
    cdp.on(onLoad);
    timer = setTimeout(resolve, NAV_TIMEOUT_MS);
  });
  try {
    const nav = await tab.s("Page.navigate", { url }, NAV_TIMEOUT_MS);
    if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
    await loaded;
  } finally {
    clearTimeout(timer);
    cdp.off(onLoad);
  }
  // Let late layout settle; walk a tall page once so lazy images load; drop cookie overlays.
  await new Promise((r) => setTimeout(r, 1500));
  if (shot.fullMax) {
    await tab.s("Runtime.evaluate", {
      awaitPromise: true,
      expression: `(async () => { const end = Math.min(document.documentElement.scrollHeight, ${shot.fullMax}); for (let y = 0; y < end; y += 700) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } scrollTo(0, 0); await new Promise((r) => setTimeout(r, 500)); })()`,
    }, 20000).catch(() => {});
  }
  await tab.s("Runtime.evaluate", {
    expression: `for (const el of document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[aria-label*=cookie i]')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.position === 'sticky') el.remove(); }`,
  }).catch(() => {});
  const info = await tab.s("Runtime.evaluate", {
    returnByValue: true,
    expression: `({ title: document.title, url: location.href, og: (document.querySelector('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]') || {}).content || '', height: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight) })`,
  });
  return info.result.value || {};
}

/** Writes the JPEG and returns its pixel size (known from the viewport, no probe needed). */
async function screenshot(tab, shot, pageHeight, file) {
  const fullHeight = shot.fullMax && pageHeight > shot.height ? Math.min(pageHeight, shot.fullMax) : 0;
  const params = { format: "jpeg", quality: 88 };
  if (fullHeight) Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: shot.width, height: fullHeight, scale: 1 } });
  const { data } = await tab.s("Page.captureScreenshot", params, 45000);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return { width: Math.round(shot.width * shot.dpr), height: Math.round((fullHeight || shot.height) * shot.dpr) };
}

/** One capture with an overall deadline; the tab is always closed. */
async function capture(cdp, url, kind, file, dark = true) {
  const shot = SHOTS[kind] || SHOTS.desktop;
  const run = async () => {
    const tab = await openTab(cdp, shot, dark);
    try {
      const info = await navigate(cdp, tab, url, shot);
      const size = await screenshot(tab, shot, info.height || 0, file);
      return { ...info, ...size };
    } finally {
      await tab.close();
    }
  };
  return withDeadline(run(), CAPTURE_DEADLINE_MS, `capture of ${url}`);
}

/**
 * The source X post, rendered by X's public embed page (no login needed) and cut out along the
 * card, corners transparent, so a film can lay the real post over anything.
 */
async function capturePost(cdp, post, file) {
  const shot = { width: 550, height: 900, dpr: 3, mobile: false };
  const run = async () => {
    const tab = await openTab(cdp, shot, true);
    try {
      await navigate(cdp, tab, `https://platform.twitter.com/embed/Tweet.html?id=${post.id}&theme=dark&dnt=true`, shot);
      const { result } = await tab.s("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => { const el = document.querySelector('article') || (document.body && document.body.firstElementChild); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`,
      });
      const box = result && result.value;
      if (!box || box.width < 200 || box.height < 80) throw new Error("the post did not render (deleted or protected?)");
      await tab.s("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
      const { data } = await tab.s("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...box, scale: 1 } }, 45000);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      return { width: Math.round(box.width * shot.dpr), height: Math.round(box.height * shot.dpr) };
    } finally {
      await tab.close();
    }
  };
  return withDeadline(run(), CAPTURE_DEADLINE_MS, `capture of post ${post.id}`);
}

// ---------------------------------------------------------------- og:image

const IMAGE_MAGIC = [
  { demux: "png_pipe", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { demux: "jpeg_pipe", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { demux: "gif", test: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  { demux: "webp_pipe", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];

async function readCapped(res) {
  const declared = Number(res.headers.get("content-length") || 0);
  if (declared > MAX_IMAGE_BYTES) throw new Error(`image is ${declared} bytes`);
  const reader = res.body?.getReader?.();
  if (!reader) throw new Error("no body");
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_IMAGE_BYTES) { await reader.cancel().catch(() => {}); throw new Error("image over 8 MB"); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/** og:image: every hop checked (scheme, port, public address), size capped, format pinned by magic bytes. */
async function downloadImage(url, file) {
  let res;
  for (let hop = 0; hop < 4; hop++) {
    await assertCapturable(url);
    res = await secureFetch(url, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(20000) });
    const next = res.status >= 300 && res.status < 400 && res.headers.get("location");
    if (!next) break;
    url = new URL(next, url).toString();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await readCapped(res);
  if (buf.length < 2000) throw new Error(`image is only ${buf.length} bytes`);
  const kind = IMAGE_MAGIC.find((m) => m.test(buf));
  if (!kind) throw new Error("not a PNG/JPEG/GIF/WebP image");
  const tmp = `${file}.src`;
  try {
    fs.writeFileSync(tmp, buf);
    // The demuxer is pinned and only local files may be opened, so the bytes can never steer ffmpeg elsewhere.
    ffmpeg(["-protocol_whitelist", "file", "-f", kind.demux, "-i", tmp, "-frames:v", "1", "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", file], { timeoutMs: 30000 });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const probe = (file) => {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 15000 });
  const [width, height] = String(out.stdout || "").trim().split(",").map(Number);
  return { width: width || 0, height: height || 0 };
};

// ---------------------------------------------------------------- public API

/** Screenshots one URL to a file (the agent's shot tool). Always cleans up Chrome. */
async function shootOne(url, file, { kind = "desktop", dark = true } = {}) {
  await assertCapturable(url);
  const cdp = await launch();
  try {
    return await capture(cdp, url, kind, file, dark);
  } finally {
    await cdp.close();
  }
}

function readManifest(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(list) && list.length && list.every((a) => a && fs.existsSync(a.file)) ? list : null;
  } catch {
    return null;
  }
}

/**
 * Captures the article's links into <outDir>/assets/. Returns the manifest (also written to
 * assets.json). Never throws: a piece without real material still gets made.
 */
async function gatherAssets(article, outDir, { maxPages = config.factory.assetPages } = {}) {
  const dir = path.join(outDir, "assets");
  const manifestFile = path.join(dir, "assets.json");
  const cached = readManifest(manifestFile);
  if (cached) return cached;
  const links = maxPages > 0 ? (article.links || []).slice(0, maxPages) : [];
  const post = article.post && /^\d{5,25}$/.test(String(article.post.id)) ? article.post : null;
  const media = Array.isArray(article.media) ? article.media.slice(0, 4) : [];
  const assets = [];
  if (!links.length && !post && !media.length) return assets;
  fs.mkdirSync(dir, { recursive: true });
  let cdp = null;
  try {
    // The post the story came from, then its own photos: the most direct real material there is.
    if (post) {
      const file = path.join(dir, "post.png");
      try {
        cdp = await launch();
        const size = await capturePost(cdp, post, file);
        assets.push({ id: "post", kind: "post", url: post.url, title: `@${post.user} on X (the post this story comes from)`, file, ...size });
      } catch (e) {
        logger.warn(`Factory: capture of the source post ${post.url} failed (${e.message}).`);
        if (cdp) { await cdp.close(); cdp = null; }
      }
    }
    for (const [i, src] of media.entries()) {
      const file = path.join(dir, `post-photo${i + 1}.jpg`);
      try {
        await downloadImage(src, file);
        const size = probe(file);
        if (size.width && size.height) assets.push({ id: `post-photo${i + 1}`, kind: "photo", url: src, page: post ? post.url : "", title: "a photo attached to the source post", file, ...size });
      } catch (e) {
        logger.info(`Factory: photo ${src} from the source post skipped (${e.message}).`);
      }
    }
    for (const [i, url] of links.entries()) {
      const n = i + 1;
      try {
        await assertCapturable(url);
      } catch (e) {
        logger.warn(`Factory: skipping ${url} (${e.message}).`);
        continue;
      }
      let title = "";
      let og = "";
      for (const kind of ["desktop", "card", "mobile"]) {
        const file = path.join(dir, `page${n}-${kind}.jpg`);
        try {
          if (!cdp || cdp.isDead()) cdp = await launch();
          const info = await capture(cdp, url, kind, file);
          title = title || String(info.title || "").trim();
          og = og || info.og || "";
          assets.push({ id: `page${n}-${kind}`, kind, url: info.url || url, title, file, width: info.width, height: info.height });
        } catch (e) {
          logger.warn(`Factory: ${kind} shot of ${url} failed (${e.message}).`);
          // A stuck page can leave the browser wedged: start fresh for the next capture.
          if (cdp) { await cdp.close(); cdp = null; }
        }
      }
      if (og) {
        const file = path.join(dir, `page${n}-image.jpg`);
        try {
          const src = new URL(og, url).toString();
          await downloadImage(src, file);
          const size = probe(file);
          if (size.width && size.height) assets.push({ id: `page${n}-image`, kind: "image", url: src, page: url, title, file, ...size });
        } catch (e) {
          logger.info(`Factory: og:image of ${url} skipped (${e.message}).`);
        }
      }
    }
  } catch (e) {
    logger.warn(`Factory: screenshots for ${article.slug} stopped (${e.message}).`);
  } finally {
    if (cdp) await cdp.close();
  }
  // Only a non-empty result is cached: a run that captured nothing tries again next time.
  if (assets.length) fs.writeFileSync(manifestFile, JSON.stringify(assets, null, 2));
  logger.info(`Factory: ${assets.length} real assets for ${article.slug} from ${links.length} page(s)${post ? " and the source post" : ""}.`);
  return assets;
}

/** Hosts the agent's shot tool may capture: the article's own links, plus GitHub. */
const allowedHosts = (article) => [...new Set([...(article.links || []).map((l) => new URL(l).hostname.replace(/\.+$/, "").toLowerCase()), "github.com"])];

module.exports = { gatherAssets, shootOne, allowedHosts, assertCapturable, resolvePublic, startProxy, chromeBinary, downloadImage, SHOTS };
