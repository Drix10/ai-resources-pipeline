/**
 * Footage and photos for a reel's scenes, from the open web. A scene's storyboard visual asks:
 *  - "stock: <generic search>": real-world footage or a photo of the world the story lives in.
 *    Video first: Pexels (PEXELS_API_KEY, free), Pixabay (PIXABAY_API_KEY, free), Mixkit (no key,
 *    its tag pages); then photos: Pexels, Pixabay, Wikimedia Commons, Openverse (no keys).
 *  - "photo: <a named person, company, product or place>": a real photo of that thing, from
 *    Wikimedia Commons, then Openverse (no keys).
 * Any licence is accepted (the owner's call); every licence that asks for credit gets one in the
 * Instagram caption. Files land in <job>/assets/ beside the captures as stock-<scene>.mp4|jpg,
 * with provider, page, creator and licence in assets.json. Never throws: a scene without a match
 * is left to the film agent (library clips, the captures, or its own graphics).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { downloadImage, downloadVideo } = require("./assets");

// Video downloads only ever come from the providers' own CDNs.
const VIDEO_HOSTS = /(^|\.)(videos\.pexels\.com|player\.vimeo\.com|vimeocdn\.com|cdn\.pixabay\.com|assets\.mixkit\.co)$/i;
const MAX_VIDEO_BYTES = 80 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 15000;
const DEADLINE_MS = 6 * 60 * 1000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0 Safari/537.36";
// Wikimedia asks every API client for a descriptive User-Agent.
const WIKI_UA = "ai-resources-pipeline/1.0 (https://github.com/Drix10/ai-resources-pipeline; reel factory)";
const MAX_QUERIES = 8;

const PEXELS_LICENSE = "Pexels License (free to use, no attribution required)";
const PIXABAY_LICENSE = "Pixabay Content License (free to use, no attribution required)";

const searchOf = (prefix) => (use) => {
  const m = String(use || "").match(new RegExp(`^\\s*${prefix}\\s*:\\s*(.+)$`, "i"));
  const q = m ? m[1].replace(/[^\p{L}\p{N}\s'.&-]/gu, " ").replace(/\s+/g, " ").trim() : "";
  return q.length >= 2 && q.length <= 60 ? q : "";
};
/** "stock: rainy city street at night" -> "rainy city street at night"; anything else -> "". */
const queryOf = searchOf("stock");
/** "photo: Jensen Huang" -> "Jensen Huang": a real photo of a named person, company, product or place. */
const photoQueryOf = searchOf("photo");

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

const okClip = (c) => c && c.src && (c.type !== "video" || !c.duration || (c.duration >= 3 && c.duration <= 90));
const plain = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();
const STOP = new Set(["a", "an", "the", "in", "on", "at", "of", "for", "with", "and", "to", "from", "by", "into"]);

/** Mixkit tag slugs to try, most specific first: "server racks in a data center" -> server-racks-in-a-data-center, data-center, server-racks, center. */
function mixkitSlugs(q) {
  const words = q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const nouns = words.filter((w) => !STOP.has(w));
  const out = [words.join("-"), nouns.slice(-2).join("-"), nouns.slice(0, 2).join("-"), nouns[nouns.length - 1]];
  return [...new Set(out.filter((x) => x && x.length >= 3))];
}

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
  async mixkitVideo(q) {
    for (const slug of mixkitSlugs(q)) {
      const res = await fetch(`https://mixkit.co/free-stock-video/discover/${slug}/`, { headers: { "User-Agent": BROWSER_UA }, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      if (!res.ok) continue;
      const html = await res.text();
      const found = new Map();
      for (const m of html.matchAll(/href="\/free-stock-video\/([a-z0-9-]+)-(\d+)\/"/g)) if (!found.has(m[2])) found.set(m[2], m[1]);
      if (!found.size) continue;
      // 1080p is often refused; 720p always exists.
      return [...found].slice(0, 12).map(([id, name]) => ({ provider: "mixkit", type: "video", src: `https://assets.mixkit.co/videos/${id}/${id}-1080.mp4`, fallback: `https://assets.mixkit.co/videos/${id}/${id}-720.mp4`, page: `https://mixkit.co/free-stock-video/${name}-${id}/`, creator: "", license: "Mixkit License (free)", credit: null }));
    }
    return [];
  },
  async commonsPhoto(q) {
    const j = await getJson(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(`${q} filetype:bitmap`)}&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600`, { "User-Agent": WIKI_UA });
    return Object.values(j.query?.pages || {})
      .sort((a, b) => (a.index || 0) - (b.index || 0))
      .map((p) => {
        const ii = (p.imageinfo || [])[0] || {};
        const m = ii.extmetadata || {};
        const license = plain(m.LicenseShortName?.value) || "see source";
        const artist = plain(m.Artist?.value).slice(0, 40) || "unknown";
        const free = /public domain|^pd|cc0/i.test(license);
        // A thumbnail is never larger than its original: the original's size is what counts.
        const width = Math.min(ii.width || 0, ii.thumbwidth || ii.width || 0);
        const height = Math.min(ii.height || 0, ii.thumbheight || ii.height || 0);
        return { provider: "commons", type: "photo", mime: ii.mime, src: ii.thumburl || ii.url, width, height, page: ii.descriptionurl || "", creator: artist, license, credit: free ? null : `${artist} (${license}, Wikimedia Commons)` };
      })
      .filter((c) => c.src && /image\/(jpeg|png|webp)/.test(c.mime || "") && (c.width || 0) >= 1000);
  },
  async openversePhoto(q) {
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&mature=false&page_size=12`);
    return (j.results || []).filter((r) => r.url && (r.width || 0) >= 900).map((r) => {
      const lic = String(r.license || "").toLowerCase();
      const free = lic === "cc0" || lic === "pdm";
      const license = lic === "cc0" ? "CC0" : lic === "pdm" ? "Public domain" : `CC ${lic.toUpperCase()} ${r.license_version || ""}`.trim();
      const credit = free ? null : `"${String(r.title || "Photo").slice(0, 60)}" by ${String(r.creator || "unknown").slice(0, 40)}, ${license}`;
      return { provider: "openverse", type: "photo", src: r.url, width: r.width, height: r.height, page: r.foreign_landing_url || "", creator: r.creator || "", license, credit };
    });
  },
};

/**
 * The searchers for a kind of request, in order. Stock: video first (a moving shot beats a
 * still), then photos. A named photo: the encyclopedic sources that have real people and places.
 */
function searchers(kind = "stock") {
  const s = config.factory.stock || {};
  const out = [];
  if (kind === "stock") {
    if (s.pexelsKey) out.push(["pexels video", (q) => SEARCHERS.pexelsVideo(q, s.pexelsKey)]);
    if (s.pixabayKey) out.push(["pixabay video", (q) => SEARCHERS.pixabayVideo(q, s.pixabayKey)]);
    if (s.mixkit !== false) out.push(["mixkit video", (q) => SEARCHERS.mixkitVideo(q)]);
    if (s.pexelsKey) out.push(["pexels photo", (q) => SEARCHERS.pexelsPhoto(q, s.pexelsKey)]);
    if (s.pixabayKey) out.push(["pixabay photo", (q) => SEARCHERS.pixabayPhoto(q, s.pixabayKey)]);
  }
  if (s.commons !== false) out.push(["commons photo", (q) => SEARCHERS.commonsPhoto(q)]);
  if (s.openverse !== false) out.push(["openverse photo", (q) => SEARCHERS.openversePhoto(q)]);
  return out;
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
    .map((scene, i) => {
      const use = scene && scene.visual && scene.visual.use;
      return queryOf(use) ? { scene: i + 1, q: queryOf(use), kind: "stock" } : { scene: i + 1, q: photoQueryOf(use), kind: "photo" };
    })
    .filter((w) => w.q)
    .slice(0, MAX_QUERIES);
  const dir = path.join(outDir, "assets");
  const save = (list) => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "assets.json"), JSON.stringify(list, null, 2)); } catch { /* cache only */ } };
  // Stock saved by an earlier storyboard of this job (a same-day retry) counts only when it answers
  // the same request: otherwise a scene would get a clip searched for another line, and its credit.
  const asked = new Map(wanted.map((w) => [`stock-${w.scene}`, w.q]));
  const stale = assets.filter((a) => String(a.kind || "").startsWith("stock") && asked.get(a.id) !== a.query);
  for (const a of stale) if (a.file) fs.rmSync(a.file, { force: true });
  const base = assets.filter((a) => !stale.includes(a));
  if (!wanted.length) {
    if (stale.length) save(base);
    return base;
  }
  fs.mkdirSync(dir, { recursive: true });
  const deadline = Date.now() + DEADLINE_MS;
  const used = new Set(base.map((a) => a.url));
  const got = [];
  for (const w of wanted) {
    const id = `stock-${w.scene}`;
    if (base.some((a) => a.id === id)) continue; // the same request, fetched before
    if (Date.now() > deadline) { logger.warn("Factory stock: time is up; the remaining scenes get no stock."); break; }
    let candidates = [];
    for (const [name, search] of searchers(w.kind)) {
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
        if (c.type === "video") {
          try {
            await downloadVideo(c.src, file, { hosts: VIDEO_HOSTS, maxBytes: MAX_VIDEO_BYTES });
          } catch (e) {
            if (!c.fallback) throw e;
            await downloadVideo(c.fallback, file, { hosts: VIDEO_HOSTS, maxBytes: MAX_VIDEO_BYTES });
          }
        } else await downloadImage(c.src, file);
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
  const all = [...base, ...got];
  if (got.length || stale.length) save(all);
  const tally = got.map((g) => `${g.provider} ${g.kind.replace("stock-", "")}`).join(", ");
  logger.info(`Factory stock: ${got.length} of ${wanted.length} scene visual(s) found${tally ? ` (${tally})` : ""}.`);
  return all;
}

/** Credits the licences require (CC BY), for the Instagram caption. */
const creditsOf = (assets) => [...new Set((assets || []).map((a) => a && a.credit).filter(Boolean))];

module.exports = { fetchStock, creditsOf, queryOf, photoQueryOf, mixkitSlugs, bestFile, SEARCHERS };
