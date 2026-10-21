require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Every tracker read/write in this file goes to a throwaway dir, never data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-viral-test-"));
process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "track.json");
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const config = require("../config");
const VIRAL = require("../config/viral");
const LinkedInService = require("../src/services/linkedin");
const feedEngage = require("../src/services/feedEngage");
const llm = require("../src/services/llm");
const { fakeLinkedIn } = require("./_fakeLinkedIn");
const { viralScore, isVip, buildViralSources, _tracker: T } = feedEngage;

const HOUR = 3600000;
const ago = (h) => new Date(Date.now() - h * HOUR).toISOString();
const vip = VIRAL.people[0];
const TEXT = "We just launched a new open-source AI model for developers, built with our research team over the last year.";

test("social counts come from the tally lines under the post, never from its text", () => {
  const card = [
    "Feed post", "Jane Doe", "Founder at Acme", "3h •", "",
    "We raised 2,000 dollars for 300 students this year and 45 comments later we are still going.",
    "Sam Lee and 1,234 others", "56 comments • 12 reposts", "Like", "Comment",
  ].join("\n");
  assert.deepEqual(LinkedInService.socialCounts(card), { reactions: 1235, comments: 56, reposts: 12 });
  assert.deepEqual(LinkedInService.socialCounts("Feed post\nA\nB\n2h •\nBody text here\n1.2K reactions\n3K comments"), { reactions: 1200, comments: 3000, reposts: 0 });
  // Bare count lines: the first is the reactions, the second the comments.
  assert.deepEqual(LinkedInService.socialCounts("Feed post\nA\nB\n2h •\nA long body with words\n4,512\n318\nLike"), { reactions: 4512, comments: 318, reposts: 0 });
  assert.deepEqual(LinkedInService.socialCounts("Feed post\nA\nB\n2h •\nNo tallies at all on this card"), { reactions: 0, comments: 0, reposts: 0 });
});

test("the age line company and activity pages put above a post is not part of it", () => {
  assert.equal(LinkedInService.withoutAgeChrome("7 hours ago • Visible to anyone on or off LinkedIn\nWe opened an office."), "We opened an office.");
  assert.equal(LinkedInService.withoutAgeChrome("6 days ago • Edited • Visible to anyone on or off LinkedIn\nGPT news"), "GPT news");
  assert.equal(LinkedInService.withoutAgeChrome("1h • Edited •\nEdited •\nOur report on Europe."), "Our report on Europe.");
  assert.equal(LinkedInService.withoutAgeChrome("In 3 days ago • we shipped"), "In 3 days ago • we shipped", "only a leading chrome line");
  assert.equal(LinkedInService.withoutAgeChrome("3 reasons • why it works"), "3 reasons • why it works", "a number that is not an age stays");
});

test("a big name is recognised by its profile or company link, or by its name on the card", () => {
  assert.equal(isVip({ href: `https://www.linkedin.com/in/${vip.slug}/`, author: "x" }), true);
  assert.equal(isVip({ href: "", author: vip.name }), true);
  const co = VIRAL.companies[0];
  assert.equal(isVip({ href: `https://www.linkedin.com/company/${co.slug}`, author: "" }), true);
  assert.equal(isVip({ href: "https://www.linkedin.com/in/someone-else/", author: "Someone Else" }), false);
});

test("viral score: timing first; a big name's fresh post and a fast riser qualify, a slow, stale or buried one does not", () => {
  const MIN = 8;
  const bigNameFresh = viralScore({ author: vip.name, href: "", text: TEXT, ageH: 1, reactions: 40, comments: 5 });
  const bigNameDayOld = viralScore({ author: vip.name, href: "", text: TEXT, ageH: 20, reactions: 600, comments: 90 });
  const rising = viralScore({ author: "A Founder", href: "https://www.linkedin.com/in/a-founder", text: TEXT, ageH: 2, reactions: 700, comments: 60 });
  const slow = viralScore({ author: "B", href: "https://www.linkedin.com/in/b", text: TEXT, ageH: 10, reactions: 120, comments: 20 });
  const ripeButLate = viralScore({ author: "E", href: "https://www.linkedin.com/in/e", text: TEXT, ageH: 20, reactions: 2000, comments: 900 });
  const stale = viralScore({ author: "C", href: "https://www.linkedin.com/in/c", text: TEXT, ageH: 30, reactions: 20000 });
  assert.ok(bigNameFresh >= MIN, `big name, 1 h old ${bigNameFresh}`);
  assert.ok(bigNameDayOld >= MIN, `big name, 20 h old ${bigNameDayOld}`);
  assert.ok(rising >= MIN, `rising ${rising}`);
  assert.ok(bigNameFresh > bigNameDayOld, "earlier is better: the first hours decide the top comments");
  assert.equal(slow, 0, "not a big name, no crowd and no pace: not the viral pass's");
  assert.ok(ripeButLate < MIN, `a comment there lands under 900 others: ${ripeButLate}`);
  assert.equal(stale, -99, "past 24 h a non-VIP post is not commented as viral");
  assert.equal(viralScore({ author: vip.name, text: TEXT, ageH: 40 }), -99, "a big name's post past 36 h");
  // Sensitive posts and bait get nothing, whoever wrote them.
  assert.equal(viralScore({ author: vip.name, text: "Our hearts are with everyone affected by the layoffs announced today across the industry and beyond.", ageH: 2 }), -99);
});

test("viral sources: big names most likely to have posted first, a page read under 2 h ago waits, searches alternate", () => {
  const src = buildViralSources({}, 3);
  assert.equal(src.length, 3);
  assert.match(src[0].label, /^vip:/);
  assert.match(src[1].label, /^viral:/);
  assert.match(src[1].url, /datePosted=%22past-24h%22&sortBy=%22relevance%22/);
  assert.ok(src.every((s) => /^https:\/\/www\.linkedin\.com\//.test(s.url)));
  // Every page but two read just now; of those two, the one that posts daily and was read a day
  // ago beats the one that posts monthly.
  const now = Date.now();
  const pages = [...VIRAL.people.map((p) => `vip:${p.slug}`), ...VIRAL.companies.map((c) => `vip:${c.slug}`)];
  const viralPages = Object.fromEntries(pages.map((l) => [l, { at: new Date(now - 10 * 60000).toISOString(), perDay: 1 }]));
  viralPages[pages[0]] = { at: new Date(now - 24 * HOUR).toISOString(), perDay: 0.03 };
  viralPages[pages[1]] = { at: new Date(now - 24 * HOUR).toISOString(), perDay: 2 };
  const picked = buildViralSources({ meta: { viralPages } }, 4, now).filter((s) => s.label.startsWith("vip:")).map((s) => s.label);
  assert.deepEqual(picked, [pages[1], pages[0]]);
});

test("a big name's page read: when, and how often it posts", () => {
  const track = {};
  feedEngage.noteViralPage(track, "vip:x", [{ ageH: 2 }, { ageH: 26 }, { ageH: 50 }, { ageH: 900 }]);
  assert.ok(Math.abs(track.meta.viralPages["vip:x"].perDay - 3 / (50 / 24)) < 0.01, "3 posts in 50 h");
  feedEngage.noteViralPage(track, "viral:OpenAI", [{ ageH: 1 }]);
  assert.equal(track.meta.viralPages["viral:OpenAI"], undefined, "searches are not pages");
  feedEngage.noteViralPage(track, "vip:quiet", [{ ageH: 900 }]);
  assert.equal(track.meta.viralPages["vip:quiet"].perDay, 0, "posts, none in 14 days: quiet");
  feedEngage.noteViralPage(track, "vip:x", []);
  assert.ok(Math.abs(track.meta.viralPages["vip:x"].perDay - 3 / (50 / 24)) < 0.01, "no card read keeps the learned rate");
  feedEngage.noteViralPage(track, "vip:new", []);
  assert.equal(track.meta.viralPages["vip:new"].perDay, null, "no card read and nothing learned: unknown");
});

test("the scheduler reads a quiet page least, and an unknown rate as a typical page", () => {
  const now = Date.now();
  const at = new Date(now - 3 * 24 * HOUR).toISOString();
  const people = VIRAL.people.slice(0, 3).map((p) => `vip:${p.slug}`);
  const track = { meta: { viralPages: { [people[0]]: { at, perDay: 0 }, [people[1]]: { at, perDay: 0.1 }, [people[2]]: { at, perDay: null } } } };
  let quietLast = 0;
  for (let i = 0; i < 50; i++) {
    const order = buildViralSources(track, 200, now).map((s) => s.label).filter((l) => people.includes(l));
    if (order.indexOf(people[0]) > order.indexOf(people[1]) && order.indexOf(people[0]) > order.indexOf(people[2])) quietLast++;
  }
  assert.ok(quietLast >= 45, `the quiet page came last ${quietLast}/50 times`);
});

test("counts are read from the tally block at the card's end; the post's own numbers and age-like lines stay", () => {
  assert.deepEqual(LinkedInService.socialCounts("Feed post\nA\nB\n2h •\nBody line one\n2024\nMore body text here\nSam Lee and 1,234 others\n56 comments • 12 reposts\nLike\nComment"), { reactions: 1235, comments: 56, reposts: 12 });
  assert.deepEqual(LinkedInService.socialCounts("Feed post\nA\nB\n2h •\n300 comments later we shipped\nbody\n1.234\n56 comments\nLike"), { reactions: 1234, comments: 56, reposts: 0 }, "a German thousands separator, and a body line that looks like a tally");
  assert.equal(LinkedInService.withoutAgeChrome("5 years • 3 startups • 1 exit\nHere is what I learned"), "5 years • 3 startups • 1 exit\nHere is what I learned");
  assert.equal(LinkedInService.withoutAgeChrome("1h •\nOur report."), "Our report.");
});

test("viral comments are counted on their own cap, apart from the regular comments", () => {
  const track = {
    a: { ts: ago(1), status: "commented", commentedAt: ago(1) },
    b: { ts: ago(2), status: "commented", commentedAt: ago(2), viral: true },
    c: { ts: ago(3), status: "commented", commentedAt: ago(3), viral: true },
    old: "2020-01-01T00:00:00.000Z",
  };
  assert.equal(T.commentedSince(track, 24 * HOUR), 3);
  assert.equal(T.commentedSince(track, 24 * HOUR, { viral: false }), 1);
  assert.equal(T.commentedSince(track, 24 * HOUR, { viral: true }), 2);
});

test("the viral pass reads the thread, drafts against it, comments on the viral post only, and is off without comments", async () => {
  const saved = { draft: llm.draftViralComment, social: { ...config.social } };
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "viral-track.json");
  LinkedInService._resetDisabled();
  const drafts = [];
  let page = () => [
    { key: "urn:li:activity:1", author: "Ordinary Person", href: "https://www.linkedin.com/in/ordinary", text: TEXT, head: "", ageH: 5, reactions: 12 },
    { key: "urn:li:activity:2", author: vip.name, href: `https://www.linkedin.com/in/${vip.slug}`, text: TEXT, head: "", ageH: 2, reactions: 5400, comments: 300 },
  ];
  let thread = () => ({ status: "open", comments: "Jane Doe\nFounder\n1h\nCongrats on the launch!", commenters: ["Jane Doe"] });
  const li = fakeLinkedIn({ scan: () => page(), thread: (p) => thread(p) });
  llm.draftViralComment = async (args) => { drafts.push(args); return { comment: "Shipping it open source is the part that will travel.", isValid: true, skipped: false, errors: [], candidates: [] }; };
  try {
    config.social.linkedinFeedReply = false;
    assert.equal((await feedEngage.runViralPass({ max: 1 })).reason, "disabled", "no comment of any kind without LINKEDIN_FEED_REPLY");
    config.social.linkedinFeedReply = true;
    config.social.linkedinViral = false;
    assert.equal((await feedEngage.runViralPass({ max: 1 })).reason, "disabled");
    config.social.linkedinViral = true;
    const r = await feedEngage.runViralPass({ max: 1 });
    assert.equal(r.commented, 1);
    assert.deepEqual(li.done("comment"), ["urn:li:activity:2"], "only the big name's post");
    const track = T.loadTrack();
    assert.equal(track["urn:li:activity:2"].viral, true);
    assert.equal(T.commentedSince(track, 24 * HOUR, { viral: false }), 0, "the regular cap is untouched");
    assert.equal(track.counters.viralLoads.length, li.scanned.length, "one load counted per page the scan read");
    assert.equal(drafts.length, 1);
    assert.match(drafts[0].comments, /Congrats on the launch/, "the draft sees the comments already there");
    assert.ok(track.meta.viralPages, "the big name's page read is remembered");
    // Our comment already on the post: recorded, never a second one.
    thread = () => ({ status: "already", comments: "", commenters: [] });
    page = () => [{ key: "urn:li:activity:3", author: VIRAL.people[1].name, href: `https://www.linkedin.com/in/${VIRAL.people[1].slug}`, text: TEXT, head: "", ageH: 1, reactions: 900, comments: 20 }];
    const again = await feedEngage.runViralPass({ max: 1 });
    assert.equal(again.commented, 0);
    assert.equal(T.loadTrack()["urn:li:activity:3"].status, "commented");
    assert.deepEqual(li.done("comment"), ["urn:li:activity:2"]);
  } finally {
    li.restore();
    llm.draftViralComment = saved.draft;
    Object.assign(config.social, saved.social);
  }
});

test("viral drafter: the first candidate that passes the hard gates and the judge is the comment", async () => {
  const saved = llm.generateCommentText;
  const calls = [];
  const replies = [
    JSON.stringify({ skip: false, candidates: [
      { angle: "implication", comment: "That 40% gain changes what a small team can afford to run." },
      { angle: "question", comment: "Will the open weights come with the evaluation code too?" },
      { angle: "detail", comment: "Releasing the weights is the part that will move people." },
    ] }),
    JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "specific question" }, { n: 2, pass: true, reason: "ok" }] }),
  ];
  llm.generateCommentText = async (prompt, opts) => { calls.push({ prompt, opts }); return replies.shift(); };
  try {
    const post = { author: "Ada Lovelace", text: "We are releasing our open model weights today for every developer to build on.", ageH: 1, reactions: 900, comments: 40 };
    const r = await llm.draftViralComment({ post, comments: "Bob\nCongrats!" });
    assert.equal(r.isValid, true);
    assert.equal(r.comment, "Will the open weights come with the evaluation code too?", "the invented 40% fails the gates; the next passes");
    assert.match(r.candidates[0].gate.join(" "), /invents figures/);
    assert.equal(calls.length, 2, "one draft call and one judge call");
    assert.ok(calls.every((c) => c.opts.role === "viral"), "both on the viral provider");
    assert.match(calls[0].prompt, /Congrats!/, "the draft prompt carries the comments shown");
    assert.ok(!("imageFiles" in calls[0].opts), "the drafter works from the text");
    // A skip, a judge that fails everything, and a reply that is not JSON.
    replies.push(JSON.stringify({ skip: true, reason: "a layoffs post" }));
    assert.equal((await llm.draftViralComment({ post })).skipped, true);
    replies.push(JSON.stringify({ candidates: [{ angle: "question", comment: "Will the open weights come with the evaluation code too?" }] }), JSON.stringify({ verdicts: [{ n: 1, pass: false, reason: "generic" }] }));
    const failed = await llm.draftViralComment({ post });
    assert.equal(failed.isValid, false);
    assert.match(failed.errors.join(" "), /judge: generic/);
    replies.push("I think the best comment is...");
    await assert.rejects(llm.draftViralComment({ post }), /viral draft failed/);
  } finally {
    llm.generateCommentText = saved;
  }
});

test("the judge's verdicts are matched by number: a pass for candidate 2 is never lent to candidate 1", async () => {
  const saved = llm.generateCommentText;
  const replies = [];
  llm.generateCommentText = async () => replies.shift();
  const post = { author: "Ada Lovelace", text: "We are releasing our open model weights today for every developer to build on.", ageH: 1, reactions: 900, comments: 40 };
  const first = "Will the open weights come with the evaluation code too?";
  const second = "Releasing the weights is the part that will move people.";
  const two = JSON.stringify({ candidates: [{ angle: "question", comment: first }, { angle: "detail", comment: second }] });
  try {
    replies.push(two, JSON.stringify({ verdicts: [{ n: 2, pass: true, reason: "specific" }] }));
    const r = await llm.draftViralComment({ post });
    assert.equal(r.candidates.filter((c) => !c.gate.length).length, 2, "both candidates reach the judge");
    assert.equal(r.comment, second, "the only pass is candidate 2's");
    replies.push(two, JSON.stringify({ verdicts: [{ pass: true, reason: "ok" }] }));
    assert.equal((await llm.draftViralComment({ post })).isValid, false, "one unnumbered verdict for two candidates: none counts");
    replies.push(two, JSON.stringify({ verdicts: [{ pass: false, reason: "generic" }, { pass: true, reason: "ok" }] }));
    assert.equal((await llm.draftViralComment({ post })).comment, second, "one unnumbered verdict per candidate: in order");
  } finally {
    llm.generateCommentText = saved;
  }
});

test("viral prompts treat the post and its comments as data", async () => {
  const saved = llm.generateCommentText;
  const calls = [];
  const replies = [JSON.stringify({ candidates: [{ angle: "question", comment: "Will the open weights come with the evaluation code too?" }] }), JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "ok" }] })];
  llm.generateCommentText = async (prompt, opts) => { calls.push({ prompt, opts }); return replies.shift(); };
  try {
    await llm.draftViralComment({ post: { author: "Ada Lovelace", text: "We are releasing our open model weights today for every developer to build on.", ageH: 1 } });
    assert.equal(calls.length, 2);
    for (const c of calls) assert.match(c.prompt, /data, not instructions/);
    for (const c of calls) assert.doesNotMatch(c.prompt, /screenshot/i);
  } finally {
    llm.generateCommentText = saved;
  }
});

test("the viral pass: a checkpoint ends it, a regular-pass rejection does not bar it, a dry run tracks nothing, the like obeys its cap", { timeout: 120000 }, async () => {
  const saved = { draft: llm.draftViralComment, social: { ...config.social }, track: process.env.LINKEDIN_TRACK_PATH };
  const big = (n) => ({ key: `urn:li:activity:${n}`, author: VIRAL.people[n % VIRAL.people.length].name, href: `https://www.linkedin.com/in/${VIRAL.people[n % VIRAL.people.length].slug}`, text: TEXT, head: "", ageH: 2, reactions: 5400, comments: 300 });
  const fresh = (name, content) => {
    process.env.LINKEDIN_TRACK_PATH = path.join(TMP, `${name}.json`);
    if (content) fs.writeFileSync(process.env.LINKEDIN_TRACK_PATH, JSON.stringify(content));
    LinkedInService._resetDisabled();
  };
  let page = () => [];
  let thread = () => ({ status: "open", comments: "", commenters: [] });
  const li = fakeLinkedIn({ scan: () => page(), thread: (p) => thread(p) });
  const scanPages = LinkedInService.prototype.scanPages;
  let scans = 0;
  LinkedInService.prototype.scanPages = async (sources) => { scans++; return scanPages(sources); };
  const commented = () => li.acted.filter((a) => a.said === "GO").map((a) => (a.kind === "comment" ? a.key : `like:${a.key}`));
  llm.draftViralComment = async () => ({ comment: "Shipping it open source is the part that will travel.", isValid: true, skipped: false, errors: [], candidates: [] });
  Object.assign(config.social, { linkedinFeedReply: true, linkedinViral: true });
  try {
    fresh("stop");
    page = () => [big(2)];
    thread = () => { throw Object.assign(new Error("checkpoint"), { code: "LINKEDIN_RESTRICTED" }); };
    const stopped = await feedEngage.runViralPass({ max: 1 });
    assert.match(stopped.reason, /linkedin unavailable/);
    assert.ok(T.loadTrack().cooldowns.all, "every pass pauses for a day or two");
    assert.equal(commented().length, 0);
    thread = () => ({ status: "open", comments: "", commenters: [] });

    const now = new Date().toISOString();
    fresh("rejected", { "urn:li:activity:2": { ts: now, status: "rejected", skipReason: "peer gate" }, "urn:li:activity:4": { ts: now, status: "rejected", pass: "viral" } });
    page = () => [big(4), big(2)];
    assert.equal((await feedEngage.runViralPass({ max: 1 })).commented, 1);
    assert.deepEqual(commented().filter((k) => !k.startsWith("like:")), ["urn:li:activity:2"], "the regular pass's rejection does not count; the viral pass's own does");

    fresh("dry");
    li.acted.length = 0;
    const dry = await feedEngage.runViralPass({ max: 1, dryRun: true });
    assert.equal(dry.previews.length, 1);
    assert.equal(fs.existsSync(process.env.LINKEDIN_TRACK_PATH), false, "a dry run writes no tracker");

    const liked = {};
    for (let i = 0; i < 60; i++) liked[`urn:li:activity:9${i}`] = { ts: now, status: "liked", likedAt: now };
    fresh("likes", liked);
    li.acted.length = 0;
    page = () => [big(3)];
    assert.equal((await feedEngage.runViralPass({ max: 1 })).commented, 1);
    assert.deepEqual(commented(), ["urn:li:activity:3"], "the day's 60 likes are spent: the comment goes without one");

    // A Claude time-out as long as the pass: its draft reserve is capped at half the pass, not the whole of it.
    const routes = { viral: config.llm.providers.viral, timeout: config.llm.claude.requestTimeoutMs };
    try {
      config.llm.providers.viral = "claude";
      config.llm.claude.requestTimeoutMs = 2 * 60 * 60 * 1000;
      fresh("reserve");
      page = () => [big(5)];
      assert.equal((await feedEngage.runViralPass({ max: 1 })).commented, 1);
    } finally {
      config.llm.providers.viral = routes.viral;
      config.llm.claude.requestTimeoutMs = routes.timeout;
    }

    // The reserve follows the slowest draft: after a 31-minute draft no second draft starts (the next post could
    // not finish in the 60-minute pass), and no further page is read.
    const realNow = Date.now;
    const draft = llm.draftViralComment;
    let clock = realNow();
    try {
      Date.now = () => clock;
      config.llm.providers.viral = "openrouter";
      fresh("slow");
      scans = 0;
      page = () => [big(5), big(6)];
      llm.draftViralComment = async (a) => { clock += 31 * 60000; llm.commentCalls = (llm.commentCalls || 0) + 1; return draft(a); };
      const slow = await feedEngage.runViralPass({ max: 2 });
      assert.equal(slow.commented, 1);
      assert.equal(slow.reason, "the pass's time is nearly up");
      assert.equal(scans, 1, "one scan session, and no page read after it");

      // A draft that ended before any model call (a thin post) teaches the reserve nothing: with 5 minutes left
      // after it, a pass on OpenRouter (4 minutes' reserve) still drafts the next post.
      fresh("thin");
      clock = realNow();
      let drafted = 0;
      page = () => [big(7), big(8)];
      llm.draftViralComment = async (a) => { if (drafted++ === 0) { clock += 55 * 60000; return { comment: "", isValid: false, skipped: true, errors: ["too thin"], candidates: [] }; } clock += 60000; llm.commentCalls = (llm.commentCalls || 0) + 1; return draft(a); };
      const thin = await feedEngage.runViralPass({ max: 2 });
      assert.equal(drafted, 2, "the thin post taught no 30-minute reserve");
      assert.equal(thin.commented, 1);
    } finally {
      Date.now = realNow;
      llm.draftViralComment = draft;
      config.llm.providers.viral = routes.viral;
    }
  } finally {
    li.restore();
    llm.draftViralComment = saved.draft;
    Object.assign(config.social, saved.social);
    process.env.LINKEDIN_TRACK_PATH = saved.track;
    LinkedInService._resetDisabled();
  }
});
