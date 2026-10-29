require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Every tracker and pain-log write in this file goes to a throwaway dir, never data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "reddit-comments-test-"));
const TRACK = path.join(TMP, "reddit-comments.json");
const PAINS = path.join(TMP, "reddit-painpoints.jsonl");
process.env.REDDIT_TRACK_PATH = TRACK;
process.env.REDDIT_PAINPOINTS_PATH = PAINS;
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const llm = require("../src/services/llm");
const reddit = require("../src/services/redditComments");
const redditConfig = require("../config/reddit");
const helpers = require("../src/utils/helpers");
for (const t of helpers.logger.transports) t.silent = true;
const { redditScore, pickSubs } = reddit;

const HOUR = 3600000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const TITLE = "How do you get your first 10 paying customers for a B2B tool?";
const BODY = "I launched two weeks ago and every signup so far is a friend. Cold email gets no replies and I am not sure whether to keep at it or try communities first.";
let nextId = 1;
const thread = (over = {}) => {
  const id = `t3_${(nextId++).toString(36)}`;
  return { id, permalink: `/r/SaaS/comments/${id.slice(3)}/x/`, title: TITLE, text: BODY, author: "ada", created: ago(1), comments: 3, score: 2, type: "text", lang: "en", state: "UNMODERATED", sub: "SaaS", ...over };
};
const readTrack = () => (fs.existsSync(TRACK) ? JSON.parse(fs.readFileSync(TRACK, "utf8")) : {});
const resetTrack = () => { for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true }); reddit._reset(); };

test("score: fresh questions with few comments qualify; megathreads, removed, bot, foreign, sensitive, stale, brand-new, crowded and downvoted threads never do", () => {
  assert.ok(redditScore(thread()) >= 4, "a fresh question with 3 comments");
  assert.ok(redditScore(thread({ title: "Shipped my first tool today after six months of nights and weekends" })) < redditScore(thread()), "a question scores higher");
  assert.ok(redditScore(thread({ created: ago(8) })) < redditScore(thread()), "older is lower");
  for (const [why, t] of [
    ["megathread", thread({ title: "Weekly Feedback Thread: share what you are building" })],
    ["promo thread", thread({ title: "Share your startup - October" })],
    ["removed", thread({ state: "REMOVED" })],
    ["deleted author", thread({ author: "[deleted]" })],
    ["automod", thread({ author: "AutoModerator" })],
    ["Reddit tags it non-English", thread({ lang: "de" })],
    ["sensitive", thread({ title: "Got laid off today, how do I keep my side project going?" })],
    ["stale", thread({ created: ago(13) })],
    ["too fresh", thread({ created: ago(0.05) })],
    ["crowded", thread({ comments: 120 })],
    ["downvoted", thread({ score: -3 })],
  ]) assert.equal(redditScore(t), -99, why);
});

test("subs: never the avoid list; one comment per sub a day; least recently commented, then read, first; account minimums", () => {
  const avoid = new Set(redditConfig.avoid.map((s) => s.toLowerCase()));
  assert.equal(redditConfig.subreddits.length, 29, "the doc's shortlist");
  assert.ok(redditConfig.subreddits.every((s) => !avoid.has(s.name.toLowerCase()) && s.note), "no avoided sub, every sub has notes");
  const subs = [{ name: "A", note: "" }, { name: "B", note: "" }, { name: "C", note: "" }, { name: "Entrepreneur", note: "" }, { name: "Young", note: "", minAgeDays: 30 }];
  const track = {
    "reddit:t3_a": { ts: ago(2), status: "commented", commentedAt: ago(2), sub: "A" },
    meta: { subs: { b: { commentedAt: ago(30), readAt: ago(1) }, c: { readAt: ago(5) } } },
  };
  assert.deepEqual(pickSubs(track, { karma: 10, ageDays: 3 }, subs).map((s) => s.name), ["C", "B"], "A was commented in today; C never commented beats B; Entrepreneur avoided; Young needs a 30-day account");
  assert.deepEqual(pickSubs({}, { karma: 10, ageDays: 400 }, [subs[4]]).map((s) => s.name), ["Young"], "an older account qualifies");
});

test("Reddit drafter: shared gates plus Reddit's rules, the judge in Reddit's words, the pain point from the same call", async () => {
  const saved = llm.generateCommentText;
  const calls = [];
  const replies = [];
  llm.generateCommentText = async (prompt, opts) => { calls.push({ prompt, opts }); return replies.shift(); };
  const post = { title: TITLE, text: BODY, author: "ada", ageH: 1, score: 2, comments: 3 };
  const pain = { product: "factory", quote: "every signup so far is a friend", note: "no reach beyond friends" };
  const GOOD = "Communities first, but answer questions there for a couple of weeks before you mention the tool, because cold email to strangers rarely lands without any proof yet. Which communities do your buyers already hang out in?";
  try {
    replies.push(JSON.stringify({ candidates: [
      { angle: "answer", comment: "Great question! Communities first, since cold email to strangers rarely lands for a brand new tool without proof." },
      { angle: "answer", comment: "Cold email works if you send 500 a week to buyers who already feel the problem, so keep at it a little longer." },
      { angle: "answer", comment: "I built a tool for exactly this, communities first and cold email later once you have proof from early buyers." },
    ], pain }));
    const r = await llm.draftRedditComment({ sub: "SaaS", note: "never name a product", post, products: redditConfig.products });
    assert.equal(r.isValid, false);
    assert.match(r.candidates[0].gate.join(" "), /stock opener/);
    assert.match(r.candidates[1].gate.join(" "), /invents figures/);
    assert.match(r.candidates[2].gate.join(" "), /plug/);
    assert.deepEqual(r.pain, pain, "the pain point rides on the draft");

    for (const [comment, problem] of [
      ["Try r/startups as well, the weekly thread there is where buyers like yours ask about early tools and pricing.", /subreddit or user mention/],
      ["Communities first. See acme.dev for a list of the places where early buyers of tools usually hang out these days.", /a link/],
      ["Communities first:\n- answer questions\n- then mention the tool once people know who you are", /no lists/],
      ["Communities first.", /too thin/],
    ]) {
      replies.push(JSON.stringify({ candidates: [{ angle: "answer", comment }], pain: null }));
      assert.match((await llm.draftRedditComment({ sub: "SaaS", post })).errors.join(" "), problem, comment);
    }

    calls.length = 0;
    replies.push(JSON.stringify({ candidates: [{ angle: "answer", comment: GOOD }], pain: null }), JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "answers first" }] }));
    const ok = await llm.draftRedditComment({ sub: "SaaS", note: "never name a product", post, comments: "u/bob (4 points): try cold email again", products: redditConfig.products });
    assert.equal(ok.isValid, true);
    assert.equal(ok.comment, GOOD);
    assert.equal(calls.length, 2, "one draft call and one judge call");
    assert.ok(calls.every((c) => c.opts.role === "comment"), "on the comment provider");
    assert.match(calls[0].prompt, /Reddit thread in r\/SaaS/);
    assert.match(calls[0].prompt, /never name a product/, "the sub's notes reach the drafter");
    assert.match(calls[0].prompt, /try cold email again/, "the draft has read the comments");
    assert.match(calls[0].prompt, /factory: CosLynx Content Factory/, "the products the pain is filed under");
    assert.match(calls[1].prompt, /posted in a Reddit thread/);
    assert.match(calls[1].opts.system, /Reddit comments/);
    assert.ok(!/LinkedIn|on X/.test(calls[0].prompt + calls[1].prompt));

    replies.push(JSON.stringify({ skip: true, reason: "a rant", pain }));
    const skip = await llm.draftRedditComment({ sub: "SaaS", post });
    assert.equal(skip.skipped, true);
    assert.deepEqual(skip.pain, pain, "a skipped thread still reports its pain");
    replies.push("Sure! Here is a comment...");
    await assert.rejects(llm.draftRedditComment({ sub: "SaaS", post }), /Reddit comment draft failed/);
    replies.push(JSON.stringify({ candidates: [{ angle: "answer", comment: GOOD }] }), "PASS");
    await assert.rejects(llm.draftRedditComment({ sub: "SaaS", post }), /Reddit comment judge unavailable|verdict/i, "a judge that cannot answer fails closed");
  } finally {
    llm.generateCommentText = saved;
  }
});

// A scripted Reddit: one listing for every sub, and a send that does what `result` says.
const fakeReddit = (listing, { result = () => ({ status: "posted" }), ours = false, composer = true, listError = null, me = { name: "me", karma: 100, ageDays: 400 } } = {}) => ({
  sent: [], opened: [], entryAtSend: null,
  async ensureDriverConnected() {},
  async me() { return me; },
  async listThreads(sub) { if (listError) throw listError; return listing.filter((t) => t.sub === sub || !t.sub); },
  async openThread(t) { this.opened.push(t.id); return { ...t, top: [{ author: "bob", score: 4, text: "Cold email worked for me once I had a case study." }], ours, composer, url: `https://www.reddit.com${t.permalink}` }; },
  async postComment(t, text) { this.entryAtSend = readTrack()[`reddit:${t.id}`]; this.sent.push({ id: t.id, text }); return result(t); },
  async cleanup() {},
});
const withDraft = async (draft, fn) => {
  const saved = llm.draftRedditComment;
  const asked = [];
  llm.draftRedditComment = async (a) => { asked.push(a); return typeof draft === "function" ? draft(a) : draft; };
  try { return await fn(asked); } finally { llm.draftRedditComment = saved; }
};
const GOOD = { comment: "Communities first, then cold email once you have proof. Which communities do your buyers use?", isValid: true, skipped: false, errors: [], candidates: [], pain: null };
const one = (over = {}) => [thread({ sub: "", ...over })];

test("the pass comments once on the best thread, tracks it before the send, logs its pain, never comments twice and waits 20-40 min", async () => {
  resetTrack();
  const best = thread({ sub: "", score: 9 });
  const r = fakeReddit([thread({ sub: "", title: "Shipped my side project today after a long few months of work", score: 0 }), best]);
  const pain = { product: "factory", quote: "every signup so far is a friend", note: "no reach" };
  await withDraft({ ...GOOD, pain }, async (asked) => {
    const out = await reddit.runRedditPass({ reddit: r });
    assert.equal(out.commented, 1);
    assert.deepEqual(r.sent, [{ id: best.id, text: GOOD.comment }]);
    assert.equal(r.entryAtSend.status, "commented", "written before the send");
    assert.equal(r.entryAtSend.unverified, true);
    assert.match(asked[0].comments, /u\/bob \(4 points\): Cold email worked/, "the drafter reads the top comments");
    assert.ok(asked[0].note && asked[0].products.length, "and the sub's notes and our products");
    const tr = readTrack();
    const e = tr[`reddit:${best.id}`];
    assert.equal(e.comment, GOOD.comment);
    assert.ok(!e.unverified, "confirmed once it shows in the thread");
    const gap = Date.parse(tr.meta.nextAt) - Date.now();
    assert.ok(gap > 19 * 60000 && gap <= 40 * 60000, "the next comment waits 20-40 min");
    assert.equal(out.pains, 1);
    const rows = fs.readFileSync(PAINS, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(Object.keys(rows[0]).sort(), ["note", "product", "quote", "sub", "ts", "url"]);
    assert.equal(rows[0].quote, pain.quote);

    const again = await reddit.runRedditPass({ reddit: r });
    assert.match(again.reason, /next comment not before/);
    // Past the gap: the same thread is never commented on again.
    const t2 = readTrack(); t2.meta.nextAt = ago(1); fs.writeFileSync(TRACK, JSON.stringify(t2));
    await reddit.runRedditPass({ reddit: r });
    assert.ok(!r.sent.slice(1).some((s) => s.id === best.id), "never twice in a thread");
  });
});

test("a pain quote that is not in the thread is not logged", async () => {
  resetTrack();
  await withDraft({ ...GOOD, skipped: true, isValid: false, errors: ["nothing to add"], pain: { product: "factory", quote: "reels take me ten hours each", note: "slow" } }, async () => {
    const out = await reddit.runRedditPass({ reddit: fakeReddit(one()) });
    assert.equal(out.pains, 0);
    assert.ok(!fs.existsSync(PAINS));
  });
});

test("our comment already there, a locked thread, a SKIP and a rejected draft: tracked, nothing sent", async () => {
  resetTrack();
  for (const [opts, draft, status] of [
    [{ ours: true }, GOOD, "commented"],
    [{ composer: false }, GOOD, "skipped"],
    [{}, { ...GOOD, isValid: false, skipped: true, errors: ["a rant"] }, "skipped"],
    [{}, { ...GOOD, isValid: false, errors: ["judge: generic"] }, "rejected"],
  ]) {
    resetTrack();
    const listing = one();
    const r = fakeReddit(listing, opts);
    await withDraft(draft, () => reddit.runRedditPass({ reddit: r }));
    assert.equal(r.sent.length, 0);
    assert.equal(readTrack()[`reddit:${listing[0].id}`].status, status);
  }
});

test("caps: the daily cap, one per sub a day, one per author a week", async () => {
  resetTrack();
  const track = {};
  for (let i = 0; i < 6; i++) track[`reddit:t3_cap${i}`] = { ts: ago(1), status: "commented", commentedAt: ago(1), sub: `S${i}`, comment: `comment ${i}` };
  fs.writeFileSync(TRACK, JSON.stringify(track));
  await withDraft(GOOD, async () => {
    assert.match((await reddit.runRedditPass({ reddit: fakeReddit(one()) })).reason, /daily cap \(6\)/);
    // A new account gets 2 a day.
    resetTrack();
    fs.writeFileSync(TRACK, JSON.stringify(Object.fromEntries(Object.entries(track).slice(0, 2))));
    assert.match((await reddit.runRedditPass({ reddit: fakeReddit(one(), { me: { name: "me", karma: 1, ageDays: 0 } }) })).reason, /daily cap \(2, a new account\)/);
    resetTrack();
    // An author we commented on this week is passed over.
    fs.writeFileSync(TRACK, JSON.stringify({ "reddit:t3_old": { ts: ago(30), status: "commented", commentedAt: ago(30), sub: "Other", authorHref: "https://www.reddit.com/user/ada" } }));
    const r = fakeReddit(one());
    assert.equal((await reddit.runRedditPass({ reddit: r })).commented, 0);
    assert.equal(r.opened.length, 0);
  });
});

test("Reddit refusing (logged out, a captcha) pauses the comments 24-48 h; an uncertain send is never retried; a stop sends nothing", async () => {
  resetTrack();
  await withDraft(GOOD, async () => {
    const out = await reddit.runRedditPass({ reddit: fakeReddit(one(), { listError: Object.assign(new Error("logged out of Reddit"), { code: "REDDIT_UNAVAILABLE" }) }) });
    assert.match(out.reason, /reddit unavailable/);
    const until = Date.parse(readTrack().cooldowns.reddit) - Date.now();
    assert.ok(until > 23 * HOUR && until <= 48 * HOUR);
    assert.match((await reddit.runRedditPass({ reddit: fakeReddit(one()) })).reason, /paused until/);

    resetTrack();
    const listing = one();
    const r = fakeReddit(listing, { result: () => ({ status: "failed", reason: "Reddit asked for a captcha", unavailable: true }) });
    assert.match((await reddit.runRedditPass({ reddit: r })).reason, /captcha/);
    assert.equal(readTrack()[`reddit:${listing[0].id}`].status, "rejected", "nothing was sent");
    assert.ok(readTrack().cooldowns.reddit);

    resetTrack();
    const u = one();
    const ru = fakeReddit(u, { result: () => ({ status: "uncertain", reason: "not seen yet" }) });
    assert.equal((await reddit.runRedditPass({ reddit: ru })).commented, 1);
    assert.equal(readTrack()[`reddit:${u[0].id}`].unverified, true);
    const t = readTrack(); t.meta.nextAt = ago(1); fs.writeFileSync(TRACK, JSON.stringify(t));
    await reddit.runRedditPass({ reddit: ru });
    assert.equal(ru.sent.length, 1, "an uncertain send is never repeated");

    resetTrack();
    let stop = false;
    const rs = fakeReddit(one());
    await withDraft(() => { stop = true; return GOOD; }, () => reddit.runRedditPass({ reddit: rs, shouldStop: () => stop }));
    assert.equal(rs.sent.length, 0);
  });
});
