/**
 * The editor: picks the ONE story a cycle turns into content, then researches it.
 *
 *  - freshSources(): this run's digest items plus Insights written in the last 36 h.
 *  - pickStory(): Opus reads the candidates and picks the one with the most concrete, visual,
 *    teachable story (the old digit-count ranking only orders the shortlist and is the fallback).
 *  - deepDive(): reads every page the story links to (pageFetch: public hosts only, capped) and
 *    appends it as RESEARCH, so the storyboard has more to work with. The story's own text is
 *    kept as baseText: topic dedupe and the hype-word exemption never look at the research.
 */
const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/helpers");
const { fetchPage } = require("../utils/pageFetch");
const sources = require("./sources");
const opus = require("./opus");

const FRESH_MS = 36 * 3600 * 1000;
const SHORTLIST = 12;
const RESEARCH_PAGES = 4;
const RESEARCH_CHARS = 5000; // per page

/**
 * When an Insight was written. The files end in the epoch-ms of writing ("...-1790536700285.md"),
 * which, unlike the file mtime, a git checkout or a fresh clone cannot change.
 */
function writtenAt(origin) {
  const m = String(origin || "").match(/-(\d{13})\.md$/);
  if (m) return Number(m[1]);
  try { return fs.statSync(path.resolve(__dirname, "../..", origin)).mtimeMs; } catch { return 0; }
}

const INBOX = () => path.join(require("./queue").STATE_DIR, "inbox.json");

/** The saved inbox, pruned to the last 36 h. */
function readInbox(now = Date.now()) {
  try {
    const list = JSON.parse(fs.readFileSync(INBOX(), "utf8"));
    return Array.isArray(list) ? list.filter((x) => x && x.item && now - Number(x.addedAt) < FRESH_MS) : [];
  } catch {
    return [];
  }
}

/**
 * Saves a run's committed digest items, so a factory pass that is skipped (lock held, crash,
 * Opus down) does not lose them: the next pass within 36 h still sees them.
 */
function rememberRun(items, { now = Date.now() } = {}) {
  const kept = readInbox(now);
  const seen = new Set(kept.map((x) => x.item.origin));
  for (const item of items || []) {
    if (!item?.origin || seen.has(item.origin)) continue;
    seen.add(item.origin);
    kept.push({ addedAt: now, item });
  }
  fs.mkdirSync(path.dirname(INBOX()), { recursive: true });
  const tmp = `${INBOX()}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(kept, null, 1));
  fs.renameSync(tmp, INBOX());
  return kept.length;
}

/** This run's material: digest items committed in the last 36 h (this run's and any missed) plus Insights written in that window. */
function freshSources(extraSources = [], { now = Date.now() } = {}) {
  const insights = sources.listInsights().filter((a) => {
    const age = now - writtenAt(a.origin);
    return writtenAt(a.origin) > 0 && age >= -FRESH_MS && age < FRESH_MS;
  });
  const byOrigin = new Map();
  for (const a of [...extraSources, ...readInbox(now).map((x) => x.item), ...insights]) if (a?.origin && !byOrigin.has(a.origin)) byOrigin.set(a.origin, a);
  return { fresh: [...byOrigin.values()] };
}

/** Opus picks one candidate; returns the candidates reordered with the pick first. */
async function pickStory(candidates) {
  const list = sources.rankSources(candidates).slice(0, SHORTLIST);
  if (list.length <= 1) return list;
  const menu = list.map((a, i) => `${i + 1}. ${a.title}\n   links: ${(a.links || []).length} | post photos: ${(a.media || []).length} | ${a.text.replace(/\s+/g, " ").slice(0, 420)}`).join("\n");
  try {
    const reply = await opus.ask({
      system: "You are the editor of an Instagram channel for hands-on systems/AI engineers. You know what engineers save, share and argue about, and you pick the one story most likely to travel.",
      prompt: `Score every story below for a 40-second narrated reel cut from real footage, then pick the ONE most likely to go viral with engineers.

Score each 1-10 on:
- STOP: a surprising or counter-intuitive claim that stops a scroll in 2 seconds ("your X is secretly Y", a myth broken, a cost nobody noticed)
- STAKES: something engineers feel (money, outages, security holes, latency, lost data, their career)
- PROOF: concrete evidence (a number, a before/after, a real repo or release, a reproducible bug)
- REACH: how many engineers it applies to (common stacks and everyday pain beat niche configuration trivia)
- NOW: tied to something new this week (a release, an incident, a trend)
- SHARE: would someone send it to a teammate or save it for later
- SHOW: is there something REAL to put on screen: a product or demo, the people involved, a real page (links), photos in the post, or a world stock footage can show (data centres, offices, factories, cities)? A story that is only numbers in a post, with nothing to show, makes a lifeless reel.
Viral = the stories that score high on STOP, STAKES and SHARE together, with a real SHOW. Skip vague opinion pieces and lists of news.

${menu}

Return only JSON: {"scores": [{"n": <number>, "viral": <1-10>}], "pick": <number>, "why": "<one line: the hook that makes it travel>"}`,
      maxTokens: 800,
      temperature: 0.2,
    });
    const { pick, why, scores } = opus.parseJson(reply);
    const i = Number(pick) - 1;
    if (Number.isInteger(i) && list[i]) {
      const score = Array.isArray(scores) ? scores.find((s) => Number(s?.n) === i + 1)?.viral : undefined;
      logger.info(`Factory editor: picked "${list[i].title}"${score ? ` (viral ${score}/10)` : ""}: ${why}.`);
      // The runner-ups follow by their viral score, so a failed pick falls back to the next best.
      const rank = new Map((Array.isArray(scores) ? scores : []).map((s) => [Number(s?.n) - 1, Number(s?.viral) || 0]));
      const rest = list.map((a, j) => ({ a, j })).filter((x) => x.j !== i).sort((x, y) => (rank.get(y.j) || 0) - (rank.get(x.j) || 0)).map((x) => x.a);
      return [list[i], ...rest];
    }
  } catch (e) {
    logger.warn(`Factory editor: pick failed (${e.message}); using the ranking.`);
  }
  return list;
}

/** Reads the story's linked pages and folds them in as research. Never throws. */
async function deepDive(article, { maxPages = RESEARCH_PAGES, fetch = fetchPage } = {}) {
  const pages = [];
  for (const url of (article.links || []).slice(0, maxPages)) {
    const page = await fetch(url).catch(() => null);
    if (page && page.text && page.text.length > 200) pages.push({ url: page.url || url, title: page.title || "", text: page.text.slice(0, RESEARCH_CHARS) });
  }
  if (!pages.length) return article;
  logger.info(`Factory: deep dive on "${article.title}" read ${pages.length} linked page(s).`);
  const block = pages.map((p) => `--- ${p.title || p.url} (${p.url})\n${p.text}`).join("\n\n");
  return { ...article, baseText: article.text, research: pages, text: `${article.text}\n\nRESEARCH (pages the article links to):\n${block}` };
}

module.exports = { freshSources, pickStory, deepDive, writtenAt, rememberRun, readInbox };
