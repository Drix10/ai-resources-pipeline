/**
 * Turns pipeline output into factory sources ("articles"): one idea each, with enough
 * concrete material for a 20-second reel or a 6-slide carousel.
 *
 *  - LinkedIn Insights/*.md        long-form personal posts (best material)
 *  - digest files from a batch     blog/content/<Topic>/resources-NNN.md, split per "### " item
 */
const fs = require("fs");
const path = require("path");
const { generateSeoSlug } = require("../utils/helpers");

const ROOT = path.resolve(__dirname, "../..");
const INSIGHTS = path.join(ROOT, "LinkedIn Insights");

const words = (s) => String(s || "").split(/\s+/).filter(Boolean).length;
const slugify = (s) => (typeof generateSeoSlug === "function" ? generateSeoSlug(s) : String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-")).slice(0, 60).replace(/-+$/, "");

/** Strip markdown chrome the model should not echo: images, the reference footer, sign-offs. */
function clean(md) {
  return String(md || "")
    .replace(/^---[\s\S]*?^### 🔗 Reference[\s\S]*$/m, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^\s*(Drishtant Ghosh|Follow for .*)$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function fromInsight(file) {
  const raw = fs.readFileSync(file, "utf8");
  const title = (raw.match(/^#\s+(.+)$/m) || [])[1]?.trim() || path.basename(file, ".md");
  const text = clean(raw.replace(/^#\s+.+$/m, ""));
  const base = path.basename(file, ".md");
  return { title, text, slug: slugify(base), url: `https://blogs.drix10.com`, tags: ["personal"], origin: path.relative(ROOT, file) };
}

/** Every LinkedIn Insight, newest first (the file names end in a timestamp-ish id). */
function listInsights() {
  if (!fs.existsSync(INSIGHTS)) return [];
  return fs.readdirSync(INSIGHTS)
    .filter((f) => f.endsWith(".md"))
    .map((f) => path.join(INSIGHTS, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    .map(fromInsight)
    .filter((a) => words(a.text) >= 80);
}

/**
 * Splits a digest file into one source per "### " item. `topic` is the folder name,
 * used as a tag for pattern matching; `url` is the GitHub/blog URL of the digest.
 */
function fromDigest(markdown, { topic = "", url = "", file = "" } = {}) {
  const items = [];
  let cur = null;
  let fence = false;
  for (const line of String(markdown || "").split(/\r?\n/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) fence = !fence;
    const h = !fence && line.match(/^###\s+(.+)$/);
    if (h) {
      if (cur) items.push(cur);
      cur = { title: h[1].replace(/^[^\p{L}\p{N}]+/u, "").replace(/\*\*/g, "").trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) items.push(cur);
  return items
    .map((it) => {
      const text = clean(it.lines.join("\n").replace(/🔗 Resources:[\s\S]*$/m, ""));
      const slug = slugify(`${topic}-${it.title}`);
      // One origin per item (not per folder), so novelty never blocks a whole topic folder.
      return { title: it.title, text, slug, url, tags: [topic.toLowerCase()], origin: `${file || url || topic}#${slug}` };
    })
    .filter((a) => a.title && words(a.text) >= 60);
}

/** Picks the most concrete sources: more numbers, code and length rank higher. */
function rankSources(list) {
  const score = (a) => (a.text.match(/\d/g) || []).length * 0.5 + (/```|\b(struct|function|const|def|class)\b/.test(a.text) ? 8 : 0) + Math.min(40, words(a.text) / 10);
  return [...list].sort((a, b) => score(b) - score(a));
}

module.exports = { listInsights, fromInsight, fromDigest, rankSources, clean };
