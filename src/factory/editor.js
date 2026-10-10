/**
 * The editor: picks the ONE story a cycle turns into content, then researches it.
 *
 *  - freshSources(): this run's digest items plus Insights written in the last 36 h.
 *  - pickStory(): Opus reads the candidates and picks the one most worth a reel: an interesting
 *    topic (a surprising finding, how something really works, a shift, a debate), never a product
 *    launch or promo, with the ANGLE the reel answers (the digit-count ranking only orders the
 *    shortlist and is the fallback). isPromo() keeps launches and promos out before Opus looks.
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
const config = require("../../config");

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

/**
 * A launch, an announcement, a demo or an event: the owner does not want promotional reels.
 * Judged on the title and the opening of the story, where an announcement says what it is.
 */
const PROMO = /\b(launch(es|ed|ing)?|announc(e|es|ed|ing|ement)|introduc(es|ed|ing)|unveil(s|ed)?|now (available|live|open)|available now|is (live|out) now|free trial|sign[- ]?up|register (now|today|here)|webinar|roadshow|hackathon|giveaway|discount|coupon|promo code|pre-?order|waitlist|early access|beta access|join (us|our)|we'?re hiring|now hiring|demo day|livestream|meetup|conference talk|summit|course|bootcamp|certification|new features?|new version|release notes|rolls? out|ships?|live on|on demand|enters (alpha|beta)|in (alpha|beta)|walkthrough|added to|selects|partners? with|integrat(es|ion) with|(?<!\b(paper|study|report|dataset|data|code|weights|findings) )releas(es|ed|ing)\b(?! (a |the |an |its |their |new )?(paper|study|report|dataset|benchmark|data|findings|survey|analysis)))\b/i;
function isPromo(article) {
  const head = `${article.title || ""} ${String(article.baseText ?? article.text ?? "").slice(0, 280)}`;
  return PROMO.test(head);
}

/** Opus picks one candidate; returns the candidates reordered with the pick first. */
async function pickStory(candidates) {
  const list = sources.rankSources(candidates).slice(0, SHORTLIST);
  if (list.length <= 1) return list;
  const menu = list.map((a, i) => `${i + 1}. ${a.title}\n   links: ${(a.links || []).length} | post photos/video: ${(a.media || []).length} | ${a.text.replace(/\s+/g, " ").slice(0, 420)}`).join("\n");
  try {
    const reply = await opus.ask({
      system: "You are the editor of an Instagram channel about the most interesting ideas in AI and tech, for smart, curious people (engineers and builders among them). You know what people stop for, save and send to a friend, and you never run ads.",
      prompt: `Pick the ONE story below that makes the most interesting 40-second narrated reel, and the ANGLE the reel takes.

What we make: reels about an IDEA. A surprising finding, how something really works under the hood, a shift that changes how people build or work, a debate with real stakes, a number that changes how you see something. Never an ad: no product launches, feature announcements, demos, events, courses, hiring or "try our tool". When a story is an announcement, look for the idea inside it (the shift it is evidence of); if there is none, it scores 0.

Score each 1-10:
- CURIOSITY: a question a smart non-specialist wants answered ("why does X really happen", a hidden mechanism, a surprising number)
- SURPRISE: counter-intuitive, a myth broken, an assumption overturned
- STAKES: it matters to how people work, build, earn, stay safe, or what comes next
- PROOF: concrete evidence (numbers, a result, a real example)
- REACH: how many people care (broad tech curiosity beats niche configuration trivia)
- SHARE: would someone send it to a friend or save it
- SHOW: something real to put on screen (people, places, machines, the post, a page) or a mechanism that can be shown
- PROMO: 0 if it is someone selling or announcing their own product, event or service; 10 if it is pure idea
A pick needs PROMO >= 7. Viral = high CURIOSITY, SURPRISE and SHARE together.

${menu}

Return only JSON: {"scores": [{"n": <number>, "viral": <1-10>, "promo": <0-10>}], "pick": <number or 0 if none qualifies>, "angle": "<the one-line question or claim the reel is about, framed as the idea, not a product (e.g. 'CAPTCHAs are dead: AI agents pass them, so proof-of-human is moving to your phone')>", "why": "<one line: why it travels>"}`,
      maxTokens: 900,
      temperature: 0.2,
      effort: config.factory.textEffort,
    });
    const { pick, why, scores, angle } = opus.parseJson(reply);
    const promoOf = new Map((Array.isArray(scores) ? scores : []).map((x) => [Number(x?.n) - 1, Number(x?.promo)]));
    // Runner-ups by viral score, never one Opus marked as a promo.
    const rank = new Map((Array.isArray(scores) ? scores : []).map((x) => [Number(x?.n) - 1, Number(x?.viral) || 0]));
    const ok = (j) => !(promoOf.get(j) < 7);
    const i = Number(pick) - 1;
    const rest = list.map((a, j) => ({ a, j })).filter((x) => x.j !== i && ok(x.j)).sort((x, y) => (rank.get(y.j) || 0) - (rank.get(x.j) || 0)).map((x) => x.a);
    if (Number.isInteger(i) && list[i] && ok(i)) {
      logger.info(`Factory editor: picked "${list[i].title}"${rank.get(i) ? ` (viral ${rank.get(i)}/10)` : ""}: ${angle || why}.`);
      return [{ ...list[i], angle: String(angle || "").slice(0, 240) }, ...rest];
    }
    // None qualifies: an empty pick sends the cycle to the Insights archive instead of a weak reel.
    logger.info(`Factory editor: no story qualifies as an interesting, non-promotional reel${why ? ` (${why})` : ""}.`);
    return [];
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

module.exports = { freshSources, pickStory, deepDive, writtenAt, rememberRun, readInbox, isPromo };
