/**
 * feedEngage.js
 *
 * Fully automated LinkedIn feed engagement (mirrors the X automation shape):
 * scroll home feed -> pick substantive posts -> comment genuinely as the
 * user would (real @-mention, like first) -> track + budget, never spams.
 *
 * Run-and-leave: called after every successful GitHub batch commit from cron.js
 * (flushBatch) when config.social.linkedinFeedReply is true. No URLs, no args.
 * Per commit: 2 comments — first from Top (default feed), then one from Recent.
 */

const fs = require("fs");
const path = require("path");
const config = require("../../config");
const llmService = require("./llm");
const linkedinService = require("./linkedin");
const LinkedInService = new linkedinService();
const { logger, sleep } = require("../utils/helpers");

const TRACK_PATH = path.join(process.cwd(), "data", "linkedin-feed-commented.json");
const MAX_PER_DAY = 15;
const REJECT_TTL_MS = 3 * 24 * 60 * 60 * 1000; // rejected posts rest 3 days, then become eligible again
const PACE_MS = 25000;
const LIKE_PACE_MS = 8000; // bulk likes trip LinkedIn rate limits; space them out

// ---- Audience targeting: US-based people in AI, tech, finance, investing ----
// Every feed card gets a score; likes, follows and comments only go to posts that
// clear these bars, so the feed algorithm learns this audience and our replies
// land in front of it.
const LIKE_MIN = 3;
const COMMENT_MIN = 4;
const FOLLOW_MIN = 6;
const FOLLOW_PER_RUN = 3;
// Finance is the priority audience (2 pts per distinct term, up to 3 terms); AI/tech
// is the secondary audience (1 pt per term, up to 3), so a finance post clears the
// bars on its own while an AI-only post needs to be on-topic, fresh or US-relevant.
const FIN_RE = /\b(fintech|finance|financial|banks?|banking|investment banking|payments?|cfo|investors?|investing|investment|investments|venture|vcs?|private equity|hedge funds?|asset management|wealth|portfolio|equity|equities|markets?|stocks?|trading|traders?|earnings|valuation|ipo|m&a|buyouts?|fed|federal reserve|rates|yields?|treasury|bonds?|credit|inflation|recession|gdp|cpi|macro|economy|economic|etfs?|capital|funding|fundraising|seed|series [a-d]|family office|real estate|reits?|commodities|derivatives|options|hedging|liquidity|dealmaking|wall street|nasdaq|s&p)\b/gi;
const TECH_RE = /\b(ai|artificial intelligence|machine learning|ml|llms?|gpt|agents?|agentic|openai|anthropic|claude|gemini|genai|generative|deep learning|neural|inference|nvidia|copilot|chatgpt|software|engineering|engineers?|developers?|devops|cloud|aws|kubernetes|infrastructure|open.?source|saas|startups?|founders?|cto|cybersecurity|backend|programming|coding|semiconductors?|robotics|tech)\b/gi;
const US_RE = /\b(united states|usa|u\.s\.a?|us-based|new york|nyc|manhattan|san francisco|bay area|silicon valley|palo alto|menlo park|austin|seattle|boston|chicago|los angeles|miami|denver|atlanta|dallas|houston|california|texas|washington,? dc|wall street|nasdaq|nyse|s&p|federal reserve|congress)\b|\$\d/i;
const NOISE_RE = /\b(giveaway|we(?:'re| are) hiring|hiring now|apply now|webinar|register (?:now|here)|dm me|link in bio|open ?to ?work|bootcamp|cohort|enroll|discount code|follow me for)\b/i;
function scorePost(post) {
  const hay = `${post.head || ""} ${post.text || ""}`;
  const distinct = (re) => new Set((hay.match(re) || []).map((m) => m.toLowerCase())).size;
  let score = 2 * Math.min(distinct(FIN_RE), 3) + Math.min(distinct(TECH_RE), 3);
  if (US_RE.test(hay)) score += 2;
  const age = typeof post.ageH === "number" ? post.ageH : 999;
  if (age <= 3) score += 2; else if (age <= 12) score += 1;
  if (NOISE_RE.test(hay)) score -= 4;
  return score;
}

// ---- Connection requests: US, 2nd-degree, target-industry people, no note ----
const CONNECT_FIN_KEYWORDS = [
  "investment banking analyst", "private equity", "venture capital", "portfolio manager",
  "equity research", "hedge fund", "CFO", "wealth management", "asset management",
  "financial analyst", "fintech", "quantitative analyst", "trader", "family office",
  "credit analyst", "M&A", "growth equity", "angel investor", "capital markets",
  "investor relations", "financial advisor", "managing director investments",
];
const CONNECT_TECH_KEYWORDS = [
  "AI engineer", "machine learning engineer", "head of AI", "CTO", "data scientist",
  "software engineer", "AI startup founder",
];
const CONNECT_PER_KEYWORD = 3; // spread each run across many keywords, 3 finance for every 1 AI/tech
const shuffled = (a) => [...a].sort(() => Math.random() - 0.5);
function buildConnectQueries() {
  const fin = shuffled(CONNECT_FIN_KEYWORDS), tech = shuffled(CONNECT_TECH_KEYWORDS);
  const out = [];
  for (let i = 0; fin.length || tech.length; i++) {
    const list = (i % 4 === 3 && tech.length) || !fin.length ? tech : fin;
    if (list.length) out.push(list.shift());
  }
  return out;
}
const CONNECT_ICP_RE = /\b(ai|artificial intelligence|machine learning|ml|llm|data scien|software|engineer|developer|cto|founder|co-?founder|startup|tech|cloud|cyber|product|venture|vc|investor|investing|investment|private equity|equity|portfolio|fintech|finance|financial|banking|banker|analyst|quant|trading|trader|cfo|capital|fund|partner|principal|associate|wealth|advisor|asset|hedge|credit|m&a|treasury|economist|managing director|family office|bank|equity)\b/i;
const CONNECT_SKIP_RE = /\b(recruit|recruiter|talent acquisition|staffing|headhunter|open to work|seeking|student|intern|coach|seo|agency|mlm|forex|signals|dropshipping)\b/i;
// The geo filter leaks occasionally; drop anyone whose card names a non-US country.
const CONNECT_NON_US_RE = /\b(india|russia|ukraine|pakistan|united kingdom|england|london|canada|toronto|germany|france|nigeria|brazil|china|singapore|uae|dubai|australia|bangladesh|philippines|indonesia|egypt|turkey|israel|netherlands|spain|italy|poland|mexico|kenya|vietnam)\b/i;
const CONNECT_MAX_PER_DAY = 30;
const CONNECT_MAX_PER_WEEK = 100;
const CONNECT_KEY = (href) => `conn:${String(href || "").replace(/\/$/, "")}`;

// Scroll persistence: keep going deeper until the phase quota fills or the feed is
// genuinely exhausted (a round with zero fresh candidates). 10 bounds the worst
// case on LinkedIn's near-infinite feed; normal runs exit in 1-2 rounds.

function loadTrack() {
  try {
    const raw = JSON.parse(fs.readFileSync(TRACK_PATH, "utf8"));
    if (raw && typeof raw === "object") return raw;
  } catch (e) { /* fresh start */ }
  return {};
}

function saveTrack(track) {
  try {
    const dir = path.dirname(TRACK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Sweep orphaned tmp files from crashed runs (crash between write + rename
    // leaves TRACK_PATH.<pid>.tmp behind; unbounded over months of crashes).
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${path.basename(TRACK_PATH)}.`) && f.endsWith(".tmp")) {
        const fp = path.join(dir, f);
        try { if (Date.now() - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp); } catch (e) {}
      }
    }
    // Atomic write: crash mid-write must never leave a corrupt tracker (that would
    // reset commented-memory and cause double comments). tmp + rename is atomic on POSIX/NTFS.
    const tmp = `${TRACK_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(track, null, 2), "utf8");
    fs.renameSync(tmp, TRACK_PATH);
  } catch (e) {
    logger.warn(`feedEngage: could not persist tracker: ${e.message}`);
  }
}

// Tracker entries: { ts, status: "commented" | "rejected" } (legacy plain-string values = commented).
function entryOf(v) {
  if (v && typeof v === "object") return v;
  return { ts: String(v || ""), status: "commented" };
}

function shouldSkipTracked(track, key) {
  const e = entryOf(track[key]);
  if (!e.ts) return false;
  if (e.status === "commented") return true; // never twice, inside the 30d prune window
  // Rejected AND generator-skipped posts rest 3 days, then become eligible again.
  if ((e.status === "rejected" || e.status === "skipped") && Date.now() - Date.parse(e.ts) < REJECT_TTL_MS) return true;
  return false;
}

function commentedToday(track) {
  const day = new Date().toISOString().slice(0, 10);
  let n = 0;
  for (const v of Object.values(track)) {
    const e = entryOf(v);
    if (e.status === "commented" && String(e.ts || "").slice(0, 10) === day) n++;
  }
  return n;
}

// Follow top-scoring authors (a few per run): follows weigh heavier than likes in
// what LinkedIn ranks into the feed. Never unfollows; state-checked in the service.
async function maybeFollow(post, track, state) {
  if (!state || state.n >= FOLLOW_PER_RUN || post.score < FOLLOW_MIN) return;
  const e = entryOf(track[post.key]);
  if (e.followedAt) return;
  try {
    if (await LinkedInService.followFeedCard(post.text.slice(0, 80))) {
      state.n++;
      track[post.key] = e.status
        ? { ...e, followedAt: new Date().toISOString() }
        : { ts: new Date().toISOString(), status: "liked", followedAt: new Date().toISOString() };
      saveTrack(track);
      logger.info(`feedEngage: followed @${post.author} (score ${post.score}, ${state.n}/${FOLLOW_PER_RUN}).`);
      await sleep(3000);
    }
  } catch (err) {}
}

async function runFeedEngagement({ max = 2, dryRun = false } = {}) {
  if (!config.social.linkedinFeedReply && !dryRun) {
    return { commented: 0, skipped: 0, liked: 0, previews: [], wouldLike: [], reason: "disabled", cost: null };
  }
  // Cost readout: snapshot LLM token meters so every run reports its own spend.
  const m0 = llmService.getMetrics();
  const runCost = () => {
    const m1 = llmService.getMetrics();
    const d = (k) => (Number(m1[k]) || 0) - (Number(m0[k]) || 0);
    const orPrompt = d("openrouterPromptTokens"), orCompletion = d("openrouterCompletionTokens");
    const nvPrompt = d("nvidiaPromptTokens"), nvCompletion = d("nvidiaCompletionTokens");
    return {
      openrouter: { prompt: orPrompt, completion: orCompletion, usd: llmService.commentCostUsd(orPrompt, orCompletion) },
      legacy: { prompt: nvPrompt, completion: nvCompletion },
    };
  };
  const track = loadTrack();
  // Prune entries older than 30 days (and unparseable garbage) so the file stays small.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [key, v] of Object.entries(track)) {
    const ts = Date.parse(entryOf(v).ts);
    if (!entryOf(v).ts || isNaN(ts) || ts < cutoff) delete track[key];
  }
  if (commentedToday(track) >= MAX_PER_DAY) {
    return { commented: 0, skipped: 0, liked: 0, previews: [], wouldLike: [], reason: `daily cap (${MAX_PER_DAY}) reached`, cost: runCost() };
  }

  let commented = 0, skipped = 0, liked = 0;
  const previews = [];
  const wouldLike = []; // dry-run mirror of the like loop, so previews show like intent

  const engageOne = async (post, sort) => {
    if (track[post.key] && shouldSkipTracked(track, post.key)) { skipped++; return false; }

    let draft;
    try {
      draft = await llmService.draftFeedComment({ postAuthor: post.author, postText: post.text });
    } catch (e) {
      // Thin posts (<10 words) throw before any LLM call: park them for 3d so every
      // cycle doesn't waste a scan slot re-attempting them. Anything else (network,
      // LLM down) stays untracked and retries next cycle.
      if (/too thin/i.test(e.message || "") && !dryRun) {
        track[post.key] = { ts: new Date().toISOString(), status: "skipped" };
        saveTrack(track);
      }
      logger.warn(`feedEngage: draft failed for ${post.key}: ${e.message}`);
      skipped++;
      return false;
    }
    if (draft.skipped) {
      if (!dryRun) {
        track[post.key] = { ts: new Date().toISOString(), status: "skipped" };
        saveTrack(track);
      }
      logger.info(`feedEngage: SKIP - no safe angle on @${post.author} post. Moving on.`);
      skipped++;
      return false;
    }
    if (!draft.isValid) {
      if (!dryRun) {
        track[post.key] = { ts: new Date().toISOString(), status: "rejected" };
        saveTrack(track);
      }
      logger.warn(`feedEngage: comment rejected (${(draft.errors || []).join("; ")}) — skipping ${post.key} for 3d.`);
      skipped++;
      return false;
    }

    if (dryRun) {
      previews.push({ author: post.author, key: post.key, postText: post.text, comment: draft.comment, sort, score: post.score });
      logger.info(`feedEngage DRYRUN [${sort}] would comment on @${post.author}: "${draft.comment}"`);
      skipped++;
      return false;
    }
    logger.info(`feedEngage [${sort}]: commenting on @${post.author}: "${draft.comment.slice(0, 90)}..."`);
    const ok = await LinkedInService.commentOnFeedCard(post.key, post.href, post.text.slice(0, 80), draft.comment, post.author);
    if (ok === true || ok === "uncertain") {
      track[post.key] = { ts: new Date().toISOString(), status: "commented", ...(ok === "uncertain" ? { unverified: true } : {}) };
      saveTrack(track);
      commented++;
      logger.info(`feedEngage: commented (${commented}/${max} this cycle)${ok === "uncertain" ? " [unverified - text left editor]" : ""}.`);
      return true;
    } else {
      logger.warn(`feedEngage: comment post failed on ${post.key} (not tracked, retried next cycle).`);
      skipped++;
      return false;
    }
  };

  // Phase 1: Top (default feed order), Phase 2: Recent. Quota split so max=2 still
  // means 1 Top + 1 Recent; larger max fills Top first, Recent takes the remainder.
  // Each phase keeps scanning deeper + trying candidates until its quota fills or the
  // feed runs dry (consecutive scan with zero fresh candidates = exhausted).
  const topQuota = Math.ceil(max / 2);
  const seenThisRun = new Set();
  const likedThisRun = new Set();
  const followState = { n: 0 };
  // Dry runs never increment `commented` (nothing posted), so quota progress there = previews made.
  const done = () => (dryRun ? previews.length : commented);
  const phases = [{ sort: "top", quota: topQuota }, { sort: "recent", quota: max }];
  for (const { sort, quota } of phases) {
    let rounds = 0;
    while (done() < quota && rounds < 10) {
      if (!dryRun && commentedToday(track) >= MAX_PER_DAY) break;
      // Each round scrolls deeper (page state persists, so later scans reach older posts).
      const posts = (await LinkedInService.scanFeedPosts({ maxPosts: 12, maxScrolls: 6 + rounds * 4, sort }))
        .map((p) => ({ ...p, score: scorePost(p) }))
        .sort((a, b) => b.score - a.score);
      // Like only target-audience posts (live runs only): every like trains the feed.
      // State-checked inside likeFeedCard, so already-liked cards are never toggled off.
      if (!dryRun) {
        for (const post of posts) {
          if (likedThisRun.has(post.key)) continue;
          if (post.score < LIKE_MIN) continue;
          likedThisRun.add(post.key);
          await maybeFollow(post, track, followState);
          try {
            if (await LinkedInService.likeFeedCard(post.text.slice(0, 80))) {
              liked++;
              const existingEntry = entryOf(track[post.key]);
              track[post.key] = existingEntry.status
                ? { ...existingEntry, likedAt: new Date().toISOString() }
                : { ts: new Date().toISOString(), status: "liked", likedAt: new Date().toISOString() };
              saveTrack(track);
              logger.info(`feedEngage: liked @${post.author} (${liked} this cycle).`);
            }
          } catch (e) {}
          await sleep(LIKE_PACE_MS);
        }
      } else {
        for (const post of posts) {
          if (likedThisRun.has(post.key)) continue;
          if (post.score < LIKE_MIN) continue;
          likedThisRun.add(post.key);
          wouldLike.push({ author: post.author, snippet: post.text.slice(0, 60), score: post.score });
        }
      }
      let attempted = 0, fresh = 0;
      // Highest-scoring (target audience, fresh) posts first; off-audience posts never get a comment.
      for (const post of posts) {
        if (done() >= quota) break;
        if (!dryRun && commentedToday(track) >= MAX_PER_DAY) break;
        if (seenThisRun.has(post.key)) continue;
        if (track[post.key] && shouldSkipTracked(track, post.key)) continue;
        seenThisRun.add(post.key);
        fresh++;
        if (post.score < COMMENT_MIN) continue;
        attempted++;
        const before = commented;
        await engageOne(post, sort);
        // Pace only published comments (nothing public happened on a rejection).
        if (!dryRun && commented > before && commented < max) await sleep(PACE_MS);
      }
      if (fresh === 0) {
        logger.info(`feedEngage [${sort}]: no fresh candidates after scrolling, moving on.`);
        break;
      }
      rounds++;
    }
    if (done() < quota) logger.info(`feedEngage [${sort}]: quota unfilled after ${rounds} rounds (feed still yielding rejects) - moving on.`);
    if (done() >= max) break;
    if (!dryRun && commentedToday(track) >= MAX_PER_DAY) break;
  }

  const cost = runCost();
  logger.info(`feedEngage: run cost ~$${cost.openrouter.usd.toFixed(4)} (OpenRouter ${cost.openrouter.prompt}+${cost.openrouter.completion} tok; NVIDIA ${cost.legacy.prompt}+${cost.legacy.completion} tok).`);
  return { commented, skipped, liked, previews, wouldLike, reason: dryRun ? "dry run - nothing posted or tracked" : "", cost };
}

// Like-only pass: no drafting, no commenting, no LLM spend. Per sort: scan,
// shuffle, like immediately - cards virtualize out within a minute, so likes
// fire seconds after their scan, never after both scans. Target 3-9 total.
// Already-liked keys persist in the tracker so later cycles skip them;
// likeFeedCard is state-checked (already-liked cards are never toggled off).
async function runLikePass({ min = 3, max = 9 } = {}) {
  const target = min + Math.floor(Math.random() * (max - min + 1));
  const track = loadTrack();
  const seen = new Set();
  let liked = 0, picked = 0, rounds = 0, emptyRounds = 0;
  const followState = { n: 0 };
  // Scroll-until-goal: each round scans Top + Recent deeper than the last and
  // likes what it finds. Stops when the target fills or 3 straight rounds find
  // nothing fresh (feed exhausted). 10 rounds caps worst-case runtime.
  const runSort = async (sort, maxScrolls) => {
    let posts = [];
    try {
      posts = await LinkedInService.scanFeedPosts({ maxPosts: 12, maxScrolls, sort });
    } catch (e) {
      logger.warn(`feedEngage like-pass: ${sort} scan failed: ${e.message}`);
    }
    const pool = [];
    for (const post of posts) {
      if (!post || seen.has(post.key)) continue;
      seen.add(post.key);
      if (entryOf(track[post.key]).likedAt) continue;
      post.score = scorePost(post);
      if (post.score < LIKE_MIN) continue; // only target-audience posts train the feed
      pool.push(post);
    }
    // Best audience match first, with a little noise so the pattern isn't mechanical.
    pool.sort((a, b) => (b.score + Math.random() * 1.5) - (a.score + Math.random() * 1.5));
    for (const post of pool) {
      if (liked >= target) break;
      picked++;
      await maybeFollow(post, track, followState);
      try {
        if (await LinkedInService.likeFeedCard(post.text.slice(0, 80))) {
          liked++;
          const existingEntry2 = entryOf(track[post.key]);
          track[post.key] = existingEntry2.status
            ? { ...existingEntry2, likedAt: new Date().toISOString() }
            : { ts: new Date().toISOString(), status: "liked", likedAt: new Date().toISOString() };
          saveTrack(track); // persist immediately so a crash can't re-like this post
          logger.info(`feedEngage like-pass: liked @${post.author} (${liked}/${target}).`);
          await sleep(LIKE_PACE_MS);
        } else {
          await sleep(2000);
        }
      } catch (e) {
        await sleep(2000);
      }
    }
    return pool.length;
  };
  while (liked < target && rounds < 10 && emptyRounds < 3) {
    let roundFresh = 0;
    for (const sort of ["top", "recent"]) {
      if (liked >= target) break;
      roundFresh += await runSort(sort, Math.min(6 + rounds * 4, 18));
    }
    if (roundFresh === 0) emptyRounds++;
    else emptyRounds = 0;
    rounds++;
  }
  if (liked < target) logger.warn(`feedEngage like-pass: feed exhausted after ${rounds} rounds (${liked}/${target} liked).`);
  try {
    // Bound tracker growth: liked keys accumulate daily; prune entries older
    // than 30 days (same window as the comment path) so the file stays small.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [key, v] of Object.entries(track)) {
      const ts = Date.parse(entryOf(v).ts);
      if (!entryOf(v).ts || isNaN(ts) || ts < cutoff) delete track[key];
    }
    saveTrack(track);
  } catch (e) {}
  return { liked, picked, target };
}

// Connection pass: 20-30 no-note requests per run to US, 2nd-degree people in
// AI/tech/finance/investing, found through US-filtered people search. Fully
// automated; stops cleanly on LinkedIn's weekly cap or any checkpoint.
async function runConnectPass({ min = 20, max = 30, dryRun = false } = {}) {
  const track = loadTrack();
  const now = Date.now();
  const invitedSince = (ms) => Object.values(track).filter((v) => {
    const e = entryOf(v);
    return e.status === "invited" && now - Date.parse(e.ts) < ms;
  }).length;
  const dayLeft = CONNECT_MAX_PER_DAY - invitedSince(24 * 3600 * 1000);
  const weekLeft = CONNECT_MAX_PER_WEEK - invitedSince(7 * 24 * 3600 * 1000);
  const target = Math.min(min + Math.floor(Math.random() * (max - min + 1)), dayLeft, weekLeft);
  if (target <= 0) return { sent: 0, target: 0, previews: [], reason: "daily/weekly connect cap reached" };

  let sent = 0, scanned = 0, stop = "";
  const previews = [];
  const seenHref = new Set();
  let consecutiveFails = 0;
  const queries = buildConnectQueries();
  outer:
  for (const kw of queries) {
    let kwSent = 0;
    for (let page = 1; page <= 2; page++) {
      if (sent >= target) break outer;
      if (kwSent >= CONNECT_PER_KEYWORD) break;
      const res = await LinkedInService.scanPeopleSearch(kw, page);
      if (res.blocked) { stop = "login/checkpoint wall"; break outer; }
      if (res.people.length === 0) break; // no more results for this keyword
      for (const p of res.people) {
        if (sent >= target) break outer;
        if (kwSent >= CONNECT_PER_KEYWORD) break;
        scanned++;
        const key = CONNECT_KEY(p.href);
        if (!p.href || track[key] || seenHref.has(key)) continue;
        seenHref.add(key);
        if (!CONNECT_ICP_RE.test(p.text) || CONNECT_SKIP_RE.test(p.text) || CONNECT_NON_US_RE.test(p.text)) continue;
        if (dryRun) {
          previews.push({ name: p.name, text: p.text.slice(0, 140), kw });
          sent++; kwSent++;
          continue;
        }
        const r = await LinkedInService.sendConnectRequest(p.label);
        if (r === "limit") { stop = "LinkedIn invitation limit reached"; break outer; }
        if (r === "sent") {
          sent++; kwSent++;
          track[key] = { ts: new Date().toISOString(), status: "invited" };
          saveTrack(track);
          logger.info(`feedEngage connect: invited ${p.name} (${sent}/${target}) via "${kw}".`);
          consecutiveFails = 0;
        } else {
          // Email-gated or UI failure: park so the same person isn't retried every run.
          track[key] = { ts: new Date().toISOString(), status: "skipped" };
          saveTrack(track);
          logger.warn(`feedEngage connect: ${p.name} not sent (${r}).`);
          if (++consecutiveFails >= 5) { stop = "5 consecutive failures (LinkedIn UI changed?)"; break outer; }
        }
        await sleep(6000 + Math.floor(Math.random() * 8000));
      }
      await sleep(2000 + Math.floor(Math.random() * 3000));
    }
  }
  logger.info(`feedEngage connect: ${dryRun ? "would send" : "sent"} ${sent}/${target} (scanned ${scanned})${stop ? ` - stopped: ${stop}` : ""}.`);
  return { sent, target, scanned, previews, reason: stop };
}

const cleanup = () => LinkedInService.cleanup();

module.exports = { runFeedEngagement, runLikePass, runConnectPass, scorePost, cleanup };
