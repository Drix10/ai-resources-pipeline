/**
 * hnComments.js
 *
 * Comments in Hacker News threads from the account logged in to the debug Chrome, called from cron.js's
 * engagement loop (HN_COMMENTS, default on). HN bans generated comments and its readers spot them fast, so the
 * bar is the highest of the sites: a comment adds one technical point the thread lacks, in plain prose, or none
 * goes out. Never a plug of anything of ours.
 *
 * Each pass: the front page (HN's API) scored by hnScore (on our field: AI, ML, dev tools, infra, startups;
 * 1-10 h old; 5-150 comments so ours is seen; never Ask/Show HN hiring posts, politics or tragedies), the best
 * thread read with its linked page, then llm.draftHnComment: the shared gates and a strict judge in HN's register.
 *
 * Account safety: at most one comment a pass, HN_COMMENTS_MAX_PER_DAY (3) in a rolling 24 h (1 while the account
 * is under 30 days old or under 50 karma), 45-90 min between comments, never twice in a thread, one per story
 * author a week. Tracker: data/hn-comments.json (feedEngage's helpers, hn:<id> entries), written before the send.
 * HN refusing (logged out, "posting too fast", a ban) pauses the pass 24-48 h.
 */

const path = require("path");
const llmService = require("./llm");
const HnService = require("./hn");
const { fetchPage } = require("../utils/pageFetch");
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

const trackPath = () => process.env.HN_TRACK_PATH || path.join(REPO_ROOT, "data", "hn-comments.json");
const maxPerDay = () => envInt("HN_COMMENTS_MAX_PER_DAY", 3);
const PASS_TIMEOUT_MS = envInt("HN_PASS_TIMEOUT_MS", 15 * MINUTE);
const GAP_MS = [45 * MINUTE, 90 * MINUTE];
const COOLDOWN_MS = [24 * HOUR, 48 * HOUR];
const AUTHOR_GAP_MS = 7 * DAY;
const DRAFTS_PER_PASS = 3; // each costs a draft and a judge call
const SUBMIT_MS = 90 * 1000;
// HN's filters weigh a new or low-karma account's comments hardest: 1 a day until it is 30 days old with 50 karma.
const WARMUP = { days: 30, karma: 50, perDay: 1 };

// ---- Scoring ----
const MIN_AGE_H = 1; // the first hour's comments decide a thread's tone; ours lands after it
const MAX_AGE_H = 10;
const MIN_COMMENTS = 5;
const MAX_COMMENTS = 150; // past this ours is buried
const MIN_SCORE = 4;
const FIELD_RE = /\b(?:ai|a\.i\.|llms?|gpt|claude|gemini|openai|anthropic|deepmind|mistral|llama|qwen|deepseek|model|models|inference|training|fine-?tun\w*|agents?|agentic|neural|transformer|diffusion|embedding\w*|rag|ml|machine learning|deep learning|gpu|cuda|nvidia|tpu|compiler|database|postgres|sqlite|rust|python|typescript|javascript|kubernetes|open[- ]source|api|sdk|startup|founder|yc|vc|funding|robot\w*|self-driving|autonomous|quantum|chip|semiconductor|benchmark|eval\w*|prompt\w*|coding|programmer\w*|developer\w*)\b/i;
const OFF_RE = /\bis hiring\b|\bwho is hiring\b|\bwho wants to be hired\b|\bfreelancer\?/i;

const ageHours = (s, now = Date.now()) => (now - Date.parse(s.created || "")) / HOUR;

// Why a story gets no comment at all, or "".
function unfit(s, now = Date.now()) {
  if (!s || !/^\d+$/.test(s.id || "")) return "no story";
  if (OFF_RE.test(s.title)) return "a hiring thread";
  const text = `${s.title} ${s.text || ""}`;
  if (!isEnglish(text)) return "not English";
  if (isSensitivePost(text)) return "sensitive";
  if (!FIELD_RE.test(text)) return "outside our field";
  const age = ageHours(s, now);
  if (!(age <= MAX_AGE_H)) return "stale";
  if (age < MIN_AGE_H) return "too fresh";
  if (s.comments < MIN_COMMENTS) return "too quiet";
  if (s.comments > MAX_COMMENTS) return "crowded";
  return "";
}

function hnScore(s, now = Date.now()) {
  if (unfit(s, now)) return -99;
  const age = ageHours(s, now);
  let score = age <= 4 ? 3 : age <= 7 ? 2 : 1;
  score += s.comments <= 40 ? 2 : s.comments <= 90 ? 1 : 0;
  if (s.points >= 50) score += 1;
  if (/^(?:ask|show) hn\b/i.test(s.title)) score += 1; // an asker or maker reads every comment
  return score;
}

// ---- The pass ----
const keyOf = (s) => `hn:${s.id}`;
// normHref drops a query string, so the author key is a path.
const asTracked = (s) => ({ key: keyOf(s), href: s.author ? `https://news.ycombinator.com/user/${s.author}` : "" });
const meta = (track) => (track.meta = track.meta || {});
const cooldownLeft = (track) => {
  const until = Date.parse(((track && track.cooldowns) || {}).hn || "");
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
};
let offForRun = "";
const offError = (why) => Object.assign(new Error(why), { code: "HN_OFF" });
let service = null;

// { karma, ageDays } of an HN account from HN's public API; NaNs when it cannot be read (the warm-up cap applies).
async function account(name) {
  try {
    const res = await fetch(`https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(name)}.json`);
    const u = (await res.json()) || {};
    return { karma: Number(u.karma), ageDays: u.created ? (Date.now() / 1000 - u.created) / 86400 : NaN };
  } catch {
    return { karma: NaN, ageDays: NaN };
  }
}

/**
 * One HN comment pass: at most `max` comments, never fatal to the run. Returns { commented, skipped, reason }.
 * `hn` and `api` ({ frontPage, readThread, account, fetchPage }) are for tests.
 */
async function runHnPass({ hn = null, api = {}, max = 1, shouldStop = () => false } = {}) {
  const tag = "hnComments";
  const out = { commented: 0, skipped: 0, reason: "" };
  if (offForRun) return { ...out, reason: `hn comments off (${offForRun})` };
  const { frontPage = HnService.frontPage, readThread = HnService.readThread, account: accountOf = account, fetchPage: readPage = fetchPage } = api;
  const file = trackPath();
  const track = T.loadTrack(file);
  if (track.disabled) return { ...out, reason: `hn comments off (${track.disabled})` };
  if (cooldownLeft(track)) return { ...out, reason: `hn unavailable (paused until ${track.cooldowns.hn})` };
  T.pruneTrack(track);
  let cap = maxPerDay();
  const capHit = () => T.commentedSince(track, DAY) >= cap;
  if (capHit()) return { ...out, reason: `daily cap (${cap}) reached` };
  const tooSoon = () => Date.parse(meta(track).nextAt || "") > Date.now();
  if (tooSoon()) return { ...out, reason: `next comment not before ${meta(track).nextAt}` };
  hn = hn || (service = service || new HnService());

  const save = () => T.saveTrack(track, file);
  const saveOrStop = () => { if (!save()) { offForRun = "tracker save failed"; throw offError("tracker save failed after a comment"); } };
  const mark = (s, fields) => T.markPost(track, asTracked(s), { ts: nowIso(), url: `https://news.ycombinator.com/item?id=${s.id}`, ...fields });
  const ctx = { aborted: false, drafts: 0, deadline: Date.now() + PASS_TIMEOUT_MS };
  const done = () => ctx.aborted || shouldStop() || out.commented >= max || capHit() || tooSoon() || ctx.drafts >= DRAFTS_PER_PASS;

  const commentOne = async (story, me) => {
    let t;
    try {
      t = await readThread(story.id, me);
    } catch (e) {
      out.skipped++;
      return logger.warn(`${tag}: thread ${story.id} could not be read (${e.message}) - tried again later.`);
    }
    t = { ...story, ...t, comments: story.comments };
    if (t.ours) {
      mark(t, { status: "commented", commentedAt: nowIso(), skipReason: "our earlier comment found in the thread" });
      saveOrStop();
      out.skipped++;
      return logger.info(`${tag}: "${t.title.slice(0, 60)}" already has our comment - skipping.`);
    }
    if (!t.open || unfit(t)) {
      mark(t, { status: "skipped", skipReason: t.open ? `story ${unfit(t)}` : "closed to comments" });
      save();
      out.skipped++;
      return;
    }
    const page = t.url ? await readPage(t.url).catch(() => null) : null;
    ctx.drafts++;
    let draft;
    try {
      draft = await llmService.draftHnComment({
        story: { title: t.title, text: t.text, url: t.url, author: t.author, ageH: ageHours(t), points: t.points, comments: t.comments },
        page: page ? page.text : "",
        comments: t.top.map((c) => `${c.author}: ${c.text}`).join("\n\n"),
        recent: T.recentComments(track),
      });
    } catch (e) {
      if (e.code === "PASS_TIME_UP") { ctx.aborted = true; out.reason = "the pass's time is nearly up"; out.skipped++; return; }
      if (e.code === "CLAUDE_STOPPED") throw e;
      out.skipped++;
      return logger.warn(`${tag}: draft failed for ${t.id}: ${e.message}`);
    }
    for (const c of draft.candidates || []) logger.info(`${tag}: candidate [${c.angle}] "${c.comment}" -> ${c.gate && c.gate.length ? `gates: ${c.gate.join("; ")}` : c.judge ? `judge: ${c.judge.pass ? "PASS" : "FAIL"} ${c.judge.reason}` : "not judged"}`);
    if (ctx.aborted || shouldStop()) return;
    if (draft.skipped || !draft.isValid) {
      mark(t, { status: draft.skipped ? "skipped" : "rejected", skipReason: (draft.errors || []).join("; ").slice(0, 200) || "skip" });
      save();
      out.skipped++;
      return logger.info(`${tag}: no comment on "${t.title.slice(0, 60)}" (${draft.skipped ? "skip" : "rejected"}: ${(draft.errors || []).join("; ").slice(0, 160)}).`);
    }
    logger.info(`${tag}: commenting on "${t.title.slice(0, 60)}" (score ${story.rank}, ${t.comments} comments, ${Math.round(ageHours(t) * 10) / 10}h old): "${draft.comment}"`);
    // Marked before the send: a run killed mid-send never comments in this thread a second time.
    mark(t, { status: "commented", commentedAt: nowIso(), comment: draft.comment.slice(0, 900), unverified: true });
    meta(track).nextAt = new Date(Date.now() + jitter(...GAP_MS)).toISOString();
    saveOrStop();
    const res = await hn.postComment(t, draft.comment);
    if (res.status === "posted" || res.status === "uncertain") {
      if (res.status === "posted") { delete track[keyOf(t)].unverified; saveOrStop(); }
      out.commented++;
      return logger.info(`${tag}: commented (${T.commentedSince(track, DAY)}/${cap} today)${res.status === "uncertain" ? ` [unverified: ${res.reason}]` : ""}.`);
    }
    const closed = res.reason === "no-form";
    track[keyOf(t)] = { ts: nowIso(), status: closed ? "skipped" : "rejected", url: track[keyOf(t)].url, authorHref: track[keyOf(t)].authorHref, skipReason: `comment not sent: ${res.reason}`.slice(0, 200) };
    saveOrStop();
    out.skipped++;
    if (res.unavailable) throw Object.assign(new Error(res.reason), { code: "HN_UNAVAILABLE" });
    if (!closed) { ctx.aborted = true; out.reason = `comment not sent (${res.reason})`; }
    logger.warn(`${tag}: comment on ${t.id} not sent (${res.reason}).`);
  };

  let timer = null;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ctx.deadline - Date.now());
    if (timer.unref) timer.unref();
  });
  const run = (async () => {
    llmService.commentDeadline = ctx.deadline - SUBMIT_MS;
    await hn.ensureDriverConnected();
    const me = await hn.me();
    const acct = await accountOf(me);
    if (!(acct.ageDays >= WARMUP.days && acct.karma >= WARMUP.karma)) cap = Math.min(cap, WARMUP.perDay);
    if (capHit()) { out.reason = `daily cap (${cap}, a new account) reached`; return; }
    const stories = await frontPage();
    const ranked = stories.map((s) => ({ ...s, rank: hnScore(s) }))
      .filter((s) => s.rank >= MIN_SCORE && !T.shouldSkipTracked(track, keyOf(s)))
      .sort((a, b) => b.rank - a.rank);
    logger.info(`${tag}: ${stories.length} front-page stories read, ${ranked.length} worth a comment${ranked.length ? ` (best: ${ranked.slice(0, 3).map((s) => `"${s.title.slice(0, 40)}" ${s.rank}`).join(", ")})` : ""}.`);
    for (const story of ranked) {
      if (done()) break;
      if (T.authorDid(track, asTracked(story).href, T.commentedAtOf, AUTHOR_GAP_MS)) continue;
      await commentOne(story, me);
    }
  })();
  run.catch(() => {}); // a body still running after a time-out must not raise an unhandled rejection
  try {
    if ((await Promise.race([run.then(() => "done"), timedOut])) === "timeout") {
      ctx.aborted = true;
      offForRun = "a pass timed out";
      out.reason = `hn comments off (pass timed out after ${Math.round(PASS_TIMEOUT_MS / MINUTE)} min)`;
      logger.error(`${tag}: ${out.reason}; releasing the HN browser session.`);
      await hn.cleanup({ closeTab: false }).catch(() => {});
    }
  } catch (e) {
    ctx.aborted = true;
    if (e.code === "HN_UNAVAILABLE") {
      const until = new Date(Date.now() + jitter(...COOLDOWN_MS)).toISOString();
      track.cooldowns = { ...(track.cooldowns || {}), hn: until };
      save();
      out.reason = `hn unavailable (${e.message}); comments paused until ${until}`;
      logger.error(`${tag}: ${out.reason}.`);
    } else if (e.code === "HN_OFF") {
      out.reason = `hn comments off (${e.message})`;
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

module.exports = { runHnPass, hnScore, cleanup, _reset: () => { offForRun = ""; } };
