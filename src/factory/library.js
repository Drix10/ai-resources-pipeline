/**
 * The reference library (factory/library/): storyboard patterns plus every film from the two
 * motion galleries and the reference repos. Template mode gets short "proven pattern" notes;
 * agent films get the whole catalog, the closest prompts in full and read access to all of it.
 */
const fs = require("fs");
const path = require("path");

const LIB = path.resolve(__dirname, "../../factory/library");
const VIDEOS = path.join(LIB, "videos");
// Shallow clones of every meta.json "repo" (npm run factory:library); gitignored.
const REPOS = path.join(LIB, "repos");

/** "https://github.com/o/r/tree/main/skills/x" -> clone https://github.com/o/r, look inside skills/x. */
function parseRepo(url) {
  const m = String(url || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/#?]+?)(?:\.git)?(?:\/tree\/[^/]+\/(.+?))?\/?$/);
  return m ? { clone: `https://github.com/${m[1]}/${m[2]}`, name: m[2], sub: m[3] || "" } : null;
}

function repoPath(url) {
  const r = parseRepo(url);
  const dir = r && path.join(REPOS, r.name, r.sub);
  return dir && fs.existsSync(dir) ? dir : null;
}

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
      const has = (f) => (fs.existsSync(path.join(dir, f)) ? path.join(dir, f) : null);
      const promptFile = has("prompt.md");
      return {
        slug: d.name,
        dir,
        ...meta,
        tags: (meta.tags || []).map((t) => String(t).toLowerCase()),
        prompt: promptFile ? fs.readFileSync(promptFile, "utf8") : "",
        promptFile,
        contact: has("contact.jpg"),
        video: has("video.mp4"),
        srcDir: has("src"),
        repoDir: repoPath(meta.repo),
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
function heroReferences(article, n = 3) {
  return rank(videos(), article, "reel").slice(0, n);
}

const label = (v) => `${v.title}${v.model ? ` [${v.model}${v.engine ? `, ${v.engine}` : ""}]` : ""}`;

/**
 * The whole library, one entry per film; every agent run sees all of it.
 * compact: one line each for the prompt (files live at videos/<slug>/). Full: every path, for a file.
 */
function catalog({ compact = false } = {}) {
  return videos()
    .sort((a, b) => (b.score || 0) - (a.score || 0) || a.slug.localeCompare(b.slug))
    .map((v) => {
      if (compact) {
        const has = [v.contact && "frames", v.video && "video", (v.srcDir || v.repoDir) && "code"].filter(Boolean);
        return `- ${v.slug} | ${label(v)}${has.length ? ` (${has.join(", ")})` : ""}: ${v.why || ""}`;
      }
      const files = [v.promptFile && `prompt ${v.promptFile}`, v.contact && `frames ${v.contact}`, v.video && `video ${v.video}`, v.srcDir && `code ${v.srcDir}`, v.repoDir && `repo ${v.repoDir}`].filter(Boolean);
      return `- ${label(v)}: ${v.why || ""}\n  ${files.join(" | ")}`;
    })
    .join("\n");
}

/** Clones (or fast-forwards) every repo a library entry links to into factory/library/repos/. */
function syncRepos({ run = require("child_process").spawnSync } = {}) {
  fs.mkdirSync(REPOS, { recursive: true });
  const repos = new Map(videos().map((v) => parseRepo(v.repo)).filter(Boolean).map((r) => [r.clone, r]));
  return [...repos.values()].map(({ clone: url, name }) => {
    const dir = path.join(REPOS, name);
    const opts = { encoding: "utf8", timeout: 10 * 60 * 1000 };
    const fail = (r) => ({ url, dir, ok: false, error: String(r.stderr || r.error?.message || "").trim().slice(-200) });
    const existing = fs.existsSync(path.join(dir, ".git"));
    // A shallow clone cannot fast-forward once upstream moves on: fetch the new tip and reset to it.
    const r = existing ? run("git", ["-C", dir, "fetch", "--depth", "1", "origin", "HEAD"], opts) : run("git", ["clone", "--depth", "1", url, dir], opts);
    if (existing && r.status !== 0) return fail(r);
    const co = existing ? run("git", ["-C", dir, "reset", "--hard", "FETCH_HEAD"], opts) : r;
    if (co.status !== 0 && fs.existsSync(path.join(dir, ".git"))) {
      // Fetched but the checkout failed: usually a filename Windows forbids (":" etc). Take every other file.
      const skipped = checkoutValidPaths(dir, run, existing ? "FETCH_HEAD" : "HEAD");
      if (skipped !== null) return { url, dir, ok: true, error: skipped ? `skipped ${skipped} path(s) this OS cannot store` : null };
    }
    return co.status === 0 ? { url, dir, ok: true, error: null } : fail(co);
  });
}

// Characters Windows forbids, names ending in a dot or space, and reserved device names (CON, aux.js...).
const BAD_WIN_PATH = /[<>:"|?*\\\u0000-\u001f]|[. ](\/|$)|(^|\/)(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.[^/]*)?(\/|$)/i;

/** Checks out every path this OS can store; returns how many were skipped, or null on failure. */
function checkoutValidPaths(dir, run, rev = "HEAD") {
  const opts = { encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 };
  const ls = run("git", ["-C", dir, "ls-tree", "-r", "-z", "--name-only", rev], opts);
  if (ls.status !== 0) return null;
  const all = ls.stdout.split("\0").filter(Boolean);
  const ok = process.platform === "win32" ? all.filter((p) => !BAD_WIN_PATH.test(p)) : all;
  // Point HEAD at the new tip without touching the work tree, then write only the storable files.
  if (rev !== "HEAD" && run("git", ["-C", dir, "reset", "--soft", rev], opts).status !== 0) return null;
  const co = run("git", ["-C", dir, "checkout", rev, "--pathspec-from-file=-", "--pathspec-file-nul"], { ...opts, input: ok.join("\0") });
  return co.status === 0 ? all.length - ok.length : null;
}

module.exports = { patterns, videos, patternsFor, heroReferences, catalog, syncRepos, parseRepo, BAD_WIN_PATH, LIB, REPOS };
