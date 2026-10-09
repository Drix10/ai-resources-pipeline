/**
 * Real material for a piece: screenshots of the pages the article links to (GitHub repos,
 * docs, the blog) and the images those pages publish (og:image). Free, and factual by
 * construction: every pixel comes from a URL that is already in the source.
 *
 * Captures run in Remotion's own headless Chrome (no new dependency), driven over the
 * DevTools protocol with Node's built-in WebSocket. Navigation to private or local hosts is
 * refused at every hop (redirects included), same rules as utils/pageFetch.js.
 *
 * Per page: a desktop viewport shot (dark scheme), a tall mobile shot to scroll through, and
 * the page's og:image when it has one. Written to <job>/assets/ with assets.json.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { assertPublicHost, isPrivateIp, secureFetch } = require("../utils/pageFetch");
const { FACTORY_DIR, ffmpeg } = require("./render");

const NAV_TIMEOUT_MS = 25000;
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const SHOTS = {
  desktop: { width: 1440, height: 900, dpr: 1.5, mobile: false },
  mobile: { width: 390, height: 844, dpr: 3, mobile: true, fullMax: 2600 },
  // Narrow desktop layout at 2x: the page's own text stays readable inside a 4:5 slide.
  card: { width: 900, height: 620, dpr: 2, mobile: false },
};

/** Remotion's downloaded chrome-headless-shell, or REMOTION_BROWSER. */
function chromeBinary() {
  if (config.factory.browserExecutable) return config.factory.browserExecutable;
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

/** A host that must never be loaded, judged without DNS (literal IPs and local names). */
const obviouslyLocal = (host) => {
  const bare = host.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  return /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(bare) || (require("net").isIP(bare) !== 0 && isPrivateIp(bare));
};

// ---------------------------------------------------------------- minimal CDP client

async function launch() {
  const exe = chromeBinary();
  if (!exe) throw Object.assign(new Error("No headless Chrome: run npm run factory:sample once (Remotion downloads it) or set REMOTION_BROWSER."), { code: "NO_BROWSER" });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "factory-shot-"));
  const child = spawn(exe, ["--headless", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--mute-audio", "--disable-extensions", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("headless Chrome did not start")), 20000);
    child.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`headless Chrome exited (${code})`)); });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error("CDP connect failed")); });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const close = () => {
    try { ws.close(); } catch { /* already closed */ }
    child.kill();
    setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 1500);
  };
  return { send, on: (fn) => listeners.add(fn), off: (fn) => listeners.delete(fn), close };
}

/** Opens a tab with the shot's viewport and the request guard installed. */
async function openTab(cdp, shot, dark) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  await s("Page.enable");
  await s("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: shot.dpr, mobile: shot.mobile });
  if (shot.mobile) await s("Emulation.setUserAgentOverride", { userAgent: MOBILE_UA });
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  // Every request is checked: documents (and their redirects) with DNS, everything else by name.
  await s("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
  const guard = async (msg) => {
    if (msg.sessionId !== sessionId || msg.method !== "Fetch.requestPaused") return;
    const { requestId, request, resourceType } = msg.params;
    let ok = false;
    try {
      const u = new URL(request.url);
      if (u.protocol === "data:" || u.protocol === "blob:") ok = true;
      else if ((u.protocol === "https:" || u.protocol === "http:") && !obviouslyLocal(u.hostname)) {
        if (resourceType === "Document") await assertPublicHost(u.hostname);
        ok = true;
      }
    } catch { ok = false; }
    s(ok ? "Fetch.continueRequest" : "Fetch.failRequest", ok ? { requestId } : { requestId, errorReason: "BlockedByClient" }).catch(() => {});
  };
  cdp.on(guard);
  return { s, sessionId, close: async () => { cdp.off(guard); await cdp.send("Target.closeTarget", { targetId }).catch(() => {}); } };
}

async function navigate(cdp, tab, url) {
  const loaded = new Promise((resolve) => {
    const fn = (msg) => { if (msg.sessionId === tab.sessionId && msg.method === "Page.loadEventFired") { cdp.off(fn); resolve(); } };
    cdp.on(fn);
    setTimeout(() => { cdp.off(fn); resolve(); }, NAV_TIMEOUT_MS);
  });
  const nav = await tab.s("Page.navigate", { url });
  if (nav.errorText) throw new Error(`navigation failed: ${nav.errorText}`);
  await loaded;
  // Let late layout and lazy images settle, then hide cookie/consent overlays.
  await new Promise((r) => setTimeout(r, 1800));
  await tab.s("Runtime.evaluate", {
    expression: `for (const el of document.querySelectorAll('[id*=cookie i],[class*=cookie i],[id*=consent i],[class*=consent i],[aria-label*=cookie i]')) { const cs = getComputedStyle(el); if (cs.position === 'fixed' || cs.position === 'sticky') el.remove(); }`,
  });
  const info = await tab.s("Runtime.evaluate", {
    returnByValue: true,
    expression: `({ title: document.title, url: location.href, og: (document.querySelector('meta[property="og:image"],meta[name="og:image"],meta[name="twitter:image"]') || {}).content || '', height: Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight) })`,
  });
  return info.result.value || {};
}

async function screenshot(tab, shot, pageHeight, file) {
  const full = shot.fullMax && pageHeight > shot.height;
  const params = { format: "jpeg", quality: 88 };
  if (full) Object.assign(params, { captureBeyondViewport: true, clip: { x: 0, y: 0, width: shot.width, height: Math.min(pageHeight, shot.fullMax), scale: 1 } });
  const { data } = await tab.s("Page.captureScreenshot", params);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

/** og:image through the same pinned, public-only fetch the pipeline uses for pages. */
async function downloadImage(url, file) {
  let res;
  for (let hop = 0; hop < 4; hop++) {
    res = await secureFetch(url, { headers: { Accept: "image/*" }, signal: AbortSignal.timeout(20000) });
    const next = res.status >= 300 && res.status < 400 && res.headers.get("location");
    if (!next) break;
    url = new URL(next, url).toString(); // secureFetch pins and checks every hop's address
  }
  const type = res.headers.get("content-type") || "";
  if (!res.ok || !/^image\/(png|jpe?g|webp|gif|avif)/.test(type)) throw new Error(`not an image (${res.status} ${type})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 8 * 1024 * 1024 || buf.length < 2000) throw new Error(`image size ${buf.length}`);
  const tmp = `${file}.src`;
  fs.writeFileSync(tmp, buf);
  ffmpeg(["-i", tmp, "-vf", "scale='min(1600,iw)':-2", "-q:v", "3", file]);
  fs.rmSync(tmp, { force: true });
}

const probe = (file) => {
  const out = require("child_process").spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [width, height] = String(out.stdout || "").trim().split(",").map(Number);
  return { width: width || 0, height: height || 0 };
};

/** Screenshots one URL to a file (used by the agent's shot tool). */
async function shootOne(url, file, { kind = "desktop", dark = true } = {}) {
  const u = new URL(url);
  if (obviouslyLocal(u.hostname)) throw new Error(`refusing local host ${u.hostname}`);
  await assertPublicHost(u.hostname);
  const cdp = await launch();
  try {
    const tab = await openTab(cdp, SHOTS[kind] || SHOTS.desktop, dark);
    const info = await navigate(cdp, tab, url);
    await screenshot(tab, SHOTS[kind] || SHOTS.desktop, info.height || 0, file);
    await tab.close();
    return { ...info, ...probe(file) };
  } finally {
    cdp.close();
  }
}

/**
 * Captures the article's links into <outDir>/assets/. Returns the manifest (also written to
 * assets.json). Never throws: a piece without real material still gets made.
 */
async function gatherAssets(article, outDir, { maxPages = config.factory.assetPages } = {}) {
  const dir = path.join(outDir, "assets");
  const manifestFile = path.join(dir, "assets.json");
  if (fs.existsSync(manifestFile)) return JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const links = (article.links || []).slice(0, maxPages);
  const assets = [];
  if (!links.length || maxPages <= 0) return assets;
  fs.mkdirSync(dir, { recursive: true });
  let cdp;
  try {
    cdp = await launch();
  } catch (e) {
    logger.warn(`Factory: no screenshots for ${article.slug} (${e.message}).`);
    return assets;
  }
  try {
    for (const [i, url] of links.entries()) {
      const n = i + 1;
      let title = "";
      let og = "";
      for (const kind of ["desktop", "card", "mobile"]) {
        const file = path.join(dir, `page${n}-${kind}.jpg`);
        let tab;
        try {
          await assertPublicHost(new URL(url).hostname);
          tab = await openTab(cdp, SHOTS[kind], true);
          const info = await navigate(cdp, tab, url);
          await screenshot(tab, SHOTS[kind], info.height || 0, file);
          title = title || String(info.title || "").trim();
          og = og || info.og || "";
          assets.push({ id: `page${n}-${kind}`, kind, url: info.url || url, title, file, ...probe(file) });
        } catch (e) {
          logger.warn(`Factory: ${kind} shot of ${url} failed (${e.message}).`);
        } finally {
          if (tab) await tab.close();
        }
      }
      if (og) {
        const file = path.join(dir, `page${n}-image.jpg`);
        try {
          await downloadImage(new URL(og, url).toString(), file);
          assets.push({ id: `page${n}-image`, kind: "image", url: new URL(og, url).toString(), page: url, title, file, ...probe(file) });
        } catch (e) {
          logger.info(`Factory: og:image of ${url} skipped (${e.message}).`);
        }
      }
    }
  } finally {
    cdp.close();
  }
  fs.writeFileSync(manifestFile, JSON.stringify(assets, null, 2));
  logger.info(`Factory: ${assets.length} real assets for ${article.slug} from ${links.length} page(s).`);
  return assets;
}

/** Hosts the agent's shot tool may capture: the article's own links, plus GitHub. */
const allowedHosts = (article) => [...new Set([...(article.links || []).map((l) => new URL(l).hostname), "github.com"])];

module.exports = { gatherAssets, shootOne, allowedHosts, chromeBinary, SHOTS };
