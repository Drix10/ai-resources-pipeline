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
const MAX_PER_DAY = 8;
const REJECT_TTL_MS = 3 * 24 * 60 * 60 * 1000; // rejected posts rest 3 days, then become eligible again
const PACE_MS = 25000;

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
    fs.writeFileSync(TRACK_PATH, JSON.stringify(track, null, 2), "utf8");
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
  if (e.status === "rejected" && Date.now() - Date.parse(e.ts) < REJECT_TTL_MS) return true;
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
    return { commented: 0, skipped: 0, previews: [], reason: "disabled" };
  }
  const track = loadTrack();
  // Prune entries older than 30 days so the file stays small.
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [key, v] of Object.entries(track)) {
    if (Date.parse(entryOf(v).ts) < cutoff) delete track[key];
  }
  if (commentedToday(track) >= MAX_PER_DAY) {
    return { commented: 0, skipped: 0, previews: [], reason: `daily cap (${MAX_PER_DAY}) reached` };
  }

  let commented = 0, skipped = 0;
  const previews = [];

  const engageOne = async (post, sort) => {
    if (track[post.key] && shouldSkipTracked(track, post.key)) { skipped++; return; }

    let draft;
    try {
      draft = await llmService.draftFeedComment({ postAuthor: post.author, postText: post.text });
    } catch (e) {
      logger.warn(`feedEngage: draft failed for ${post.key}: ${e.message}`);
      skipped++;
      return;
    }
    if (draft.skipped) {
      logger.info(`feedEngage: SKIP - no technical substance in @${post.author} post. Moving on.`);
      skipped++;
      return;
    }
    if (!draft.isValid) {
      track[post.key] = { ts: new Date().toISOString(), status: "rejected" };
      saveTrack(track);
      logger.warn(`feedEngage: comment rejected (${(draft.errors || []).join("; ")}) — skipping ${post.key} for 3d.`);
      skipped++;
      return;
    }

    if (dryRun) {
      previews.push({ author: post.author, key: post.key, postText: post.text, comment: draft.comment, sort });
      logger.info(`feedEngage DRYRUN [${sort}] would comment on @${post.author}: "${draft.comment}"`);
      skipped++;
      return;
    }
    logger.info(`feedEngage [${sort}]: commenting on @${post.author}: "${draft.comment.slice(0, 90)}..."`);
    const ok = await LinkedInService.commentOnFeedCard(post.key, post.href, post.text.slice(0, 80), draft.comment, post.author);
    if (ok) {
      track[post.key] = { ts: new Date().toISOString(), status: "commented" };
      saveTrack(track);
      commented++;
      logger.info(`feedEngage: commented (${commented}/${max} this cycle).`);
    } else {
      logger.warn(`feedEngage: comment post failed on ${post.key} (not tracked, retried next cycle).`);
      skipped++;
    }
  };

  // Phase 1: Top (default feed order), Phase 2: Recent. One comment each per commit.
  for (const sort of ["top", "recent"]) {
    if (commented >= max) break;
    if (commentedToday(track) >= MAX_PER_DAY) break;
    const posts = await LinkedInService.scanFeedPosts({ maxPosts: 6, maxScrolls: 6, sort });
    let engaged = false;
    for (const post of posts) {
      if (commented >= max) break;
      if (commentedToday(track) >= MAX_PER_DAY) break;
      if (track[post.key] && shouldSkipTracked(track, post.key)) { skipped++; continue; }
      await engageOne(post, sort);
      engaged = true;
      break; // one comment per phase
    }
    if (!engaged) logger.info(`feedEngage [${sort}]: no fresh candidate, moving on.`);
    if (commented < max && sort === "top") await sleep(PACE_MS);
  }

  return { commented, skipped, previews, reason: dryRun ? "dry run - nothing posted or tracked" : "" };
}

module.exports = { runFeedEngagement };
