/**
 * kbTopics.js
 *
 * Topic pages and a release timeline for the resources repo, rebuilt at most once a day at the end of a run
 * (KB_TOPICS, default on; the day of the last build is kept in data/kb-topics.json). Nothing here is fatal.
 *
 * - topics/<slug>.md: the newest briefings that mention one company or theme (config/topics.js), any category.
 * - topics/README.md: the index of those pages.
 * - TIMELINE.md: model and product releases by the labs in config/topics.js, newest first, by month.
 *
 * Source: the run branch's tarball, parsed by hfDataset.js (one download, no per-file API calls). Only pages
 * whose text differs from the tarball's copy are committed, all in one commit on the run's branch, so they
 * reach main with the run's pull request. Pages carry no build date, so an unchanged corpus commits nothing.
 */

const fs = require("fs");
const path = require("path");
const config = require("../../config");
const TOPICS = require("../../config/topics");
const hf = require("./hfDataset");
const { logger } = require("../utils/helpers");

const PER_TOPIC = 100;
const TIMELINE_MAX = 200;
// A headline that says something came out.
// ("pre-launch" is not one.)
const RELEASE_RE = /(?<!-)\b(?:releases?|released|launch(?:es|ed)?|ships|shipped|introduces|introduced|open-sources?|open-sourced|unveils?|unveiled|debuts?|rolls out|now available)\b/i;
// A named thing with a version ("Opus 5.5", "Omni 2.0", "V4.1"): what came out is a model or product.
const VERSIONED_RE = /\b[A-Z][\w-]*[ -]v?\d+\.\d+\b/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const statePath = () => process.env.KB_TOPICS_STATE_PATH || path.join(__dirname, "..", "..", "data", "kb-topics.json");
const readState = () => {
  try { return JSON.parse(fs.readFileSync(statePath(), "utf8")) || {}; } catch { return {}; }
};
const writeState = (state) => {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
};

// Headline plus first paragraph: where a briefing names what it is about (the key points drift to side mentions).
const lead = (row) => `${row.title}\n${String(row.text || "").split(/\n\s*\n/)[0]}`;
const matches = (topic, text) => topic.match.test(text);

const isRelease = (row, topics = TOPICS) => RELEASE_RE.test(row.title) && (VERSIONED_RE.test(row.title) || topics.some((t) => t.lab && matches(t, row.title)));

// Dated rows newest first, then undated ones by digest number (newer within a category), one row per headline.
const newestFirst = (rows) => {
  const day = (r) => r.date || "";
  const sorted = [...rows].sort((a, b) => (day(a) < day(b) ? 1 : day(a) > day(b) ? -1 : b.digest_number - a.digest_number));
  const seen = new Set();
  return sorted.filter((r) => {
    const key = r.title.toLowerCase();
    return !seen.has(key) && seen.add(key);
  });
};

const link = (row) => `${row.github_url}${row.anchor ? `#${row.anchor}` : ""}`;
const cell = (s) => String(s).replace(/[[\]]/g, "").replace(/</g, "&lt;").replace(/\|/g, "\\|");

const topicPage = (topic, rows) => {
  const shown = rows.slice(0, PER_TOPIC);
  return [
    `# ${topic.name}`,
    "",
    `${topic.about} ${shown.length === rows.length ? `${rows.length === 1 ? "The one briefing" : `All ${rows.length} briefings`}` : `The ${shown.length} newest of ${rows.length.toLocaleString("en-US")} briefings`} that mention it, from every category, newest first.`,
    "",
    "<sub>[All topics](README.md) · [Release timeline](../TIMELINE.md) · [All categories](../README.md)</sub>",
    "",
    "| Date | Briefing | Category |",
    "| --- | --- | --- |",
    ...shown.map((r) => `| ${r.date || ""} | [${cell(r.title)}](${link(r)}) | ${cell(r.category)} |`),
    "",
  ].join("\n");
};

const indexPage = (pages) => [
  "# Topics",
  "",
  "Briefings from every category, gathered by company and theme. Each page lists the newest " + PER_TOPIC + " that mention it; the [release timeline](../TIMELINE.md) lists model and product launches by month.",
  "",
  "| Topic | Briefings | Newest |",
  "| --- | ---: | --- |",
  ...pages.map(({ topic, rows }) => `| [${topic.name}](${topic.slug}.md) | ${rows.length.toLocaleString("en-US")} | ${rows.find((r) => r.date)?.date || ""} |`),
  "",
].join("\n");

const timelinePage = (entries) => {
  const out = [
    "# AI release timeline",
    "",
    `Model and product releases by the companies in [topics](topics/README.md), newest first: the latest ${entries.length}, each linked to its briefing.`,
    "",
  ];
  let month = "";
  for (const r of entries) {
    const [y, m, d] = r.date.split("-");
    const heading = `${MONTHS[Number(m) - 1]} ${y}`;
    if (heading !== month) {
      if (month) out.push("");
      out.push(`## ${heading}`, "");
      month = heading;
    }
    out.push(`- **${MONTHS[Number(m) - 1].slice(0, 3)} ${Number(d)}** · [${cell(r.title)}](${link(r)}) <sub>${cell(r.category)}</sub>`);
  }
  return `${out.join("\n")}\n`;
};

// Every page as [{ path, content }] for the corpus.
const buildPages = (rows, topics = TOPICS) => {
  const sorted = newestFirst(rows);
  const leads = sorted.map(lead);
  const pages = topics.map((topic) => ({ topic, rows: sorted.filter((_, i) => matches(topic, leads[i])) }));
  const timeline = sorted.filter((r) => r.date && isRelease(r, topics)).slice(0, TIMELINE_MAX);
  return [
    ...pages.map(({ topic, rows: hits }) => ({ path: `topics/${topic.slug}.md`, content: topicPage(topic, hits) })),
    { path: "topics/README.md", content: indexPage(pages) },
    { path: "TIMELINE.md", content: timelinePage(timeline) },
  ];
};

// The tar's text files by repo path (without GitHub's "<owner>-<repo>-<sha>/" prefix).
const tarTexts = (tar, wanted) => {
  const out = new Map();
  for (const { path: p, data } of hf.tarFiles(tar)) {
    const rel = p.slice(p.indexOf("/") + 1);
    if (wanted.has(rel)) out.set(rel, data.toString("utf8"));
  }
  return out;
};

// Tests replace these.
const steps = {
  branch: (owner, repo) => require("./github").workBranch(owner, repo),
  downloadTar: (ref) => hf._steps.downloadTar(ref),
  commit: (owner, repo, files, message) => require("./github").commitFiles(owner, repo, files, message),
};

/**
 * The daily build: { skipped: why } when off, already built today or stopping, else { built: true, files, changed }.
 * Throws on a failure (the caller logs it); the day is only recorded after the commit, so a failure retries next run.
 */
const runKbTopics = async ({ shouldStop = () => false, now = new Date() } = {}) => {
  if (!config.kbTopics.enabled) return { skipped: "disabled" };
  const today = now.toLocaleDateString("en-CA");
  if (readState().builtOn === today) return { skipped: "not due" };
  if (shouldStop()) return { skipped: "stopping" };

  const { owner, repo } = config.github;
  const branch = await steps.branch(owner, repo);
  const tar = await steps.downloadTar(branch);
  const rows = hf.parseTar(tar);
  if (!rows.length) throw new Error("the repository holds no briefings");
  const files = buildPages(rows);
  const current = tarTexts(tar, new Set(files.map((f) => f.path)));
  const changed = files.filter((f) => current.get(f.path) !== f.content);
  if (shouldStop()) return { skipped: "stopping" };
  if (changed.length) await steps.commit(owner, repo, changed, `🗂️ Topics and timeline: ${changed.length} page(s) refreshed from ${rows.length} briefings`);
  writeState({ builtOn: today, rows: rows.length, changed: changed.length });
  logger.info(`KB topics: ${changed.length} of ${files.length} page(s) changed (${rows.length} briefings).`);
  return { built: true, files: files.length, changed: changed.length };
};

module.exports = { runKbTopics, buildPages, isRelease, newestFirst, RELEASE_RE, _steps: steps };
