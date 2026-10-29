require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Every tracker read/write in this file goes to a throwaway dir, never data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "x-replies-test-"));
const TRACK = path.join(TMP, "x-replies.json");
process.env.X_REPLIES_TRACK_PATH = TRACK;
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const llm = require("../src/services/llm");
const xReplies = require("../src/services/xReplies");
const helpers = require("../src/utils/helpers");
for (const t of helpers.logger.transports) t.silent = true;
const { xScore, xViralScore } = xReplies;

const HOUR = 3600000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const TEXT = "We shipped streaming tool calls in the SDK today, so agents can start acting before the model finishes its answer.";
let nextId = 1000;
const post = (over = {}) => {
  const tweetId = String(nextId++);
  return { tweetId, url: `https://x.com/ada/status/${tweetId}`, timestamp: ago(0.5), text: TEXT, mainText: TEXT, lang: "en", handle: "ada", isAd: false, isReply: false, likes: 100, reposts: 10, replies: 5, views: 5000, ...over };
};
const readTrack = () => (fs.existsSync(TRACK) ? JSON.parse(fs.readFileSync(TRACK, "utf8")) : {});
const resetTrack = () => { for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true }); xReplies._reset(); };

test("score: fresh posts with real momentum qualify; ads, replies, our own, foreign, sensitive, bait, thin and stale posts never do", () => {
  assert.ok(xScore(post()) >= 3, "a fresh post with 100+ engagements an hour");
  assert.ok(xScore(post({ likes: 1, reposts: 0, views: 50 })) < 3, "a post nobody reads");
  assert.ok(xScore(post({ timestamp: ago(10) })) < xScore(post()), "older is lower");
  for (const [why, p, own] of [
    ["ad", post({ isAd: true })],
    ["reply", post({ isReply: true })],
    ["our own post", post({ handle: "Me" }), "me"],
    ["X tags it non-English", post({ lang: "ja" })],
    ["sensitive", post({ text: "Thinking of everyone affected by the layoffs announced today across the industry and the teams.", mainText: "Thinking of everyone affected by the layoffs announced today across the industry and the teams." })],
    ["bait", post({ text: "Comment 'AGENT' and I'll DM you the full guide to building agents with our SDK today.", mainText: "Comment 'AGENT' and I'll DM you the full guide to building agents with our SDK today." })],
    ["thin", post({ text: "Shipped it today.", mainText: "Shipped it today." })],
    ["stale", post({ timestamp: ago(30) })],
  ]) assert.equal(xScore(p, own), -99, why);
});

test("what an X reply may not carry: a link (a bare domain too), a hashtag, an @mention or an emoji", () => {
  for (const [text, problem] of [
    ["see https://acme.dev", "a link"], ["it is on acme.dev now", "a link"], ["{LINK}", "a link"],
    ["joins got faster #databases", "a hashtag or @mention"], ["ask @acme about it", "a hashtag or @mention"],
    ["joins got faster \u{1F447}", "an emoji"], ["Do the joins stay fast at 10x the rows?", ""],
  ]) assert.equal(helpers.xTextProblem(text), problem, text);
});

test("viral score: only a crowd already, early in its rise", () => {
  assert.equal(xViralScore(post()), 0, "100 an hour is not viral");
  const big = post({ likes: 3000, reposts: 400, views: 400000, timestamp: ago(1), replies: 120 });
  assert.ok(xViralScore(big) >= 6);
  assert.equal(xViralScore({ ...big, timestamp: ago(13) }), -99, "past 12 h a reply lands under hundreds");
  assert.ok(xViralScore({ ...big, replies: 3000 }) < xViralScore(big), "a buried thread scores lower");
});

test("X drafter: shared gates plus X's own rules, then the judge in X's words; the regular pass keeps the peer grounding gate", async () => {
  const saved = llm.generateCommentText;
  const calls = [];
  const replies = [];
  llm.generateCommentText = async (prompt, opts) => { calls.push({ prompt, opts }); return replies.shift(); };
  const p = { author: "ada", text: TEXT, ageH: 0.5, likes: 100, reposts: 10, replies: 5 };
  try {
    replies.push(JSON.stringify({ candidates: [
      { angle: "take", comment: "Streaming tool calls cut agent latency by 40%." },
      { angle: "take", comment: "Streaming tool calls is the part agents needed #ai" },
      { angle: "take", comment: `Streaming tool calls is huge. ${"Agents acting before the answer ends changes everything. ".repeat(5)}` },
      { angle: "question", comment: "Do the streamed tool calls arrive before the model finishes its answer?" },
    ] }), JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "specific question" }] }));
    const r = await llm.draftXReply({ post: p, replies: "@bob: congrats on shipping" });
    assert.equal(r.candidates.length, 3, "three candidates at most");
    assert.match(r.candidates[0].gate.join(" "), /invents figures/);
    assert.match(r.candidates[1].gate.join(" "), /hashtag/);
    assert.match(r.candidates[2].gate.join(" "), /too long for an X reply/);
    replies.length = 0;
    calls.length = 0;
    replies.push(JSON.stringify({ candidates: [{ angle: "question", comment: "Do the streamed tool calls arrive before the model finishes its answer?" }] }), JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "specific question" }] }));
    const ok = await llm.draftXReply({ post: p, replies: "@bob: congrats on shipping" });
    assert.equal(ok.isValid, true);
    assert.equal(ok.comment, "Do the streamed tool calls arrive before the model finishes its answer?");
    assert.equal(calls.length, 2, "one draft call and one judge call");
    assert.ok(calls.every((c) => c.opts.role === "comment"), "the regular pass on the comment provider");
    assert.match(calls[0].prompt, /post on X/);
    assert.match(calls[0].prompt, /congrats on shipping/, "the draft has read the replies shown");
    assert.match(calls[1].prompt, /replies before they are posted under a post on X/);
    assert.ok(!/LinkedIn/.test(calls[0].prompt + calls[1].prompt + calls[1].opts.system));

    // Off-post detail: the regular pass's peer gate rejects it, the viral pass lets the judge decide.
    const drift = "Streaming tool calls matter most for Kubernetes operators, Terraform modules, Postgres replicas and orchestration pipelines.";
    replies.push(JSON.stringify({ candidates: [{ angle: "take", comment: drift }] }));
    assert.match((await llm.draftXReply({ post: p })).errors.join(" "), /adds detail the post never states/);
    calls.length = 0;
    replies.push(JSON.stringify({ candidates: [{ angle: "take", comment: drift }] }), JSON.stringify({ verdicts: [{ n: 1, pass: false, reason: "off topic" }] }));
    const viral = await llm.draftXReply({ post: p, viral: true });
    assert.match(viral.errors.join(" "), /judge: off topic/);
    assert.ok(calls.every((c) => c.opts.role === "viral"), "the viral pass on the viral provider");

    replies.push(JSON.stringify({ skip: true, reason: "politics" }));
    assert.equal((await llm.draftXReply({ post: p })).skipped, true);
    replies.push("Here is my reply...");
    await assert.rejects(llm.draftXReply({ post: p }), /X reply draft failed/);
    replies.push(JSON.stringify({ candidates: [{ angle: "question", comment: "Do the streamed tool calls arrive before the model finishes its answer?" }] }), "PASS");
    await assert.rejects(llm.draftXReply({ post: p }), /X reply judge unavailable|verdict/i, "a judge that cannot answer fails closed");
  } finally {
    llm.generateCommentText = saved;
  }
});

// A scripted X: one timeline (For you) and a reply that does what `result` says.
const fakeX = (timeline, { result = () => ({ status: "posted" }), ours = false, scanError = null } = {}) => ({
  sent: [], opened: [], entryAtSend: null,
  async ensureDriverConnected() {},
  async ownHandle() { return "me"; },
  async scanTimeline(src) { if (scanError) throw scanError; return src.label === "home:for-you" ? timeline : []; },
  async openPost(p) { this.opened.push(p.tweetId); return { post: p, replies: [{ handle: "bob", mainText: "nice" }], ours }; },
  async replyToPost(p, text) { this.entryAtSend = readTrack()[`x:${p.tweetId}`]; this.sent.push({ id: p.tweetId, text }); return result(p); },
  async cleanup() {},
});
const withDraft = async (draft, fn) => {
  const saved = llm.draftXReply;
  const asked = [];
  llm.draftXReply = async (a) => { asked.push(a); return typeof draft === "function" ? draft(a) : draft; };
  try { return await fn(asked); } finally { llm.draftXReply = saved; }
};
const GOOD = { comment: "Do the streamed tool calls arrive before the answer ends?", isValid: true, skipped: false, errors: [], candidates: [] };

test("the pass replies to the best post, tracks it before the send, and never replies to it twice", async () => {
  resetTrack();
  const best = post({ likes: 400 });
  const x = fakeX([post({ likes: 1, reposts: 0, views: 10, handle: "quiet" }), best, post({ isAd: true, handle: "ad" })]);
  await withDraft(GOOD, async (asked) => {
    const r = await xReplies.runXReplyPass({ twitter: x, max: 1 });
    assert.equal(r.replied, 1);
    assert.deepEqual(x.sent, [{ id: best.tweetId, text: GOOD.comment }]);
    assert.equal(x.entryAtSend.status, "commented", "written before the send");
    assert.equal(x.entryAtSend.unverified, true);
    assert.match(asked[0].replies, /@bob: nice/, "the drafter sees the replies already there");
    const e = readTrack()[`x:${best.tweetId}`];
    assert.equal(e.comment, GOOD.comment);
    assert.ok(!e.unverified, "confirmed once it shows under the post");
    // The same timeline again: nothing new to reply to (that post is done, its author waits a week).
    const again = await xReplies.runXReplyPass({ twitter: x, max: 1 });
    assert.equal(again.replied, 0);
    assert.equal(x.sent.length, 1);
    // The next pass learns from the replies already sent.
    const other = post({ handle: "grace" });
    await xReplies.runXReplyPass({ twitter: fakeX([other]), max: 1 });
    assert.deepEqual(asked[asked.length - 1].recent.map((x) => x.text), [GOOD.comment]);
  });
});

test("our reply already under the post, a SKIP, a rejected draft and replies limited: tracked, nothing sent", async () => {
  resetTrack();
  const p = post();
  const x = fakeX([p], { ours: true });
  await withDraft(GOOD, async () => {
    assert.equal((await xReplies.runXReplyPass({ twitter: x, max: 1 })).replied, 0);
    assert.equal(x.sent.length, 0);
    assert.equal(readTrack()[`x:${p.tweetId}`].status, "commented");
  });
  for (const [draft, status] of [[{ ...GOOD, isValid: false, skipped: true, errors: ["politics"] }, "skipped"], [{ ...GOOD, isValid: false, errors: ["judge: generic"] }, "rejected"]]) {
    const q = post({ handle: `h${status}` });
    const y = fakeX([q]);
    await withDraft(draft, () => xReplies.runXReplyPass({ twitter: y, max: 1 }));
    assert.equal(y.sent.length, 0);
    assert.equal(readTrack()[`x:${q.tweetId}`].status, status);
  }
  // Replies limited on the first post: skipped for 30 days, and the pass goes on to the next.
  const limited = post({ handle: "limited", likes: 500 });
  const open = post({ handle: "open" });
  const z = fakeX([limited, open], { result: (q) => (q.tweetId === limited.tweetId ? { status: "failed", reason: "no-composer" } : { status: "posted" }) });
  await withDraft(GOOD, async () => {
    const r = await xReplies.runXReplyPass({ twitter: z, max: 1 });
    assert.equal(r.replied, 1);
    assert.equal(readTrack()[`x:${limited.tweetId}`].status, "skipped");
    assert.deepEqual(z.sent.map((s) => s.id), [limited.tweetId, open.tweetId]);
  });
});

test("a send X refuses ends the pass; an uncertain send is never retried; X_UNAVAILABLE pauses the passes", async () => {
  resetTrack();
  const [a, b] = [post({ handle: "a1", likes: 500 }), post({ handle: "b1" })];
  const x = fakeX([a, b], { result: () => ({ status: "failed", reason: "the Reply button stayed disabled" }) });
  await withDraft(GOOD, async () => {
    const r = await xReplies.runXReplyPass({ twitter: x, max: 2 });
    assert.equal(r.replied, 0);
    assert.equal(x.sent.length, 1, "no second try after a refusal");
    assert.match(r.reason, /not sent/);
    assert.equal(readTrack()[`x:${a.tweetId}`].status, "rejected", "not sent: tried again in 3 days");

    const u = post({ handle: "u1" });
    const y = fakeX([u], { result: () => ({ status: "uncertain", reason: "not seen yet" }) });
    assert.equal((await xReplies.runXReplyPass({ twitter: y, max: 1 })).replied, 1);
    assert.equal(readTrack()[`x:${u.tweetId}`].unverified, true);
    await xReplies.runXReplyPass({ twitter: y, max: 1 });
    assert.equal(y.sent.length, 1, "an uncertain send is never repeated");

    const locked = fakeX([post()], { scanError: Object.assign(new Error("X account locked"), { code: "X_UNAVAILABLE" }) });
    const r2 = await xReplies.runXReplyPass({ twitter: locked, max: 1 });
    assert.match(r2.reason, /x unavailable/);
    assert.ok(readTrack().cooldowns.x, "the pause is kept in the tracker");
    const r3 = await xReplies.runXReplyPass({ twitter: fakeX([post({ handle: "later" })]), max: 1 });
    assert.match(r3.reason, /cooldown until/);
  });
});

test("the daily caps: regular and viral replies are counted apart", async () => {
  resetTrack();
  const track = {};
  for (let i = 0; i < 20; i++) track[`x:${i}`] = { ts: ago(1), status: "commented", commentedAt: ago(1), comment: `reply ${i}` };
  fs.writeFileSync(TRACK, JSON.stringify(track));
  await withDraft(GOOD, async () => {
    const r = await xReplies.runXReplyPass({ twitter: fakeX([post()]), max: 1 });
    assert.match(r.reason, /daily cap \(20\)/);
    const big = post({ handle: "big", likes: 3000, reposts: 400, views: 400000, timestamp: ago(1), replies: 120 });
    const v = fakeX([big]);
    assert.equal((await xReplies.runXReplyPass({ twitter: v, max: 1, viral: true })).replied, 1, "the viral cap is its own");
    assert.equal(readTrack()[`x:${big.tweetId}`].viral, true);
  });
});

test("a stop asked while drafting sends nothing", async () => {
  resetTrack();
  let stop = false;
  const x = fakeX([post()]);
  await withDraft(() => { stop = true; return GOOD; }, () => xReplies.runXReplyPass({ twitter: x, max: 1, shouldStop: () => stop }));
  assert.equal(x.sent.length, 0);
});
