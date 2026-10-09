/**
 * The reference library (factory/library/): storyboard patterns plus your Opus videos.
 * Template mode gets short "proven pattern" notes; hero mode gets full prompts and code paths.
 */
const fs = require("fs");
const path = require("path");

const LIB = path.resolve(__dirname, "../../factory/library");
const VIDEOS = path.join(LIB, "videos");

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return fallback; }
};

function patterns() {
  return readJson(path.join(LIB, "patterns.json"), []);
}

function videos() {
  if (!fs.existsSync(VIDEOS)) return [];
  return fs.readdirSync(VIDEOS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = path.join(VIDEOS, d.name);
      const meta = readJson(path.join(dir, "meta.json"), null);
      if (!meta) return null;
      const promptFile = path.join(dir, "prompt.md");
      return {
        slug: d.name,
        dir,
        ...meta,
        tags: (meta.tags || []).map((t) => String(t).toLowerCase()),
        prompt: fs.existsSync(promptFile) ? fs.readFileSync(promptFile, "utf8") : "",
        srcDir: fs.existsSync(path.join(dir, "src")) ? path.join(dir, "src") : null,
      };
    })
    .filter(Boolean);
}

/** Words of the article used to match tags (title weighs double). */
function articleTerms(article) {
  const words = (s) => (String(s || "").toLowerCase().match(/[a-z][a-z0-9+#-]{1,}/g) || []);
  const terms = new Map();
  for (const w of words(article.title)) terms.set(w, (terms.get(w) || 0) + 2);
  for (const w of words(article.text).slice(0, 1500)) terms.set(w, (terms.get(w) || 0) + 1);
  for (const t of article.tags || []) terms.set(String(t).toLowerCase(), (terms.get(String(t).toLowerCase()) || 0) + 3);
  return terms;
}

const scoreTags = (tags, terms) => tags.reduce((a, t) => a + Math.min(4, terms.get(t) || 0), 0);

function rank(items, article, format) {
  const terms = articleTerms(article);
  return items
    .filter((it) => !it.formats || it.formats.includes(format))
    .map((it) => ({ it, s: scoreTags(it.tags || [], terms) + (it.score || 0) * 0.5 }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.it);
}

/** Prompt block for template mode: the 2 best patterns + up to 2 library videos' "why". */
function patternsFor(article, format) {
  const ps = rank(patterns(), article, format).slice(0, 2).map((p) => `- ${p.id}: ${p.summary}\n  ${p.beats}`);
  const vs = rank(videos(), article, format).slice(0, 2).filter((v) => v.why).map((v) => `- from "${v.title}": ${v.why}`);
  return [...ps, ...vs].join("\n");
}

/** References for hero mode: closest library videos with prompts and code. */
function heroReferences(article, n = 2) {
  return rank(videos(), article, "reel").slice(0, n);
}

module.exports = { patterns, videos, patternsFor, heroReferences, LIB };
