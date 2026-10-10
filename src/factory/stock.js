/**
 * Stock footage and photos for a reel. The storyboard gives every scene a visual; a scene whose
 * visual asks for "stock: <search terms>" is filled here, before the film is built, from:
 *  - Pexels (PEXELS_API_KEY, free): portrait video first, then photos. Pexels License: free for
 *    commercial use, no attribution required.
 *  - Pixabay (PIXABAY_API_KEY, free): the same, under the Pixabay Content License.
 *  - Openverse (no key): openly licensed photos, CC0 / public domain / CC BY only (share-alike,
 *    no-derivatives and non-commercial licences are never fetched). CC BY needs a credit, which
 *    goes into the Instagram caption.
 * Files land in <job>/assets/ beside the page captures as stock-<scene>.mp4|jpg, with provider,
 * page, creator and licence in assets.json. Never throws: a scene without a match is left to
 * the film agent (library clips, the captures, or its own graphics).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { secureFetch } = require("../utils/pageFetch");
const { assertCapturable, downloadImage } = require("./assets");

// Video downloads only ever come from the providers' own CDNs.
const VIDEO_HOSTS = /(^|\.)(videos\.pexels\.com|player\.vimeo\.com|vimeocdn\.com|cdn\.pixabay\.com)$/i;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 15000;
const DOWNLOAD_TIMEOUT_MS = 120000;
const DEADLINE_MS = 5 * 60 * 1000;
const MAX_QUERIES = 8;

const PEXELS_LICENSE = "Pexels License (free to use, no attribution required)";
const PIXABAY_LICENSE = "Pixabay Content License (free to use, no attribution required)";

/** "stock: rainy city street at night" -> "rainy city street at night"; anything else -> "". */
const queryOf = (use) => {
  const m = String(use || "").match(/^\s*stock\s*:\s*(.+)$/i);
  const q = m ? m[1].replace(/[^\p{L}\p{N}\s'-]/gu, " ").replace(/\s+/g, " ").trim() : "";
  return q.length >= 2 && q.length <= 60 ? q : "";
};

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The file that fills a 1080x1920 frame best: portrait at about 1920 tall, else the sharpest landscape. */
function bestFile(files) {
  const mp4 = (files || []).filter((f) => f && f.link && f.width && f.height && /mp4/i.test(f.file_type || "video/mp4"));
  const score = (f) => (f.height > f.width ? 4000 : 0) + Math.min(f.height, 1920) - (Math.max(f.width, f.height) > 2560 ? 1500 : 0);
  return mp4.sort((a, b) => score(b) - score(a))[0] || null;
}

const okClip = (c) => c && c.src && (c.type !== "video" || (c.duration >= 3 && c.duration <= 90));

const SEARCHERS = {
  async pexelsVideo(q, key) {
    const found = [];
    for (const orientation of ["portrait", ""]) {
      const j = await getJson(`https://api.pexels.com/videos/search?query=${encodeURIComponent(q)}&per_page=12${orientation ? `&orientation=${orientation}` : ""}`, { Authorization: key });
      for (const v of j.videos || []) {
        const f = bestFile(v.video_files);
        if (f) found.push({ provider: "pexels", type: "video", src: f.link, width: f.width, height: f.height, duration: v.duration, page: v.url || "", creator: v.user?.name || "", license: PEXELS_LICENSE, credit: null });
      }
      if (found.length) break;
    }
    return found;
  },
  async pixabayVideo(q, key) {
    const j = await getJson(`https://pixabay.com/api/videos/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&per_page=12&safesearch=true`);
    return (j.hits || []).map((h) => {
      const f = ["large", "medium"].map((k) => h.videos?.[k]).find((x) => x && x.url && x.width);
      return f && { provider: "pixabay", type: "video", src: f.url, width: f.width, height: f.height, duration: h.duration, page: h.pageURL || "", creator: h.user || "", license: PIXABAY_LICENSE, credit: null };
    }).filter(Boolean);
  },
  async pexelsPhoto(q, key) {
    const j = await getJson(`https://api.pexels.com/v1/search?query=${encodeURIComponent(q)}&orientation=portrait&per_page=12`, { Authorization: key });
    return (j.photos || []).map((p) => ({ provider: "pexels", type: "photo", src: p.src?.large2x || p.src?.original, width: p.width, height: p.height, page: p.url || "", creator: p.photographer || "", license: PEXELS_LICENSE, credit: null }));
  },
  async pixabayPhoto(q, key) {
    const j = await getJson(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(q)}&image_type=photo&per_page=12&safesearch=true`);
    return (j.hits || []).map((h) => ({ provider: "pixabay", type: "photo", src: h.largeImageURL, width: h.imageWidth, height: h.imageHeight, page: h.pageURL || "", creator: h.user || "", license: PIXABAY_LICENSE, credit: null }));
  },
  async openversePhoto(q) {
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&license=cc0,pdm,by&mature=false&page_size=12`);
    return (j.results || []).filter((r) => r.url && (r.width || 0) >= 900).map((r) => {
      const lic = String(r.license || "").toLowerCase();
      const license = lic === "by" ? `CC BY ${r.license_version || ""}`.trim() : lic === "cc0" ? "CC0" : "Public domain";
      const credit = lic === "by" ? `"${String(r.title || "Photo").slice(0, 60)}" by ${String(r.creator || "unknown").slice(0, 40)}, ${license}` : null;
      return { provider: "openverse", type: "photo", src: r.url, width: r.width, height: r.height, page: r.foreign_landing_url || "", creator: r.creator || "", license, credit };
    });
  },
};

/** The searchers this machine can use, video first: a moving shot beats a still. */
function searchers() {
  const s = config.factory.stock || {};
  const out = [];
  if (s.pexelsKey) out.push(["pexels video", (q) => SEARCHERS.pexelsVideo(q, s.pexelsKey)]);
  if (s.pixabayKey) out.push(["pixabay video", (q) => SEARCHERS.pixabayVideo(q, s.pixabayKey)]);
  if (s.pexelsKey) out.push(["pexels photo", (q) => SEARCHERS.pexelsPhoto(q, s.pexelsKey)]);
  if (s.pixabayKey) out.push(["pixabay photo", (q) => SEARCHERS.pixabayPhoto(q, s.pixabayKey)]);
  if (s.openverse !== false) out.push(["openverse photo", (q) => SEARCHERS.openversePhoto(q)]);
  return out;
}

/** A video from a provider CDN: every hop checked, size capped, and it must be an MP4/MOV container. */
async function downloadVideo(url, file) {
  let res;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertCapturable(url);
    if (!VIDEO_HOSTS.test(u.hostname.replace(/\.+$/, ""))) throw new Error(`${u.hostname} is not a stock video CDN`);
    res = await secureFetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    const next = res.status >= 300 && res.status < 400 && res.headers.get("location");
    if (!next) break;
    url = new URL(next, url).toString();
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") || 0) > MAX_VIDEO_BYTES) throw new Error("video over 80 MB");
  const reader = res.body?.getReader?.();
  if (!reader) throw new Error("no body");
  const tmp = `${file}.part`;
  const fd = fs.openSync(tmp, "w");
  let total = 0;
  let head = Buffer.alloc(0);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_VIDEO_BYTES) { await reader.cancel().catch(() => {}); throw new Error("video over 80 MB"); }
      if (head.length < 12) head = Buffer.concat([head, Buffer.from(value.subarray(0, 12))]);
      fs.writeSync(fd, value);
    }
  } finally {
    fs.closeSync(fd);
  }
  if (head.subarray(4, 8).toString("latin1") !== "ftyp") {
    fs.rmSync(tmp, { force: true });
    throw new Error("not an MP4 file");
  }
  fs.renameSync(tmp, file);
}

function probeMedia(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file], { encoding: "utf8", timeout: 20000 });
  try {
    const j = JSON.parse(out.stdout || "{}");
    const s = (j.streams || [])[0] || {};
    return { width: s.width || 0, height: s.height || 0, seconds: Number(j.format?.duration) || 0 };
  } catch {
    return { width: 0, height: 0, seconds: 0 };
  }
}

/**
 * Fetches the stock visual every scene asked for. Returns the assets list with the new ones
 * appended (and saves it as assets.json, so a same-day retry does not fetch again).
 */
async function fetchStock(storyboard, outDir, assets = []) {
  const wanted = (storyboard.scenes || [])
    .map((scene, i) => ({ scene: i + 1, q: queryOf(scene && scene.visual && scene.visual.use) }))
    .filter((w) => w.q)
    .slice(0, MAX_QUERIES);
  if (!wanted.length) return assets;
  const list = searchers();
  if (!list.length) {
    logger.warn("Factory stock: no provider configured (PEXELS_API_KEY / PIXABAY_API_KEY, or Openverse on); scenes that asked for stock get none.");
    return assets;
  }
  const dir = path.join(outDir, "assets");
  fs.mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + DEADLINE_MS;
  const used = new Set(assets.map((a) => a.url));
  const got = [];
  for (const w of wanted) {
    const id = `stock-${w.scene}`;
    if (assets.some((a) => a.id === id)) continue;
    if (Date.now() > deadline) { logger.warn("Factory stock: time is up; the remaining scenes get no stock."); break; }
    let candidates = [];
    for (const [name, search] of list) {
      try {
        candidates = (await search(w.q)).filter(okClip).filter((c) => !used.has(c.src));
      } catch (e) {
        logger.info(`Factory stock: ${name} search for "${w.q}" failed (${e.message}).`);
        candidates = [];
      }
      if (candidates.length) break;
    }
    let done = false;
    for (const c of candidates.slice(0, 3)) {
      const file = path.join(dir, `${id}.${c.type === "video" ? "mp4" : "jpg"}`);
      try {
        if (c.type === "video") await downloadVideo(c.src, file);
        else await downloadImage(c.src, file);
        const meta = probeMedia(file);
        if (!meta.width || !meta.height) throw new Error("unreadable file");
        used.add(c.src);
        got.push({
          id, kind: c.type === "video" ? "stock-video" : "stock-photo", scene: w.scene, query: w.q,
          url: c.src, page: c.page, title: `${c.provider} ${c.type} for "${w.q}"`, provider: c.provider,
          creator: c.creator, license: c.license, credit: c.credit, file,
          width: meta.width, height: meta.height, ...(c.type === "video" ? { seconds: Number(meta.seconds.toFixed(2)) } : {}),
        });
        done = true;
        break;
      } catch (e) {
        fs.rmSync(file, { force: true });
        logger.info(`Factory stock: ${c.provider} ${c.type} for "${w.q}" skipped (${e.message}).`);
      }
    }
    if (!done) logger.info(`Factory stock: nothing usable for scene ${w.scene} ("${w.q}").`);
  }
  const all = [...assets, ...got];
  if (got.length) {
    try { fs.writeFileSync(path.join(dir, "assets.json"), JSON.stringify(all, null, 2)); } catch { /* cache only */ }
  }
  const tally = got.map((g) => `${g.provider} ${g.kind.replace("stock-", "")}`).join(", ");
  logger.info(`Factory stock: ${got.length} of ${wanted.length} scene visual(s) found${tally ? ` (${tally})` : ""}.`);
  return all;
}

/** Credits the licences require (CC BY), for the Instagram caption. */
const creditsOf = (assets) => [...new Set((assets || []).map((a) => a && a.credit).filter(Boolean))];

module.exports = { fetchStock, creditsOf, queryOf, bestFile, SEARCHERS };
