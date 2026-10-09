/**
 * The editor: picks the ONE story a cycle turns into content, then researches it.
 *
 *  - freshSources(): this run's digest items plus Insights added in the last 36 h. The archive
 *    is only a fallback for a run that produced nothing usable.
 *  - pickStory(): Opus reads the candidates and picks the one with the most concrete, visual,
 *    teachable story (the old digit-count ranking only breaks ties and orders the shortlist).
 *  - deepDive(): reads every page the story links to (pageFetch: public hosts only, capped) and
 *    appends it as RESEARCH, so the storyboard has more to work with and the fact gate accepts
 *    what those pages say.
 */
const fs = require("fs");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { fetchPage } = require("../utils/pageFetch");
const sources = require("./sources");
const opus = require("./opus");

const FRESH_MS = 36 * 3600 * 1000;
const SHORTLIST = 12;
const RESEARCH_CHARS = 5000; // per page

/** This run's material, newest first; falls back to the archive only when there is none. */
function freshSources(extraSources = [], { now = Date.now() } = {}) {
  const insights = sources.listInsights().filter((a) => {
    try { return now - fs.statSync(require("path").resolve(__dirname, "../..", a.origin)).mtimeMs < FRESH_MS; } catch { return false; }
  });
  const fresh = [...extraSources, ...insights];
  return { fresh, fallback: fresh.length ? [] : sources.listInsights() };
}

/** Opus picks one candidate; returns the candidates reordered with the pick first. */
async function pickStory(candidates) {
  const list = sources.rankSources(candidates).slice(0, SHORTLIST);
  if (list.length <= 1) return list;
  const menu = list.map((a, i) => `${i + 1}. ${a.title}\n   links: ${(a.links || []).length} | ${a.text.replace(/\s+/g, " ").slice(0, 420)}`).join("\n");
  try {
    const reply = await opus.ask({
      system: "You are the editor of an Instagram channel for a hands-on systems/AI engineer. You pick the one story a short reel can teach best.",
      prompt: `Pick the ONE story below that makes the best 20-second reel for engineers: a concrete, surprising, specific thing (a mechanism, a number, a bug, a technique) that can be SHOWN, ideally with a real page behind it (links). Skip vague opinion pieces and lists of news.\n\n${menu}\n\nReturn only JSON: {"pick": <number>, "why": "<one line>"}`,
      maxTokens: 300,
      temperature: 0.2,
    });
    const { pick, why } = opus.parseJson(reply);
    const i = Number(pick) - 1;
    if (list[i]) {
      logger.info(`Factory editor: picked "${list[i].title}" (${why}).`);
      return [list[i], ...list.filter((_, j) => j !== i)];
    }
  } catch (e) {
    logger.warn(`Factory editor: pick failed (${e.message}); using the ranking.`);
  }
  return list;
}

/** Reads the story's linked pages and folds them in as research. Never throws. */
async function deepDive(article, { maxPages = config.factory.assetPages, fetch = fetchPage } = {}) {
  const pages = [];
  for (const url of (article.links || []).slice(0, Math.max(1, maxPages))) {
    const page = await fetch(url).catch(() => null);
    if (page && page.text && page.text.length > 200) pages.push({ url: page.url || url, title: page.title || "", text: page.text.slice(0, RESEARCH_CHARS) });
  }
  if (!pages.length) return article;
  logger.info(`Factory: deep dive on "${article.title}" read ${pages.length} linked page(s).`);
  const block = pages.map((p) => `--- ${p.title || p.url} (${p.url})\n${p.text}`).join("\n\n");
  return { ...article, research: pages, text: `${article.text}\n\nRESEARCH (pages the article links to):\n${block}` };
}

module.exports = { freshSources, pickStory, deepDive };
