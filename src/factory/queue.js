/**
 * The factory's ledger (factory/state/queue.json, git-ignored): what was produced, what is
 * waiting to be posted, what was posted when. It is the dedupe memory (a source is never
 * made twice in the same format) and the source of the Instagram daily cap and spacing.
 *
 * Item status:
 *   rendered -> sharing -> posted          the normal path
 *   sharing  -> unconfirmed                Share was clicked but Instagram never confirmed:
 *                                          it may be live, so it is NEVER retried automatically
 *                                          and it counts toward the cap and spacing
 *   rendered -> publish_failed             publishing failed MAX_PUBLISH_ATTEMPTS times
 *   failed                                 production failed (retried once, then left)
 * Review a rendered item by opening its dir (reel.mp4 / slide-*.jpg, contact.jpg, caption.txt).
 */
const fs = require("fs");
const path = require("path");

// FACTORY_STATE_DIR lets tests (and a second checkout) use their own ledger, lock and caches:
// never the live ones a running `npm start` depends on.
const STATE_DIR = path.resolve(process.env.FACTORY_STATE_DIR || path.join(__dirname, "../../factory/state"));
const FILE = path.join(STATE_DIR, "queue.json");
const MAX_PUBLISH_ATTEMPTS = 3;
// Statuses that mean "this may be on Instagram": counted for the cap, never posted again.
const LIVE = new Set(["posted", "sharing", "unconfirmed"]);

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Retries the brief EBUSY/EPERM locks antivirus and indexers put on a just-written file (Windows). */
function retry(fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return fn();
    } catch (e) {
      if (!["EBUSY", "EPERM", "EACCES"].includes(e.code) || attempt >= 6) throw e;
      sleepSync(150 * attempt);
    }
  }
}

/**
 * A missing ledger is empty. Anything else (a locked or corrupt file) must never read as empty:
 * that would re-make every source and bypass the posting cap. A corrupt file is kept aside.
 */
function load() {
  let raw;
  try {
    raw = retry(() => fs.readFileSync(FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { items: [] };
    throw e;
  }
  try {
    const state = JSON.parse(raw);
    if (!state || !Array.isArray(state.items)) throw new Error("no items array");
    return state;
  } catch (e) {
    const aside = `${FILE}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(FILE, aside); } catch { /* best effort */ }
    throw new Error(`Factory ledger ${FILE} is unreadable (${e.message}); a copy is at ${aside}. Fix or remove it to continue.`);
  }
}

function save(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  // A unique temp name per writer, so two processes never rename each other's file.
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  try {
    retry(() => fs.renameSync(tmp, FILE));
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// Keys use "/" whatever the OS wrote into the origin, so a Windows ledger still dedupes elsewhere.
const slash = (s) => String(s || "").replace(/\\/g, "/");
const key = (origin, slug, format) => `${format}:${slash(origin)}:${slug}`;
/** The item for a key, matching ledgers written before keys were normalised. */
const find = (items, k) => items.find((it) => slash(it.key) === slash(k));
/** The ledger entry for a source in a format, or null. */
const entryFor = (article, format) => find(load().items, key(article.origin, article.slug, format)) || null;

function has(article, format) {
  // A source that failed twice is not retried automatically (use the CLI to force it).
  const it = entryFor(article, format);
  return !!it && (it.status !== "failed" || (it.attempts || 1) >= 2);
}

/** Adds or replaces an item. Something that may already be on Instagram is never replaced. */
function add(item) {
  const state = load();
  const prev = find(state.items, item.key);
  if (prev && LIVE.has(prev.status)) throw Object.assign(new Error(`"${item.key}" is already ${prev.status} on Instagram; not replacing it.`), { code: "ALREADY_POSTED" });
  state.items = state.items.filter((it) => slash(it.key) !== slash(item.key));
  const attempts = item.status === "failed" ? ((prev && prev.status === "failed" && prev.attempts) || 0) + 1 : undefined;
  state.items.push({ ...item, ...(attempts ? { attempts } : {}), createdAt: new Date().toISOString() });
  save(state);
  return item;
}

function update(k, patch) {
  const state = load();
  const it = find(state.items, k);
  if (it) Object.assign(it, patch, { updatedAt: new Date().toISOString() });
  save(state);
  return it;
}

/** Records a failed publish; after MAX_PUBLISH_ATTEMPTS the item stops blocking the queue. */
function publishFailed(k, error) {
  const state = load();
  const it = find(state.items, k);
  if (!it) return null;
  it.publishAttempts = (it.publishAttempts || 0) + 1;
  it.lastError = String(error).slice(0, 500);
  it.lastErrorAt = new Date().toISOString();
  if (it.publishAttempts >= MAX_PUBLISH_ATTEMPTS) it.status = "publish_failed";
  it.updatedAt = it.lastErrorAt;
  save(state);
  return it;
}

/**
 * Next item to post: rendered, with its files still on disk, fewest failed attempts first,
 * then oldest. One broken item can never hold the queue.
 */
function nextToPost(format = null) {
  return load().items
    .filter((it) => it.status === "rendered" && (!format || it.format === format))
    .filter((it) => Array.isArray(it.upload) && it.upload.length && it.upload.every((f) => fs.existsSync(f)))
    .sort((a, b) => (a.publishAttempts || 0) - (b.publishAttempts || 0) || Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] || null;
}

/** Everything that may be live, by the time Share was clicked (or posted). */
function postedSince(ms) {
  const since = Date.now() - ms;
  return load().items.filter((it) => LIVE.has(it.status) && Date.parse(it.postedAt || it.shareClickedAt) >= since);
}

function heroesSince(ms) {
  const since = Date.now() - ms;
  // Agent REELS only: in hybrid mode agent carousels must not use up the weekly film budget.
  return load().items.filter((it) => it.mode === "agent" && it.format !== "carousel" && it.status !== "failed" && Date.parse(it.createdAt) >= since);
}

module.exports = { load, add, update, has, key, entryFor, nextToPost, postedSince, heroesSince, publishFailed, STATE_DIR, LIVE, MAX_PUBLISH_ATTEMPTS };
