/**
 * feedEngage.js
 *
 * Fully automated LinkedIn growth, run once per cycle from cron.js (after the
 * content loop, whether or not articles were produced):
 *  1. runLikePass       (LINKEDIN_LIKE, default on): 5-9 likes
 *  2. runFeedEngagement (LINKEDIN_FEED_REPLY=true): up to 2 comments, like-first
 *  3. runConnectPass    (LINKEDIN_CONNECT, default on): 10-15 no-note invites
 *
 * Posts come from targeted sources (finance/AI/founder content search plus
 * optional creator profiles in config/creators.json), not the home feed. The
 * home feed is only the fallback when targeted sources yield nothing, or the
 * whole thing when LINKEDIN_SOURCE=feed.
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
const LIKES_MAX_PER_DAY = 40;

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
const NOISE_RE = /\b(giveaway|hiring|we(?:'re| are) hiring|apply now|webinar|register (?:now|here)|dm me|link in bio|open ?to ?work|bootcamp|cohort|enroll|discount code|follow me for)\b/i;
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

// ---- Targeted post sources ----
// Content-search queries (newest first) aimed at the finance + AI + founder audience.
const SOURCE_QUERIES = [
  "fintech founder", "AI in finance", "venture capital AI", "private equity AI",
  "quant trading machine learning", "AI startup funding", "banking AI agents",
  "hedge fund AI", "fintech startup", "generative AI investing", "CFO AI",
];
const searchUrl = (q) => "https://www.linkedin.com/search/results/content/?keywords=" + encodeURIComponent(q) +
  "&datePosted=%22past-week%22&sortBy=%22date_posted%22";
function loadCreators() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "creators.json"), "utf8"));
    return (Array.isArray(list) ? list : []).filter((u) => /linkedin\.com\/in\//i.test(u))
      .map((u) => String(u).split("?")[0].replace(/\/$/, "") + "/recent-activity/all/");
  } catch (e) { return []; }
}
// Ordered scan sources for one pass. Creators first (highest signal), then shuffled
// searches. "feed" mode, or a targeted run that finds nothing, uses home Top/Recent.
function buildSources(limit = 6) {
  if (config.social.linkedinSource === "feed") return [{ label: "feed:top", sort: "top" }, { label: "feed:recent", sort: "recent" }];
  const creators = shuffled(loadCreators()).slice(0, 2).map((url) => ({ label: `creator:${url.split("/in/")[1].split("/")[0]}`, url }));
  const searches = shuffled(SOURCE_QUERIES).map((q) => ({ label: `search:${q}`, url: searchUrl(q) }));
  return [...creators, ...searches].slice(0, limit);
}
const FALLBACK_SOURCES = [{ label: "feed:top", sort: "top" }, { label: "feed:recent", sort: "recent" }];
const scanSource = (src, maxScrolls = 8) =>
  LinkedInService.scanFeedPosts({ maxPosts: 12, maxScrolls, ...(src.url ? { url: src.url } : { sort: src.sort }) });

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

// A post's entry under its current key, or under the older key used before posts were identified by their text.
function entryOfPost(track, post) {
  return entryOf(track[post.key] !== undefined ? track[post.key] : track[post.legacyKey]);
}

function shouldSkipTracked(track, key, legacyKey) {
  const e = entryOf(track[key] !== undefined ? track[key] : track[legacyKey]);
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
  const e = entryOfPost(track, post);
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
    if (shouldSkipTracked(track, post.key, post.legacyKey)) { skipped++; return false; }

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

  // Walk targeted sources until `max` comments land or sources run out. Posts are
  // scored (finance/AI/founder, US, fresh); only COMMENT_MIN+ get a draft, best first.
  // No separate like loop here: commentOnFeedCard likes first, and the like pass
  // already ran this cycle.
  const seenThisRun = new Set();
  const wanted = new Set();
  const done = () => (dryRun ? previews.length : commented);
  const commentFrom = async (src) => {
    const posts = (await scanSource(src, 10))
      .map((p) => ({ ...p, score: scorePost(p) }))
      .sort((a, b) => b.score - a.score);
    let fresh = 0;
    for (const post of posts) {
      if (done() >= max) break;
      if (!dryRun && commentedToday(track) >= MAX_PER_DAY) break;
      if (seenThisRun.has(post.key)) continue;
      if (shouldSkipTracked(track, post.key, post.legacyKey)) continue;
      seenThisRun.add(post.key);
      fresh++;
      if (dryRun && post.score >= LIKE_MIN && !wanted.has(post.key)) {
        wanted.add(post.key);
        wouldLike.push({ author: post.author, snippet: post.text.slice(0, 60), score: post.score });
      }
      if (post.score < COMMENT_MIN) continue;
      const before = commented;
      await engageOne(post, src.label);
      // Pace only published comments (nothing public happened on a rejection).
      if (!dryRun && commented > before && commented < max) await sleep(PACE_MS);
    }
    return fresh;
  };
  let found = 0;
  for (const src of buildSources()) {
    if (done() >= max || (!dryRun && commentedToday(track) >= MAX_PER_DAY)) break;
    try { found += await commentFrom(src); } catch (e) { logger.warn(`feedEngage [${src.label}]: scan failed: ${e.message}`); }
  }
  if (found === 0 && done() < max && config.social.linkedinSource !== "feed") {
    logger.warn("feedEngage: targeted sources yielded nothing - falling back to home feed.");
    for (const src of FALLBACK_SOURCES) {
      if (done() >= max) break;
      try { await commentFrom(src); } catch (e) { logger.warn(`feedEngage [${src.label}]: scan failed: ${e.message}`); }
    }
  }
  if (done() < max) logger.info(`feedEngage: ${done()}/${max} comments - sources exhausted, moving on.`);

  const cost = runCost();
  logger.info(`feedEngage: run cost ~$${cost.openrouter.usd.toFixed(4)} (OpenRouter ${cost.openrouter.prompt}+${cost.openrouter.completion} tok; NVIDIA ${cost.legacy.prompt}+${cost.legacy.completion} tok).`);
  return { commented, skipped, liked, previews, wouldLike, reason: dryRun ? "dry run - nothing posted or tracked" : "", cost };
}

// Like-only pass: no drafting, no commenting, no LLM spend. Walks the targeted
// sources, likes the best-scoring fresh posts right after each scan (cards
// virtualize out within a minute), stops at the 5-9 target. Already-liked keys
// persist in the tracker; likeFeedCard is state-checked (never toggles off).
async function runLikePass({ min = 5, max = 9 } = {}) {
  const track = loadTrack();
  const day = new Date().toISOString().slice(0, 10);
  const likedToday = Object.values(track).filter((v) => String(entryOf(v).likedAt || "").slice(0, 10) === day).length;
  const target = Math.min(min + Math.floor(Math.random() * (max - min + 1)), LIKES_MAX_PER_DAY - likedToday);
  if (target <= 0) return { liked: 0, picked: 0, target: 0 };
  const seen = new Set();
  let liked = 0, picked = 0;
  const followState = { n: 0 };
  const likeFrom = async (src) => {
    let posts = [];
    try {
      posts = await scanSource(src);
    } catch (e) {
      logger.warn(`feedEngage like-pass: ${src.label} scan failed: ${e.message}`);
    }
    const pool = [];
    for (const post of posts) {
      if (!post || seen.has(post.key)) continue;
      seen.add(post.key);
      if (entryOfPost(track, post).likedAt) continue;
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
          const e = entryOfPost(track, post);
          track[post.key] = e.status
            ? { ...e, likedAt: new Date().toISOString() }
            : { ts: new Date().toISOString(), status: "liked", likedAt: new Date().toISOString() };
          saveTrack(track); // persist immediately so a crash can't re-like this post
          logger.info(`feedEngage like-pass: liked @${post.author} via ${src.label} (${liked}/${target}).`);
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
  let found = 0;
  for (const src of buildSources()) {
    if (liked >= target) break;
    found += await likeFrom(src);
  }
  // Targeted sources empty (markup change, nothing fresh): fall back to the home feed.
  if (found === 0 && liked < target && config.social.linkedinSource !== "feed") {
    logger.warn("feedEngage like-pass: targeted sources yielded nothing - falling back to home feed.");
    for (const src of FALLBACK_SOURCES) {
      if (liked >= target) break;
      await likeFrom(src);
    }
  }
  if (liked < target) logger.warn(`feedEngage like-pass: sources exhausted (${liked}/${target} liked).`);
  try {
    // Bound tracker growth: prune entries older than 30 days.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [key, v] of Object.entries(track)) {
      const ts = Date.parse(entryOf(v).ts);
      if (!entryOf(v).ts || isNaN(ts) || ts < cutoff) delete track[key];
    }
    saveTrack(track);
  } catch (e) {}
  return { liked, picked, target };
}

// Connection pass: 10-15 no-note requests per run to US, 2nd-degree people in
// AI/tech/finance/investing, found through US-filtered people search. Fully
// automated; stops cleanly on LinkedIn's weekly cap or any checkpoint.
async function runConnectPass({ min = 10, max = 15, dryRun = false } = {}) {
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

module.exports = { runFeedEngagement, runLikePass, runConnectPass, scorePost, cleanup, _tracker: { shouldSkipTracked, entryOfPost } };
