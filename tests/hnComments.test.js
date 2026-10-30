require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Tracker writes go to a throwaway dir, never data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hn-comments-test-"));
const TRACK = path.join(TMP, "hn-comments.json");
process.env.HN_TRACK_PATH = TRACK;
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const llm = require("../src/services/llm");
const hn = require("../src/services/hnComments");
const { __test: { plain } } = require("../src/services/hn");
const helpers = require("../src/utils/helpers");
for (const t of helpers.logger.transports) t.silent = true;
const { hnScore, runHnPass } = hn;

const HOUR = 3600000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
let nextId = 1000;
const story = (over = {}) => ({ id: String(nextId++), title: "Speculative decoding cuts LLM inference latency in half", url: "https://example.org/post", author: "pg", points: 80, comments: 20, created: ago(3), text: "", ...over });
const readTrack = () => (fs.existsSync(TRACK) ? JSON.parse(fs.readFileSync(TRACK, "utf8")) : {});
const reset = () => { for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true }); hn._reset(); }; // the .bak too

test("score: fresh, on-field threads with room qualify; off-field, hiring, sensitive, stale, brand-new, quiet and crowded never do", () => {
  assert.ok(hnScore(story()) >= 4);
  assert.ok(hnScore(story({ title: "Ask HN: How do you evaluate LLM agents in production?" })) > hnScore(story()), "an asker reads every comment");
  for (const [why, s] of [
    ["off field", story({ title: "The history of the Roman aqueducts" })],
    ["hiring", story({ title: "Ask HN: Who is hiring? (November 2026)" })],
    ["sensitive", story({ title: "Got laid off from my ML job today, what now?" })],
    ["stale", story({ created: ago(12) })],
    ["too fresh", story({ created: ago(0.5) })],
    ["quiet", story({ comments: 2 })],
    ["crowded", story({ comments: 400 })],
  ]) assert.equal(hnScore(s), -99, why);
});

test("HN's comment HTML reads as plain paragraphs", () => {
  assert.equal(plain("It&#x27;s fast<p>But &quot;cheap&quot; &gt; free"), "It's fast\n\nBut \"cheap\" > free");
});

test("a pass comments once on the best thread, marks it before the send, and never twice", async () => {
  reset();
  const best = story({ title: "Ask HN: How do you evaluate LLM agents in production?" });
  const sent = [];
  const fakeHn = { ensureDriverConnected: async () => {}, me: async () => "us", postComment: async (s, text) => { sent.push({ id: s.id, text, tracked: readTrack()[`hn:${s.id}`] }); return { status: "posted" }; }, cleanup: async () => {} };
  const api = {
    frontPage: async () => [story({ title: "Roman aqueducts" }), best],
    readThread: async (id) => ({ id, title: best.title, text: "We run agents against real tickets.", author: "pg", top: [{ author: "x", text: "Use golden traces." }], ours: false, open: true, created: best.created }),
    account: async () => ({ karma: 500, ageDays: 400 }),
    fetchPage: async () => null,
  };
  const orig = llm.draftHnComment;
  llm.draftHnComment = async () => ({ comment: "Golden traces drift as the tools change; replaying them against a pinned tool version tells you whether the model or the tool regressed.", isValid: true, skipped: false, candidates: [] });
  try {
    const r = await runHnPass({ hn: fakeHn, api });
    assert.equal(r.commented, 1);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].id, best.id);
    assert.equal(sent[0].tracked.status, "commented", "tracked before the send");
    const again = await runHnPass({ hn: fakeHn, api });
    assert.equal(again.commented, 0, "the 45-90 min gap holds");
    assert.equal(sent.length, 1);
  } finally {
    llm.draftHnComment = orig;
  }
});

test("a new account gets 1 a day; HN refusing pauses the comments", async () => {
  reset();
  const fakeHn = { ensureDriverConnected: async () => {}, me: async () => "us", postComment: async () => ({ status: "failed", reason: "HN refused the comment: \"posting too fast\"", unavailable: true }), cleanup: async () => {} };
  const s = story();
  const api = { frontPage: async () => [s], readThread: async (id) => ({ id, title: s.title, text: "Body text here.", author: "pg", top: [], ours: false, open: true, created: s.created }), account: async () => ({ karma: 3, ageDays: 2 }), fetchPage: async () => null };
  const orig = llm.draftHnComment;
  llm.draftHnComment = async () => ({ comment: "A comment long enough to pass the gates, about how draft tokens get verified in one forward pass of the larger model.", isValid: true, skipped: false, candidates: [] });
  try {
    const r = await runHnPass({ hn: fakeHn, api });
    assert.match(r.reason, /hn unavailable/);
    assert.ok(Date.parse(readTrack().cooldowns.hn) > Date.now() + 23 * HOUR, "paused 24-48 h");
    assert.match((await runHnPass({ hn: fakeHn, api })).reason, /paused until/);
  } finally {
    llm.draftHnComment = orig;
  }
});

test("the drafter's HN gates refuse markdown, hype openers and plugs before the judge", async () => {
  const orig = llm.generateCommentText;
  let judged = 0;
  llm.generateCommentText = async (prompt) => {
    if (/strict judge|judge comments/i.test(prompt)) { judged++; return JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "ok" }] }); }
    return JSON.stringify({ skip: false, candidates: [
      { angle: "mechanism", comment: "Great work! This is a game changer for anyone running inference at scale, truly impressive results here." },
      { angle: "tradeoff", comment: "- point one about the draft model\n- point two about acceptance rates in the verifier pass" },
    ] });
  };
  try {
    const r = await llm.draftHnComment({ story: { title: "Speculative decoding", text: "The draft model proposes tokens and the large model verifies them in one pass.", author: "pg" } });
    assert.equal(r.isValid, false);
    assert.equal(judged, 0, "nothing gated reaches the judge");
  } finally {
    llm.generateCommentText = orig;
  }
});
