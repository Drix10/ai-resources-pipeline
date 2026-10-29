/**
 * hfDataset.js
 *
 * Publishes the resources repo (every digest of every category) as a Hugging Face dataset, weekly, to send
 * readers to the GitHub repo: one Parquet file (data/train.parquet, a row per briefing) plus a dataset card
 * (README.md) that links back. Called from cron.js at the end of a run (HF_DATASET, default on; skipped without
 * HF_TOKEN; at most one upload every 7 days, kept in data/hf-dataset.json). Nothing here is fatal to a run.
 *
 * Build: the repo's tarball from the GitHub API, read in memory (a clone of 10,000 small files is minutes of
 * disk work under a Windows virus scanner; the tarball is one 20 MB download), every resources-N.md split at
 * its "### <emoji> Title" headings into rows { id, category, digest_file, digest_number, title, text,
 * source_urls, date, github_url }. The digests carry no date line, so `date` is the creation day of the first
 * X post the briefing links (an X status id embeds its timestamp); null when it links none.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const config = require("../../config");
const { logger } = require("../utils/helpers");

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const PARQUET_PATH = "data/train.parquet";
const ROW_GROUP = 5000;

// Read per call so tests can point it at a temp dir.
const statePath = () => process.env.HF_DATASET_STATE_PATH || path.join(__dirname, "..", "..", "data", "hf-dataset.json");
const readState = () => {
  try { return JSON.parse(fs.readFileSync(statePath(), "utf8")) || {}; } catch { return {}; }
};
const writeState = (state) => {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
};

const repoUrl = () => `https://github.com/${config.github.owner}/${config.github.repo}`;

// ---- Tarball ----

const cstr = (buf, start, length) => buf.toString("utf8", start, start + length).replace(/\0[\s\S]*$/, "");

// The regular files of an (already gunzipped) tar as { path, data }. GitHub's archives are pax tars: a path past
// the 100-byte name field arrives in a preceding "x" entry as a "<len> path=<value>" record.
function* tarFiles(tar) {
  let offset = 0;
  let longPath = null;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const size = parseInt(cstr(tar, offset + 124, 12), 8) || 0;
    const type = String.fromCharCode(tar[offset + 156]);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    const prefix = cstr(tar, offset + 345, 155);
    const name = cstr(tar, offset, 100);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      longPath = /(?:^|\n)\d+ path=([^\n]*)/.exec(data.toString("utf8"))?.[1] ?? null;
      continue;
    }
    if (type === "0" || type === "\0") yield { path: longPath ?? (prefix ? `${prefix}/${name}` : name), data };
    longPath = null;
  }
}

// ---- Parsing ----

// The leading emoji of a "### 🤖 Title" heading (the README headlines in github.js strip the same).
const LEADING_EMOJI = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\p{Variation_Selector}\p{Join_Control}\p{Me}\s]+/u;
// The footers a digest ends with: not briefings.
const FOOTER_TITLES = new Set(["Support", "Read More & Connect"]);
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;
const X_STATUS_RE = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/\s]+\/status\/(\d{15,})/i;
const TWITTER_EPOCH_MS = 1288834974657n;

// The day an X status was posted ("2026-10-27"), from its id, or null when the id is not a plausible one.
const statusDate = (id) => {
  const ms = Number((BigInt(id) >> 22n) + TWITTER_EPOCH_MS);
  return ms > Date.parse("2010-11-04") && ms < Date.now() + DAY ? new Date(ms).toISOString().slice(0, 10) : null;
};

// One briefing: its text without the resource list and images, every link in it, and the date of its first X post.
const parseItem = (heading, body) => {
  const title = heading.replace(/\s+/g, " ").trim().replace(LEADING_EMOJI, "").replace(/^\*\*|\*\*$/g, "");
  if (!title || FOOTER_TITLES.has(title)) return null;
  const clean = body.replace(IMAGE_RE, "").replace(/\r/g, "");
  const resources = clean.search(/🔗\s*Resources/); // on its own line, or run into the text
  const text = (resources >= 0 ? clean.slice(0, resources) : clean)
    .replace(/(?:\n\s*-{3,})+\s*$/, "") // the "---" lines that separate it from the next briefing
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null; // a headline with nothing under it but links
  const urls = [...new Set((clean.match(URL_RE) || []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
  const post = urls.map((u) => X_STATUS_RE.exec(u)).find(Boolean);
  return { title, text, source_urls: urls, date: post ? statusDate(post[1]) : null };
};

/**
 * The rows of one digest file. `file` is "resources-007.md"; ids are a hash of category, file and position,
 * so a row keeps its id from one weekly build to the next.
 */
const parseDigest = (markdown, { category, file }) => {
  const number = Number(/^resources-(\d+)\.md$/.exec(file)?.[1]);
  const base = `${repoUrl()}/blob/main/${[category, file].map(encodeURIComponent).join("/")}`;
  const rows = [];
  // Split before each "### " heading at the start of a line; whatever comes before the first one is not a briefing.
  const chunks = String(markdown || "").split(/^(?=### )/m).filter((c) => c.startsWith("### "));
  const anchors = new Map();
  chunks.forEach((chunk, position) => {
    const nl = chunk.indexOf("\n");
    const heading = chunk.slice(4, nl < 0 ? undefined : nl);
    // GitHub's heading anchor (as headingAnchor in github.js), "-1", "-2"... on a repeat. Not a Parquet column.
    const slug = heading.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
    const seen = anchors.get(slug) || 0;
    anchors.set(slug, seen + 1);
    const item = parseItem(heading, nl < 0 ? "" : chunk.slice(nl + 1));
    if (!item) return;
    const id = crypto.createHash("sha1").update(`${category}/${file}#${position}`).digest("hex").slice(0, 16);
    rows.push({ id, category, digest_file: file, digest_number: number, ...item, github_url: base, anchor: seen ? `${slug}-${seen}` : slug });
  });
  return rows;
};

// Every row of the repo's tar: each top-level folder's resources-N.md files, folders A-Z then digests in number order.
const parseTar = (tar) => {
  const digests = [];
  for (const { path: p, data } of tarFiles(tar)) {
    const m = /^[^/]+\/([^/.][^/]*)\/(resources-(\d+)\.md)$/.exec(p);
    if (m) digests.push({ category: m[1], file: m[2], number: Number(m[3]), data });
  }
  digests.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : a.number - b.number));
  return digests.flatMap((d) => parseDigest(d.data.toString("utf8"), d));
};

// ---- Parquet and the dataset card ----

const utf8 = (name, repetition_type = "REQUIRED") => ({ name, type: "BYTE_ARRAY", converted_type: "UTF8", repetition_type });
// Explicit schema: hyparquet-writer would store source_urls as a JSON string, not a native list.
const SCHEMA = [
  { name: "root", num_children: 9 },
  utf8("id"), utf8("category"), utf8("digest_file"),
  { name: "digest_number", type: "INT32", repetition_type: "REQUIRED" },
  utf8("title"), utf8("text"),
  { name: "source_urls", repetition_type: "REQUIRED", converted_type: "LIST", num_children: 1 },
  { name: "list", repetition_type: "REPEATED", num_children: 1 },
  utf8("element"),
  utf8("date", "OPTIONAL"),
  utf8("github_url"),
];
const COLUMNS = ["id", "category", "digest_file", "digest_number", "title", "text", "source_urls", "date", "github_url"];

// The Parquet file for the rows, as an ArrayBuffer.
const writeParquet = async (rows) => {
  const { parquetWriteBuffer } = await import("hyparquet-writer"); // ESM-only
  return parquetWriteBuffer({ schema: SCHEMA, columnData: COLUMNS.map((name) => ({ name, data: rows.map((r) => r[name]) })), rowGroupSize: ROW_GROUP });
};

const sizeCategory = (n) => (n < 1000 ? "n<1K" : n < 10000 ? "1K<n<10K" : n < 100000 ? "10K<n<100K" : n < 1000000 ? "100K<n<1M" : "1M<n<10M");

const datasetCard = (rows, { now = new Date() } = {}) => {
  const categories = new Set(rows.map((r) => r.category)).size;
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  const newest = dates.length ? ` The newest dated briefing is from ${dates[dates.length - 1]}.` : "";
  const author = config.author.name || config.author.handle || config.github.owner;
  const repo = `${config.github.owner}/${config.github.repo}`;
  const blog = config.syndication?.canonicalBaseUrl;
  return `---
license: cc-by-4.0
language:
- en
pretty_name: AI Resources
size_categories:
- ${sizeCategory(rows.length)}
task_categories:
- text-generation
- summarization
- question-answering
tags:
- ai
- news
- briefings
configs:
- config_name: default
  data_files:
  - split: train
    path: ${PARQUET_PATH}
---

# AI Resources

${rows.length.toLocaleString("en-US")} short briefings on AI and technology in ${categories} categories (AI developer tools, robotics, policy, venture capital, quantum computing and more), each written from a post on X with the links it cites. The corpus is the [${repo}](${repoUrl()}) repository on GitHub, republished here every week.${newest}

## Fields

| Field | Type | What it is |
| --- | --- | --- |
| \`id\` | string | Stable id of the briefing (a hash of category, digest file and position) |
| \`category\` | string | The category folder, e.g. "AI Developer Tools" |
| \`digest_file\` | string | The digest it belongs to, e.g. \`resources-042.md\` |
| \`digest_number\` | int | The digest's number: higher is newer within a category |
| \`title\` | string | The headline, without its leading emoji |
| \`text\` | string | The briefing: a summary and its key points, as Markdown |
| \`source_urls\` | list of string | Every link the briefing cites, the X post it was written from usually first |
| \`date\` | string or null | The day of the first X post it links (YYYY-MM-DD; a briefing that quotes an older post gets that post's day); null when it links none |
| \`github_url\` | string | The digest file on GitHub |

## How it is built

A pipeline collects posts, writes each up with an LLM, checks every number and name against its source and commits the digests to [${repo}](${repoUrl()})${blog ? `, which are also published on [the blog](${blog})` : ""}. Once a week it downloads the repository, splits every digest into briefings and uploads them here. Last built ${now.toISOString().slice(0, 10)}.

## Licence and citation

CC BY 4.0: use it freely, with credit. Briefings summarize public posts; the originals belong to their authors.

\`\`\`bibtex
@misc{ai_resources,
  author = {${author}},
  title = {AI Resources: briefings on AI and technology},
  year = {${now.getUTCFullYear()}},
  url = {${repoUrl()}}
}
\`\`\`

## Star the repo

If this is useful, star [${repo}](${repoUrl()}) on GitHub: new briefings land there first and the stars help others find it.
`;
};

// ---- Download and upload ----

// The repo's default branch (or `ref`) as a gunzipped tar. No GitHub token: the repo is public (a private one is not
// published), and a weekly call is far inside the anonymous rate limit.
const downloadTar = async (ref = "") => {
  const { owner, repo } = config.github;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball${ref ? `/${ref.split("/").map(encodeURIComponent).join("/")}` : ""}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ai-resources-pipeline" },
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`GitHub tarball of ${owner}/${repo}: HTTP ${res.status}`);
  return zlib.gunzipSync(Buffer.from(await res.arrayBuffer()));
};

// Creates the dataset repo if missing, then one commit with the Parquet file and the card.
const upload = async ({ parquet, card, title }) => {
  const hub = require("@huggingface/hub");
  const repo = { type: "dataset", name: config.hfDataset.repo };
  const accessToken = config.hfDataset.token;
  if (!(await hub.repoExists({ repo, accessToken }))) await hub.createRepo({ repo, accessToken, license: "cc-by-4.0" });
  await hub.commit({
    repo, accessToken, title,
    operations: [
      { operation: "addOrUpdate", path: PARQUET_PATH, content: new Blob([parquet]) },
      { operation: "addOrUpdate", path: "README.md", content: new Blob([card]) },
    ],
  });
};

// An error message that can never carry the token.
const safeMessage = (error) => String(error?.message ?? error).split(config.hfDataset.token).join("[REDACTED]").replace(/\bhf_[A-Za-z0-9]{16,}/g, "[REDACTED]");

// Tests replace these.
const steps = { downloadTar, upload };

/**
 * The weekly publish: { skipped: why } when it is off, has no token, is not due or a stop was asked for,
 * else { uploaded: true, rows, bytes }. Throws on a failure (the caller logs it); the state is only
 * written after the upload, so a failed week is retried at the next run.
 */
const runHfDataset = async ({ shouldStop = () => false, now = Date.now() } = {}) => {
  const cfg = config.hfDataset;
  if (!cfg.enabled) return { skipped: "disabled" };
  if (!cfg.token) {
    logger.info("Hugging Face dataset: HF_TOKEN is not set, skipping the weekly upload.");
    return { skipped: "no token" };
  }
  const last = Date.parse(readState().uploadedAt || "");
  if (last && now - last < WEEK) return { skipped: "not due" };
  if (shouldStop()) return { skipped: "stopping" };

  try {
    logger.info(`Hugging Face dataset: building from ${repoUrl()}...`);
    const rows = parseTar(await steps.downloadTar());
    if (!rows.length) throw new Error("the repository holds no briefings");
    const parquet = await writeParquet(rows);
    if (shouldStop()) return { skipped: "stopping" };
    await steps.upload({ parquet, card: datasetCard(rows), title: `Weekly refresh: ${rows.length} briefings` });
    writeState({ uploadedAt: new Date(now).toISOString(), rows: rows.length, bytes: parquet.byteLength, repo: cfg.repo });
    logger.info(`Hugging Face dataset: uploaded ${rows.length} briefings (${(parquet.byteLength / 1048576).toFixed(1)} MB) to ${cfg.repo}.`);
    return { uploaded: true, rows: rows.length, bytes: parquet.byteLength };
  } catch (error) {
    // Rethrown with the token scrubbed from whatever the Hub client put in its message.
    throw new Error(safeMessage(error));
  }
};

module.exports = { runHfDataset, parseDigest, parseTar, tarFiles, datasetCard, writeParquet, _steps: steps };
