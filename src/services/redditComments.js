/**
 * redditComments.js
 *
 * Comments in Reddit threads from the account logged in to the debug Chrome, called from cron.js after each
 * batch commit (REDDIT_COMMENTS, default on). The goal (docs/reddit-subreddits.md section 0) is to help people
 * and learn their pain points, so a comment answers first, adds one true detail or piece of reasoning, and never
 * mentions a product of ours: plugs are left out entirely (the drafter is told so and a gate rejects one).
 *
 * Each pass: 1 or 2 subs from config/reddit.js (never its avoid list; least recently commented, then least
 * recently read, first), their /new and /rising threads scored (redditScore: fresh under 12 h, few comments so
 * ours is seen, a question; never a megathread, a removed, sensitive or non-English thread), the best opened and
 * read (post and top comments), then llm.draftRedditComment: the shared gates and a judge that fails closed.
 * The same call reports the thread's pain point, appended to data/reddit-painpoints.jsonl.
 *
 * Account safety: at most one comment a pass, REDDIT_COMMENTS_MAX_PER_DAY (6) in a rolling 24 h (2 while the
 * account is under 14 days old or under 20 karma), one per sub a day, one per author a week, 20-40 min between
 * comments (a pass inside that gap does nothing), never twice in a thread. Tracker: data/reddit-comments.json (feedEngage's helpers, reddit:<t3 id> entries), written before the
 * send. Reddit refusing (logged out, suspended, blocked, rate limited, a captcha) pauses the pass 24-48 h.
 */

const fs = require("fs");
const path = require("path");
const llmService = require("./llm");
const RedditService = require("./reddit");
const redditConfig = require("../../config/reddit");
const { isSensitivePost, _tracker: T } = require("./feedEngage");
const { logger, isEnglish, REPO_ROOT } = require("../utils/helpers");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const envInt = (name, def) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const nowIso = () => new Date().toISOString();

// Read per call so tests can point them at a temp dir.
const trackPath = () => process.env.REDDIT_TRACK_PATH || path.join(REPO_ROOT, "data", "reddit-comments.json");
const painPath = () => process.env.REDDIT_PAINPOINTS_PATH || path.join(REPO_ROOT, "data", "reddit-painpoints.jsonl");
const maxPerDay = () => envInt("REDDIT_COMMENTS_MAX_PER_DAY", 6);
const PASS_TIMEOUT_MS = envInt("REDDIT_PASS_TIMEOUT_MS", 15 * MINUTE);
const GAP_MS = [20 * MINUTE, 40 * MINUTE];
const COOLDOWN_MS = [24 * HOUR, 48 * HOUR];
const AUTHOR_GAP_MS = 7 * DAY;
const SUBS_PER_PASS = 2;
const DRAFTS_PER_PASS = 4; // each costs a draft and a judge call
const SUBMIT_MS = 90 * 1000;
// A new account's comments are the first a spam filter removes: 2 a day until it is 14 days old with 20 karma.
const WARMUP = { days: 14, karma: 20, perDay: 2 };

// ---- Scoring ----
const MAX_AGE_H = 12;
const MIN_AGE_H = 0.15; // a comment in the first minutes reads as a bot watching /new
const MAX_COMMENTS = 60; // past this ours is buried
const MIN_SCORE = 4;
const MEGA_RE = /\b(?:weekly|monthly|daily)\b.*\b(?:thread|discussion|post)\b|\bmega ?thread\b|\bshare your (?:startup|project|saas)\b|\bpromote your\b|\bfeedback (?:friday|saturday)\b|\bself[- ]promo|\bshowcase sunday\b|\bproject display\b/i;
const QUESTION_RE = /\?|^(?:how|what|why|which|when|where|should|is|are|does|do|did|can|could|would|any|anyone|has anyone|need|advice|help|looking for)\b/i;

const ageHours = (t, now = Date.now()) => (now - Date.parse(t.created || "")) / HOUR;

// Why a thread gets no comment at all, or "".
function unfit(t, now = Date.now()) {
  if (!t || !/^t3_/.test(t.id || "")) return "no thread";
  if (!t.author || /^\[deleted\]$|^automoderator$/i.test(t.author)) return "deleted or a bot";
  if (/removed|deleted|spam/i.test(t.state || "")) return "removed";
  if (MEGA_RE.test(t.title)) return "a megathread";
  const text = `${t.title} ${t.text || ""}`;
  if ((t.lang && !/^en\b/i.test(t.lang)) || !isEnglish(text)) return "not English";
  if (isSensitivePost(text)) return "sensitive";
  const age = ageHours(t, now);
  if (!(age <= MAX_AGE_H)) return "stale";
  if (age < MIN_AGE_H) return "too fresh";
  if (t.comments > MAX_COMMENTS) return "crowded";
  if (t.score < 0) return "downvoted";
  return "";
}

function redditScore(t, now = Date.now()) {
  if (unfit(t, now)) return -99;
  const age = ageHours(t, now);
  let score = age <= 2 ? 3 : age <= 6 ? 2 : 1;
  score += t.comments <= 15 ? 2 : t.comments <= 40 ? 1 : 0;
  if (QUESTION_RE.test(String(t.title).trim())) score += 2;
  if (t.score >= 3) score += 1;
  return score;
}

// ---- Subs ----
const lower = (s) => String(s || "").toLowerCase();
const AVOID = new Set(redditConfig.avoid.map(lower));
const meta = (track) => (track.meta = track.meta || {});
const subMeta = (track, name) => ((meta(track).subs = meta(track).subs || {})[lower(name)] = meta(track).subs[lower(name)] || {});
const commentedIn = (track, sub, ms, now = Date.now()) => Object.entries(track)
  .some(([k, e]) => k.startsWith("reddit:") && e && lower(e.sub) === lower(sub) && now - Date.parse(T.commentedAtOf(e) || "") < ms);

// The subs this pass reads: not avoided, ones our account qualifies for, not commented in for a day;
// least recently commented first (never first), then least recently read.
function pickSubs(track, me = {}, subs = redditConfig.subreddits, now = Date.now()) {
  const t = (iso) => Date.parse(iso || "") || 0;
  return subs
    .filter((s) => !AVOID.has(lower(s.name)))
    .filter((s) => !(s.minKarma > 0 && !(me.karma >= s.minKarma)) && !(s.minAgeDays > 0 && !(me.ageDays >= s.minAgeDays)))
    .filter((s) => !commentedIn(track, s.name, DAY, now))
    .sort((a, b) => t(subMeta(track, a.name).commentedAt) - t(subMeta(track, b.name).commentedAt)
      || t(subMeta(track, a.name).readAt) - t(subMeta(track, b.name).readAt))
    .slice(0, SUBS_PER_PASS);
}

// ---- Pain-point log ----
const squash = (s) => lower(s).replace(/[^a-z0-9]+/g, " ").trim();
// One JSONL row per thread whose pain one of our products addresses. The quote must be the thread's own words.
function logPain(pain, { sub, url, threadText }) {
  if (!pain || typeof pain !== "object") return false;
  const product = String(pain.product || "");
  const quote = String(pain.quote || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!redditConfig.products.some((p) => p.id === product) || quote.length < 8) return false;
  if (!squash(threadText).includes(squash(quote))) {
    logger.info(`redditComments: pain quote not found in the thread, not logged ("${quote.slice(0, 60)}").`);
    return false;
  }
  const row = { ts: nowIso(), sub, url, quote, product, note: String(pain.note || "").replace(/\s+/g, " ").trim().slice(0, 200) };
  try {
    fs.mkdirSync(path.dirname(painPath()), { recursive: true });
    fs.appendFileSync(painPath(), `${JSON.stringify(row)}\n`);
    return true;
  } catch (e) {
    logger.warn(`redditComments: could not append the pain point: ${e.message}`);
    return false;
  }
}

// ---- The pass ----
const keyOf = (t) => `reddit:${t.id}`;
const asTracked = (t) => ({ key: keyOf(t), href: t.author ? `https://www.reddit.com/user/${t.author}` : "" });
const cooldownLeft = (track) => {
  const until = Date.parse(((track && track.cooldowns) || {}).reddit || "");
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
};
let offForRun = "";
const offError = (why) => Object.assign(new Error(why), { code: "REDDIT_OFF" });
let service = null;

/**
 * One Reddit comment pass: at most `max` comments (cron asks for 1; the 20-40 min gap allows no second one
 * anyway), never fatal to the run. Returns { commented, skipped, pains, reason }.
 */
async function runRedditPass({ reddit = null, max = 1, shouldStop = () => false } = {}) {
  const tag = "redditComments";
  const out = { commented: 0, skipped: 0, pains: 0, reason: "" };
  if (offForRun) return { ...out, reason: `reddit comments off (${offForRun})` };
  const file = trackPath();
  const track = T.loadTrack(file);
  if (track.disabled) return { ...out, reason: `reddit comments off (${track.disabled})` };
  if (cooldownLeft(track)) return { ...out, reason: `reddit unavailable (paused until ${track.cooldowns.reddit})` };
  T.pruneTrack(track);
  let cap = maxPerDay();
  const capHit = () => T.commentedSince(track, DAY) >= cap;
  if (capHit()) return { ...out, reason: `daily cap (${cap}) reached` };
  const tooSoon = () => Date.parse(meta(track).nextAt || "") > Date.now();
  if (tooSoon()) return { ...out, reason: `next comment not before ${meta(track).nextAt}` };
  reddit = reddit || (service = service || new RedditService());

  const save = () => T.saveTrack(track, file);
  const saveOrStop = () => { if (!save()) { offForRun = "tracker save failed"; throw offError("tracker save failed after a comment"); } };
  const mark = (t, fields) => T.markPost(track, asTracked(t), { ts: nowIso(), sub: t.sub, url: t.url || "", ...fields });
  const ctx = { aborted: false, drafts: 0, deadline: Date.now() + PASS_TIMEOUT_MS };
  const done = () => ctx.aborted || shouldStop() || out.commented >= max || capHit() || tooSoon() || ctx.drafts >= DRAFTS_PER_PASS;

  const commentOne = async (sub, thread) => {
    const page = await reddit.openThread(thread);
    if (!page) { out.skipped++; return logger.warn(`${tag}: ${thread.permalink} did not render - not tracked, tried again later.`); }
    const t = { ...thread, ...page, sub: sub.name };
    if (page.ours) {
      mark(t, { status: "commented", commentedAt: nowIso(), skipReason: "our earlier comment found in the thread" });
      saveOrStop();
      out.skipped++;
      return logger.info(`${tag}: r/${sub.name} thread already has our comment - skipping.`);
    }
    if (!page.composer || unfit(t)) {
      mark(t, { status: "skipped", skipReason: page.composer ? `thread ${unfit(t)}` : "locked, archived or closed to us" });
      save();
      out.skipped++;
      return;
    }
    ctx.drafts++;
    let draft;
    try {
      draft = await llmService.draftRedditComment({
        sub: sub.name, note: sub.note, products: redditConfig.products,
        post: { title: t.title, text: t.text, author: t.author, ageH: ageHours(t), score: t.score, comments: t.comments },
        comments: page.top.map((c) => `u/${c.author || "someone"} (${c.score} points): ${c.text}`).join("\n\n"),
        recent: T.recentComments(track),
      });
    } catch (e) {
      if (e.code === "PASS_TIME_UP") { ctx.aborted = true; out.reason = "the pass's time is nearly up"; out.skipped++; return; }
      if (e.code === "CLAUDE_STOPPED") throw e;
      out.skipped++;
      return logger.warn(`${tag}: draft failed for ${t.url}: ${e.message}`);
    }
    if (logPain(draft.pain, { sub: sub.name, url: t.url, threadText: `${t.title}\n${t.text}\n${page.top.map((c) => c.text).join("\n")}` })) out.pains++;
    for (const c of draft.candidates || []) logger.info(`${tag}: candidate [${c.angle}] "${c.comment}" -> ${c.gate && c.gate.length ? `gates: ${c.gate.join("; ")}` : c.judge ? `judge: ${c.judge.pass ? "PASS" : "FAIL"} ${c.judge.reason}` : "not judged"}`);
    if (ctx.aborted || shouldStop()) return;
    if (draft.skipped || !draft.isValid) {
      mark(t, { status: draft.skipped ? "skipped" : "rejected", skipReason: (draft.errors || []).join("; ").slice(0, 200) || "skip" });
      save();
      out.skipped++;
      return logger.info(`${tag}: no comment in r/${sub.name} "${t.title.slice(0, 60)}" (${draft.skipped ? "skip" : "rejected"}: ${(draft.errors || []).join("; ").slice(0, 160)}).`);
    }
    logger.info(`${tag}: commenting in r/${sub.name} "${t.title.slice(0, 60)}" (score ${thread.rank}, ${t.comments} comments, ${Math.round(ageHours(t) * 10) / 10}h old): "${draft.comment}"`);
    // Marked before the send: a run killed mid-send never comments in this thread a second time.
    const at = nowIso();
    mark(t, { status: "commented", commentedAt: at, comment: draft.comment.slice(0, 600), unverified: true });
    // The gap starts now, whatever the send's outcome.
    meta(track).nextAt = new Date(Date.now() + jitter(...GAP_MS)).toISOString();
    subMeta(track, sub.name).commentedAt = at;
    saveOrStop();
    const res = await reddit.postComment(t, draft.comment);
    if (res.status === "posted" || res.status === "uncertain") {
      if (res.status === "posted") { delete track[keyOf(t)].unverified; saveOrStop(); }
      out.commented++;
      return logger.info(`${tag}: commented (${T.commentedSince(track, DAY)}/${cap} today)${res.status === "uncertain" ? ` [unverified: ${res.reason}]` : ""}.`);
    }
    // Nothing was sent: the thread goes to "rejected" (it is stale before that expires), a closed one to "skipped".
    const closed = res.reason === "no-composer";
    track[keyOf(t)] = { ts: nowIso(), status: closed ? "skipped" : "rejected", sub: sub.name, url: t.url, authorHref: track[keyOf(t)].authorHref, skipReason: `comment not sent: ${res.reason}`.slice(0, 200) };
    saveOrStop();
    out.skipped++;
    if (res.unavailable) throw Object.assign(new Error(res.reason), { code: "REDDIT_UNAVAILABLE" });
    if (!closed) { ctx.aborted = true; out.reason = `comment not sent (${res.reason})`; }
    logger.warn(`${tag}: comment in r/${sub.name} not sent (${res.reason}).`);
  };

  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ctx.deadline - Date.now());
    if (timer.unref) timer.unref();
  });
  const run = (async () => {
    llmService.commentDeadline = ctx.deadline - SUBMIT_MS;
    await reddit.ensureDriverConnected();
    const me = await reddit.me();
    if (!(me.ageDays >= WARMUP.days && me.karma >= WARMUP.karma)) cap = Math.min(cap, WARMUP.perDay);
    if (capHit()) { out.reason = `daily cap (${cap}, a new account) reached`; return; }
    const subs = pickSubs(track, me);
    if (!subs.length) { out.reason = "every sub commented in today"; return; }
    for (const sub of subs) {
      if (done()) break;
      let threads;
      try {
        threads = await reddit.listThreads(sub.name);
      } catch (e) {
        if (e.code === "REDDIT_UNAVAILABLE") throw e;
        logger.warn(`${tag} [r/${sub.name}]: listing failed: ${e.message}`);
        continue;
      }
      subMeta(track, sub.name).readAt = nowIso();
      save();
      const ranked = threads.map((t) => ({ ...t, sub: sub.name, rank: redditScore(t) }))
        .filter((t) => t.rank >= MIN_SCORE && !T.shouldSkipTracked(track, keyOf(t)))
        .sort((a, b) => b.rank - a.rank);
      logger.info(`${tag} [r/${sub.name}]: ${threads.length} threads read, ${ranked.length} worth a comment${ranked.length ? ` (best: ${ranked.slice(0, 3).map((t) => `"${t.title.slice(0, 40)}" ${t.rank}`).join(", ")})` : ""}.`);
      for (const thread of ranked.slice(0, 2)) {
        if (done()) break;
        if (T.authorDid(track, asTracked(thread).href, T.commentedAtOf, AUTHOR_GAP_MS)) continue;
        await commentOne(sub, thread);
      }
    }
  })();
  run.catch(() => {}); // a body still running after a time-out must not raise an unhandled rejection
  try {
    if ((await Promise.race([run.then(() => "done"), timedOut])) === "timeout") {
      ctx.aborted = true;
      offForRun = "a pass timed out";
      out.reason = `reddit comments off (pass timed out after ${Math.round(PASS_TIMEOUT_MS / MINUTE)} min)`;
      logger.error(`${tag}: ${out.reason}; releasing the Reddit browser session.`);
      await reddit.cleanup({ closeTab: false }).catch(() => {});
    }
  } catch (e) {
    ctx.aborted = true;
    if (e.code === "REDDIT_UNAVAILABLE") {
      const until = new Date(Date.now() + jitter(...COOLDOWN_MS)).toISOString();
      track.cooldowns = { ...(track.cooldowns || {}), reddit: until };
      save();
      out.reason = `reddit unavailable (${e.message}); comments paused until ${until}`;
      logger.error(`${tag}: ${out.reason}.`);
    } else if (e.code === "REDDIT_OFF") {
      out.reason = `reddit comments off (${e.message})`;
    } else {
      throw e;
    }
  } finally {
    clearTimeout(timer);
    llmService.commentDeadline = 0;
  }
  if (!out.reason && out.commented < max) out.reason = "nothing worth a comment";
  return out;
}

// Releases the browser session at the end of a run.
async function cleanup() {
  if (service) await service.cleanup();
}

module.exports = { runRedditPass, redditScore, pickSubs, logPain, cleanup, _reset: () => { offForRun = ""; } };
