/**
 * The factory's ledger (factory/state/queue.json, git-ignored): what was produced, what is
 * waiting to be posted, what was posted when. It is the dedupe memory (a source is never
 * made twice in the same format) and the source of the Instagram daily cap and spacing.
 *
 * Item status: rendered -> posted | failed | skipped. Review a rendered item by opening its
 * dir (reel.mp4 / slide-*.jpg, contact.jpg, storyboard.json, caption.txt).
 */
const fs = require("fs");
const path = require("path");

const STATE_DIR = path.resolve(__dirname, "../../factory/state");
const FILE = path.join(STATE_DIR, "queue.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { items: [] };
  }
}

function save(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

const key = (origin, slug, format) => `${format}:${origin}:${slug}`;

function has(article, format) {
  // A source that failed twice is not retried automatically (use the CLI to force it).
  return load().items.some((it) => it.key === key(article.origin, article.slug, format) && (it.status !== "failed" || (it.attempts || 1) >= 2));
}

function add(item) {
  const state = load();
  const prev = state.items.find((it) => it.key === item.key);
  state.items = state.items.filter((it) => it.key !== item.key);
  const attempts = item.status === "failed" ? ((prev && prev.status === "failed" && prev.attempts) || 0) + 1 : undefined;
  state.items.push({ ...item, ...(attempts ? { attempts } : {}), createdAt: new Date().toISOString() });
  save(state);
  return item;
}

function update(k, patch) {
  const state = load();
  const it = state.items.find((x) => x.key === k);
  if (it) Object.assign(it, patch, { updatedAt: new Date().toISOString() });
  save(state);
  return it;
}

/** Oldest rendered item first; the ledger decides order, not the file system. */
function nextToPost(format = null) {
  return load().items.find((it) => it.status === "rendered" && (!format || it.format === format)) || null;
}

function postedSince(ms) {
  const since = Date.now() - ms;
  return load().items.filter((it) => it.status === "posted" && Date.parse(it.postedAt) >= since);
}

function heroesSince(ms) {
  const since = Date.now() - ms;
  return load().items.filter((it) => it.mode === "agent" && it.status !== "failed" && Date.parse(it.createdAt) >= since);
}

module.exports = { load, add, update, has, key, nextToPost, postedSince, heroesSince, STATE_DIR };
