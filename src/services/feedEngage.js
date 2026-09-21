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
    const gmPrompt = d("geminiPromptTokens"), gmCompletion = d("geminiCompletionTokens");
    const nvPrompt = d("nvidiaPromptTokens"), nvCompletion = d("nvidiaCompletionTokens");
    const gmModel = config.llm.gemini.model;
    return {
      openrouter: { prompt: orPrompt, completion: orCompletion, usd: llmService.commentCostUsd(orPrompt, orCompletion) },
      gemini: { prompt: gmPrompt, completion: gmCompletion, usd: llmService.commentCostUsd(gmPrompt, gmCompletion, gmModel) },
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
      previews.push({ author: post.author, key: post.key, postText: post.text, comment: draft.comment, sort });
      logger.info(`feedEngage DRYRUN [${sort}] would comment on @${post.author}: "${draft.comment}"`);
      skipped++;
      return false;
    }
    // ==== COMMENTS DISABLED until replies are perfected (dry-run previews above still work) ====
    // logger.info(`feedEngage [${sort}]: commenting on @${post.author}: "${draft.comment.slice(0, 90)}..."`);
    // const ok = await LinkedInService.commentOnFeedCard(post.key, post.href, post.text.slice(0, 80), draft.comment, post.author);
    // if (ok) {
    //   track[post.key] = { ts: new Date().toISOString(), status: "commented" };
    //   saveTrack(track);
    //   commented++;
    //   logger.info(`feedEngage: commented (${commented}/${max} this cycle).`);
    //   return true;
    // } else {
    //   logger.warn(`feedEngage: comment post failed on ${post.key} (not tracked, retried next cycle).`);
    //   skipped++;
    //   return false;
    // }
    skipped++;
    return false;
  };

  // Phase 1: Top (default feed order), Phase 2: Recent. Quota split so max=2 still
  // means 1 Top + 1 Recent; larger max fills Top first, Recent takes the remainder.
  // Each phase keeps scanning deeper + trying candidates until its quota fills or the
  // feed runs dry (consecutive scan with zero fresh candidates = exhausted).
  const topQuota = Math.ceil(max / 2);
  const seenThisRun = new Set();
  const likedThisRun = new Set();
  // Dry runs never increment `commented` (nothing posted), so quota progress there = previews made.
  const done = () => (dryRun ? previews.length : commented);
  const phases = [{ sort: "top", quota: topQuota }, { sort: "recent", quota: max }];
  for (const { sort, quota } of phases) {
    let rounds = 0;
    while (done() < quota && rounds < 10) {
      if (!dryRun && commentedToday(track) >= MAX_PER_DAY) break;
      // Each round scrolls deeper (page state persists, so later scans reach older posts).
      const posts = await LinkedInService.scanFeedPosts({ maxPosts: 12, maxScrolls: 6 + rounds * 4, sort });
      // Like everything seen (live runs only): reply, skip, or reject - likes are unconditional.
      // State-checked inside likeFeedCard, so already-liked cards are never toggled off.
      if (!dryRun) {
        for (const post of posts) {
          if (likedThisRun.has(post.key)) continue;
          likedThisRun.add(post.key);
          try {
            if (await LinkedInService.likeFeedCard(post.text.slice(0, 80))) {
              liked++;
              logger.info(`feedEngage: liked @${post.author} (${liked} this cycle).`);
            }
          } catch (e) {}
          await sleep(LIKE_PACE_MS);
        }
      } else {
        for (const post of posts) {
          if (likedThisRun.has(post.key)) continue;
          likedThisRun.add(post.key);
          wouldLike.push({ author: post.author, snippet: post.text.slice(0, 60) });
        }
      }
      let attempted = 0;
      for (const post of posts) {
        if (done() >= quota) break;
        if (!dryRun && commentedToday(track) >= MAX_PER_DAY) break;
        if (seenThisRun.has(post.key)) continue;
        if (track[post.key] && shouldSkipTracked(track, post.key)) continue;
        seenThisRun.add(post.key);
        attempted++;
        const before = commented;
        await engageOne(post, sort);
        // Pace only published comments (nothing public happened on a rejection).
        if (!dryRun && commented > before && commented < max) await sleep(PACE_MS);
      }
      if (attempted === 0) {
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
  logger.info(`feedEngage: run cost ~$${(cost.openrouter.usd + cost.gemini.usd).toFixed(4)} (Gemini $${cost.gemini.usd.toFixed(4)} ${cost.gemini.prompt}+${cost.gemini.completion} tok; OpenRouter $${cost.openrouter.usd.toFixed(4)} ${cost.openrouter.prompt}+${cost.openrouter.completion} tok; legacy ${cost.legacy.prompt}+${cost.legacy.completion} tok).`);
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
      if (entryOf(track[post.key]).status === "liked") continue;
      pool.push(post);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const post of pool) {
      if (liked >= target) break;
      picked++;
      try {
        if (await LinkedInService.likeFeedCard(post.text.slice(0, 80))) {
          liked++;
          track[post.key] = { ts: new Date().toISOString(), status: "liked" };
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

module.exports = { runFeedEngagement, runLikePass };
