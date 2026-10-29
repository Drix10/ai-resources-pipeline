/**
 * xReplies.js
 *
 * Replies under other people's posts on X, the twin of the LinkedIn comment passes (feedEngage.js), called
 * from cron.js's engagement loop, each pass at most every ~25 min (X_REPLIES, default on):
 *  - runXReplyPass({ viral: false }): 2 or 3 replies on fresh posts with real momentum
 *  - runXReplyPass({ viral: true }):  1 or 2 more on posts going viral, early in their rise, on their own cap
 *
 * Sources: the home timeline's "For you" and "Following" tabs, and one of the curated X lists the pipeline
 * reads. Every post is scored (xScore / xViralScore: fresh, engagement per hour, room in its replies; never an
 * ad, a reply, our own post, a non-English, sensitive, bait or promo post); the best get a draft that has read
 * the replies already there (llm.draftXReply: the shared gates, repeat memory and a judge that fails closed).
 *
 * Tracker: data/x-replies.json, the LinkedIn tracker's shape and helpers (x:<post id> entries, never twice,
 * rolling 24 h caps, one reply per author a week, 2 days on the viral pass). An entry is written before the
 * send, so a run killed mid-send never replies twice. X refusing (logged out, locked, rate limited) pauses
 * both passes for hours; a pass that hangs is cut off and X replies stay off for the run.
 */

const path = require("path");
const config = require("../../config");
const llmService = require("./llm");
const TwitterService = require("./twitter");
const { isSensitivePost, _tracker: T } = require("./feedEngage");
const { logger, sleep, isEnglish, REPO_ROOT } = require("../utils/helpers");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const envInt = (name, def) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const nowIso = () => new Date().toISOString();

// Read per call so tests can point X_REPLIES_TRACK_PATH at a temp dir.
const trackPath = () => process.env.X_REPLIES_TRACK_PATH || path.join(REPO_ROOT, "data", "x-replies.json");
const MAX_PER_DAY = envInt("X_REPLIES_MAX_PER_DAY", 20); // regular replies, rolling 24 h
const VIRAL_MAX_PER_DAY = envInt("X_REPLIES_VIRAL_MAX_PER_DAY", 8); // on top of MAX_PER_DAY
const PASS_TIMEOUT_MS = envInt("X_PASS_TIMEOUT_MS", 15 * 60 * 1000);
const AUTHOR_GAP_MS = 7 * DAY;
const VIRAL_AUTHOR_GAP_MS = 2 * DAY;
const COOLDOWN_MS = [6 * HOUR, 12 * HOUR];
// What sending the last reply needs after its draft: the LLM calls end this long before the guard.
const SUBMIT_MS = 90 * 1000;

// ---- Scoring ----
// A reply is read when it lands early under a post people are reading now: freshness and engagement per
// hour (likes, reposts twice, views /100: twitter.js engagementPerHour) carry the score, room in its replies
// adds to it. X_MIN+ gets a draft; the viral pass wants a crowd already (VIRAL_MIN_RATE an hour or
// VIRAL_MIN_LIKES) and X_VIRAL_MIN+.
const X_MIN = 3;
const MAX_AGE_H = 24;
const X_VIRAL_MIN = 6;
const VIRAL_MAX_AGE_H = 12;
const VIRAL_MIN_RATE = 300;
const VIRAL_MIN_LIKES = 2000;
const MIN_WORDS = 8;

const ageHours = (post, now = Date.now()) => TwitterService.tweetAgeMs(post.tweetId, post.timestamp, now) / HOUR;

// Why a post gets no reply at all, or "".
function unfit(post, ownHandle = "", maxAgeH = MAX_AGE_H, now = Date.now()) {
  if (!post || !post.tweetId) return "no post";
  if (post.isAd) return "promoted";
  if (post.isReply) return "a reply";
  if (TwitterService.sameHandle(post.handle, ownHandle)) return "our own post";
  const text = String(post.mainText || "");
  if ((post.lang && !/^en\b/i.test(post.lang)) || !isEnglish(text)) return "not English";
  if (text.split(/\s+/).filter(Boolean).length < MIN_WORDS) return "thin";
  if (isSensitivePost(post.text) || TwitterService.classifyTweetText(post.text)) return "sensitive, bait or promo";
  const age = ageHours(post, now);
  if (!(age <= maxAgeH)) return "stale";
  return "";
}

function xScore(post, ownHandle = "", now = Date.now()) {
  if (unfit(post, ownHandle, MAX_AGE_H, now)) return -99;
  const age = ageHours(post, now);
  const rate = TwitterService.engagementPerHour(post, now);
  const replies = Number(post.replies) || 0;
  let score = age <= 1 ? 3 : age <= 3 ? 2 : age <= 8 ? 1 : 0;
  score += rate >= 200 ? 3 : rate >= 50 ? 2 : rate >= 10 ? 1 : rate < 2 ? -2 : 0;
  // A crowd of thousands buries a reply: that is the viral pass's job.
  score += replies < 20 ? 1 : replies > 300 ? -1 : 0;
  return score;
}

function xViralScore(post, ownHandle = "", now = Date.now()) {
  if (unfit(post, ownHandle, VIRAL_MAX_AGE_H, now)) return -99;
  const age = ageHours(post, now);
  const rate = TwitterService.engagementPerHour(post, now);
  const replies = Number(post.replies) || 0;
  if (rate < VIRAL_MIN_RATE && (Number(post.likes) || 0) < VIRAL_MIN_LIKES) return 0;
  let score = age <= 1 ? 4 : age <= 3 ? 3 : age <= 6 ? 2 : 1;
  score += rate >= 3000 ? 4 : rate >= 1000 ? 3 : rate >= 300 ? 2 : 0;
  score += replies < 50 ? 2 : replies < 300 ? 1 : replies > 2000 ? -2 : 0;
  return score;
}

// ---- Sources ----
const HOME_TABS = [
  { label: "home:for-you", url: "https://x.com/home", tab: "For you" },
  { label: "home:following", url: "https://x.com/home", tab: "Following" },
];
// The viral pass reads "For you" first (X's own pick of what is spreading); then a random curated list.
function buildSources(viral = false) {
  const tabs = viral || Math.random() < 0.5 ? HOME_TABS : [...HOME_TABS].reverse();
  const lists = config.folders.flatMap((f) => f.lists || []);
  const listId = lists[Math.floor(Math.random() * lists.length)];
  return listId ? [...tabs, { label: `list:${listId}`, url: `https://x.com/i/lists/${listId}` }] : tabs;
}

// ---- Tracker ----
const keyOf = (post) => `x:${post.tweetId}`;
const asTracked = (post) => ({ key: keyOf(post), href: post.handle ? `https://x.com/${post.handle}` : "" });
const cooldownLeft = (track) => {
  const until = Date.parse(((track && track.cooldowns) || {}).x || "");
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
};
// Off for the rest of this process's run (a pass that hung, a tracker that could not be saved).
let offForRun = "";
const offError = (why) => Object.assign(new Error(why), { code: "X_REPLIES_OFF" });

/**
 * One X reply pass: up to `max` replies (2-3 regular, 1-2 viral from cron), never fatal to the run.
 * twitter: cron's TwitterService instance (its one X tab). Returns { replied, skipped, reason }.
 */
async function runXReplyPass({ twitter, max = 2, viral = false, shouldStop = () => false } = {}) {
  const tag = viral ? "xReplies viral" : "xReplies";
  const out = { replied: 0, skipped: 0, reason: "" };
  if (offForRun) return { ...out, reason: `x replies off (${offForRun})` };
  const file = trackPath();
  const track = T.loadTrack(file);
  if (track.disabled) return { ...out, reason: `x replies off (${track.disabled})` };
  if (cooldownLeft(track)) return { ...out, reason: `x unavailable (cooldown until ${track.cooldowns.x})` };
  T.pruneTrack(track);
  const cap = viral ? VIRAL_MAX_PER_DAY : MAX_PER_DAY;
  const capHit = () => T.commentedSince(track, DAY, { viral }) >= cap;
  if (capHit()) return { ...out, reason: `daily ${viral ? "viral " : ""}cap (${cap}) reached` };

  const save = () => T.saveTrack(track, file);
  // After a public action the tracker must persist, or the passes stop rather than act with no memory of it.
  const saveOrStop = () => { if (!save()) { offForRun = "tracker save failed"; throw offError("tracker save failed after a reply"); } };
  const mark = (post, fields) => T.markPost(track, asTracked(post), { ts: nowIso(), pass: viral ? "viral" : "reply", ...fields });
  // The regular pass's own rejection (its stricter peer gates) does not bar the viral pass; anything else does.
  const tracked = (post) => {
    const e = T.entryOfPost(track, asTracked(post));
    if (viral && e.status === "rejected" && e.pass !== "viral") return false;
    return T.shouldSkipTracked(track, keyOf(post));
  };
  const [score, minScore] = viral ? [xViralScore, X_VIRAL_MIN] : [xScore, X_MIN];
  const ctx = { aborted: false, deadline: Date.now() + (viral ? 2 : 1) * PASS_TIMEOUT_MS };
  const done = () => ctx.aborted || shouldStop() || out.replied >= max || capHit();

  const replyOne = async (post) => {
    const page = await twitter.openPost(post);
    if (!page) { out.skipped++; return logger.warn(`${tag}: ${post.url} did not render - not tracked, tried again later.`); }
    if (page.ours) {
      mark(post, { status: "commented", commentedAt: nowIso(), ...(viral ? { viral: true } : {}), skipReason: "our earlier reply found on the post" });
      saveOrStop();
      out.skipped++;
      return logger.info(`${tag}: @${post.handle}'s post already has our reply - skipping.`);
    }
    const full = page.post;
    let draft;
    try {
      draft = await llmService.draftXReply({
        post: { author: post.handle, text: full.text || post.text, ageH: ageHours(post), likes: post.likes, reposts: post.reposts, replies: post.replies },
        replies: page.replies.map((r) => `@${r.handle || "someone"}: ${r.mainText}`).join("\n\n"),
        recent: T.recentComments(track),
        viral,
      });
    } catch (e) {
      if (e.code === "PASS_TIME_UP") { ctx.aborted = true; out.reason = "the pass's time is nearly up"; out.skipped++; return; }
      if (e.code === "CLAUDE_STOPPED") throw e;
      // A failed call (network, LLM down): untracked, tried again later.
      out.skipped++;
      return logger.warn(`${tag}: draft failed for ${post.url}: ${e.message}`);
    }
    for (const c of draft.candidates || []) logger.info(`${tag}: candidate [${c.angle}] "${c.comment}" -> ${c.gate && c.gate.length ? `gates: ${c.gate.join("; ")}` : c.judge ? `judge: ${c.judge.pass ? "PASS" : "FAIL"} ${c.judge.reason}` : "not judged"}`);
    // A stop or a time-out that came while drafting sends nothing.
    if (ctx.aborted || shouldStop()) return;
    if (draft.skipped || !draft.isValid) {
      // A SKIP is the post's problem (30 days); a rejected draft is ours (3 days).
      mark(post, { status: draft.skipped ? "skipped" : "rejected", skipReason: (draft.errors || []).join("; ").slice(0, 200) || "skip" });
      save();
      out.skipped++;
      return logger.info(`${tag}: no reply to @${post.handle} (${draft.skipped ? "skip" : "rejected"}: ${(draft.errors || []).join("; ").slice(0, 160)}).`);
    }
    logger.info(`${tag}: replying to @${post.handle} (score ${post.score}, ${post.likes || 0} likes, ${post.replies || 0} replies, ${Math.round(ageHours(post))}h old): "${draft.comment}"`);
    // Marked before the send: a run killed mid-send never replies to this post a second time.
    const at = nowIso();
    mark(post, { status: "commented", commentedAt: at, comment: draft.comment.slice(0, 300), unverified: true, ...(viral ? { viral: true } : {}) });
    saveOrStop();
    const res = await twitter.replyToPost(full, draft.comment);
    if (res.status === "posted" || res.status === "uncertain") {
      // A sent reply is never retried: uncertain stays unverified.
      if (res.status === "posted") { delete track[keyOf(post)].unverified; saveOrStop(); }
      out.replied++;
      return logger.info(`${tag}: replied (${out.replied}/${max} this pass, ${T.commentedSince(track, DAY, { viral })}/${cap} today)${res.status === "uncertain" ? ` [unverified: ${res.reason}]` : ""}.`);
    }
    // Nothing was sent: the entry goes back to a 3-day "rejected" (a post whose replies are limited, 30 days).
    const closed = res.reason === "no-composer";
    track[keyOf(post)] = { ts: nowIso(), status: closed ? "skipped" : "rejected", pass: viral ? "viral" : "reply", authorHref: track[keyOf(post)].authorHref, skipReason: `reply not sent: ${res.reason}`.slice(0, 200) };
    saveOrStop();
    out.skipped++;
    // X refusing one reply usually means it is throttling the account: no more this pass.
    if (!closed) { ctx.aborted = true; out.reason = `reply not sent (${res.reason})`; }
    logger.warn(`${tag}: reply to @${post.handle} not sent (${res.reason}).`);
  };

  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ctx.deadline - Date.now());
    if (timer.unref) timer.unref();
  });
  const run = (async () => {
    // The pass's LLM calls end before its guard does, with time left to send the last reply.
    llmService.commentDeadline = ctx.deadline - SUBMIT_MS;
    await twitter.ensureDriverConnected();
    for (const src of buildSources(viral)) {
      if (done()) break;
      let posts;
      try {
        posts = await twitter.scanTimeline(src);
      } catch (e) {
        if (e.code === "X_UNAVAILABLE") throw e;
        logger.warn(`${tag} [${src.label}]: scan failed: ${e.message}`);
        continue;
      }
      const own = await twitter.ownHandle();
      const ranked = posts.map((p) => ({ ...p, score: score(p, own) }))
        .filter((p) => p.score >= minScore && !tracked(p))
        .sort((a, b) => b.score - a.score);
      logger.info(`${tag} [${src.label}]: ${posts.length} posts read, ${ranked.length} worth a reply${ranked.length ? ` (best: ${ranked.slice(0, 3).map((p) => `@${p.handle} ${p.score}`).join(", ")})` : ""}.`);
      const authors = new Set();
      for (const post of ranked) {
        if (done()) break;
        const href = asTracked(post).href;
        if (authors.has(href) || T.authorDid(track, href, T.commentedAtOf, viral ? VIRAL_AUTHOR_GAP_MS : AUTHOR_GAP_MS)) continue;
        authors.add(href);
        const before = out.replied;
        await replyOne(post);
        // Paced like the LinkedIn comments; only a sent reply waits.
        if (out.replied > before && !done()) {
          const end = Date.now() + jitter(60000, 180000);
          while (!shouldStop() && !ctx.aborted && Date.now() < end) await sleep(Math.min(1000, end - Date.now()));
        }
      }
    }
  })();
  run.catch(() => {}); // a body still running after a time-out must not raise an unhandled rejection
  try {
    if ((await Promise.race([run.then(() => "done"), timedOut])) === "timeout") {
      ctx.aborted = true;
      offForRun = "a pass timed out";
      out.reason = `x replies off (${viral ? "viral " : ""}pass timed out after ${Math.round((viral ? 2 : 1) * PASS_TIMEOUT_MS / 60000)} min)`;
      logger.error(`${tag}: ${out.reason}; releasing the X browser session.`);
      await twitter.cleanup({ closeTab: false }).catch(() => {});
    }
  } catch (e) {
    ctx.aborted = true;
    if (e.code === "X_UNAVAILABLE") {
      const until = new Date(Date.now() + jitter(...COOLDOWN_MS)).toISOString();
      track.cooldowns = { ...(track.cooldowns || {}), x: until };
      save();
      out.reason = `x unavailable (${e.message}); replies paused until ${until}`;
      logger.error(`${tag}: ${out.reason}.`);
    } else if (e.code === "X_REPLIES_OFF") {
      out.reason = `x replies off (${e.message})`;
    } else {
      throw e;
    }
  } finally {
    clearTimeout(timer);
    llmService.commentDeadline = 0;
  }
  if (!out.reason && out.replied < max) out.reason = "sources exhausted";
  return out;
}

module.exports = { runXReplyPass, xScore, xViralScore, buildSources, _reset: () => { offForRun = ""; } };
