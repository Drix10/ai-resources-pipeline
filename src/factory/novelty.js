/**
 * Keeps every piece new: a fresh topic and a look that has not been used recently.
 *
 *  - Topic: TF-IDF cosine over title (x4) + body against the recent pieces and the rest of the pool.
 *    Cosine >= 0.28 means the same topic (tuned on LinkedIn Insights: real duplicates such as the
 *    three struct-padding or the two webhook-HMAC posts score 0.29-0.63, unrelated posts <= 0.26).
 *  - Look: every agent film records out/look.json (visual idea, palette, type, technique, engine);
 *    the last FACTORY_NOVELTY_WINDOW looks are handed to the next agent as "do not repeat".
 */
const config = require("../../config");
const queue = require("./queue");

const SAME_TOPIC = 0.28;
const STOP = new Set(
  ("with your that this from into when what why how the and for are becomes using code codes engineer engineers engineering " +
    "developer developers about just like more most only they their there these those which would could should every because " +
    "where while after before being make makes learned hard real work time first then than also over have does doesn don isn " +
    "it's that's here what's will been were you're them other some such many much very").split(" "),
);

const tokens = (t) => (String(t || "").toLowerCase().match(/[a-z][a-z0-9+#-]{2,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 7));

/** Text that identifies a piece's topic; stored on queue items so recents can be compared later. */
const topicText = (a) => `${a.title || ""}\n${String(a.text || a.topicText || "").slice(0, 3000)}`;

function termFreq(item) {
  const [title, ...rest] = topicText(item).split("\n");
  const m = new Map();
  for (const w of tokens(title)) m.set(w, (m.get(w) || 0) + 4);
  for (const w of tokens(rest.join("\n"))) m.set(w, (m.get(w) || 0) + 1);
  return m;
}

/** Builds a similarity function over a corpus (IDF from all items given). */
function similarity(corpus) {
  const tfs = new Map(corpus.map((a) => [a, termFreq(a)]));
  const df = new Map();
  for (const m of tfs.values()) for (const k of m.keys()) df.set(k, (df.get(k) || 0) + 1);
  const n = Math.max(2, corpus.length);
  const cache = new Map();
  const vec = (a) => {
    if (cache.has(a)) return cache.get(a);
    const m = tfs.get(a) || termFreq(a);
    const v = new Map();
    let norm = 0;
    for (const [k, c] of m) {
      const w = (1 + Math.log(c)) * Math.log((n + 1) / ((df.get(k) || 0) + 1));
      v.set(k, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [k, w] of v) v.set(k, w / norm);
    cache.set(a, v);
    return v;
  };
  return (a, b) => {
    const va = vec(a);
    const vb = vec(b);
    let d = 0;
    for (const [k, w] of va) if (vb.has(k)) d += w * vb.get(k);
    return d;
  };
}

/** Recent produced pieces, newest first (any format, rendered or posted). */
function recent(n = config.factory.noveltyWindow) {
  return queue.load().items
    .filter((it) => it.status === "rendered" || it.status === "posted")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, n);
}

/**
 * IDF needs a real corpus: with only two documents every shared word scores zero.
 * The LinkedIn Insights archive is the background corpus, cached for an hour so a long-running
 * `npm start` picks up Insights added after it started.
 */
let background = null;
let backgroundAt = 0;
function backgroundCorpus() {
  if (!background || Date.now() - backgroundAt > 3600 * 1000) {
    try { background = require("./sources").listInsights(); } catch { background = background || []; }
    backgroundAt = Date.now();
  }
  return background;
}

function isFreshTopic(article, recents = recent(), sim = similarity([article, ...recents, ...backgroundCorpus()])) {
  // Another format of the same source (reel + carousel of one article) is allowed.
  return !recents.some((r) => r.origin !== article.origin && sim(article, r) >= SAME_TOPIC);
}

/**
 * Filters a quality-ranked pool to fresh topics only (vs recent pieces and vs better-ranked
 * pool items), then alternates topic tags so consecutive pieces differ.
 */
function orderForNovelty(pool, recents = recent()) {
  const sim = similarity([...pool, ...recents, ...backgroundCorpus()]);
  const kept = [];
  const formats = config.factory.formats.length ? config.factory.formats : ["reel"];
  for (const a of pool) {
    if (formats.every((f) => recents.some((r) => r.origin === a.origin && r.format === f))) continue;
    if (!isFreshTopic(a, recents, sim)) continue;
    if (kept.some((k) => sim(k, a) >= SAME_TOPIC)) continue;
    kept.push(a);
  }
  const out = [];
  const lastTag = () => (out.length ? out[out.length - 1].tags?.[0] : recents[0]?.tags?.[0]);
  while (kept.length) {
    const i = kept.findIndex((a) => a.tags?.[0] !== lastTag());
    out.push(kept.splice(i >= 0 ? i : 0, 1)[0]);
  }
  return out;
}

/** Prompt block for the agent: looks it must not reuse. */
function looksToAvoid(recents = recent()) {
  const looks = recents.filter((r) => r.look).map((r) => r.look);
  if (!looks.length) return "- (none yet: this is the first film, set a strong direction)";
  return looks
    .map((l, i) => `${i + 1}. idea: ${l.idea || "?"} | palette: ${(l.palette || []).join(", ")} | type: ${(l.fonts || []).join(" + ")} | technique: ${l.technique || "?"} | engine: ${l.engine || "?"}`)
    .join("\n");
}

/** Prompt block for the storyboard writer: hooks and structures used lately. */
function storyboardsToAvoid(recents = recent()) {
  const r = recents.filter((x) => x.hook || x.pattern).slice(0, 8);
  if (!r.length) return "";
  return r.map((x) => `- "${x.hook || x.title}"${x.pattern ? ` (structure: ${x.pattern})` : ""}`).join("\n");
}

module.exports = { recent, isFreshTopic, orderForNovelty, looksToAvoid, storyboardsToAvoid, similarity, topicText, SAME_TOPIC };
