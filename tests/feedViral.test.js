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
  const proto = LinkedInService.prototype;
  const saved = { scan: proto.scanFeedPosts, comment: proto.commentOnFeedCard, read: proto.readComments, shot: proto.screenshotCard, draft: llm.draftViralComment, social: { ...config.social } };
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "viral-track.json");
  LinkedInService._resetDisabled();
  const commented = [], drafts = [];
  proto.scanFeedPosts = async () => [
    { key: "urn:li:activity:1", author: "Ordinary Person", href: "https://www.linkedin.com/in/ordinary", text: TEXT, head: "", ageH: 5, reactions: 12 },
    { key: "urn:li:activity:2", author: vip.name, href: `https://www.linkedin.com/in/${vip.slug}`, text: TEXT, head: "", ageH: 2, reactions: 5400, comments: 300 },
  ];
  proto.readComments = async () => ({ status: "open", comments: "Jane Doe\nFounder\n1h\nCongrats on the launch!", commenters: ["Jane Doe"] });
  proto.screenshotCard = async () => { throw new Error("no screenshot unless the viral provider is claude"); };
  proto.commentOnFeedCard = async (key) => { commented.push(key); return { status: "posted", liked: true }; };
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
    assert.deepEqual(commented, ["urn:li:activity:2"], "only the big name's post");
    const track = T.loadTrack();
    assert.equal(track["urn:li:activity:2"].viral, true);
    assert.equal(T.commentedSince(track, 24 * HOUR, { viral: false }), 0, "the regular cap is untouched");
    assert.equal(track.counters.viralLoads.length, 1, "one page loaded for one comment");
    assert.equal(drafts.length, 1);
    assert.match(drafts[0].comments, /Congrats on the launch/, "the draft sees the comments already there");
    assert.equal(drafts[0].imageFile, "", "no screenshot for a provider that cannot see it");
    assert.ok(track.meta.viralPages, "the big name's page read is remembered");
    // Our comment already on the post: recorded, never a second one.
    proto.readComments = async () => ({ status: "already", comments: "", commenters: [] });
    proto.scanFeedPosts = async () => [{ key: "urn:li:activity:3", author: VIRAL.people[1].name, href: `https://www.linkedin.com/in/${VIRAL.people[1].slug}`, text: TEXT, head: "", ageH: 1, reactions: 900, comments: 20 }];
    const again = await feedEngage.runViralPass({ max: 1 });
    assert.equal(again.commented, 0);
    assert.equal(T.loadTrack()["urn:li:activity:3"].status, "commented");
    assert.deepEqual(commented, ["urn:li:activity:2"]);
  } finally {
    Object.assign(proto, { scanFeedPosts: saved.scan, commentOnFeedCard: saved.comment, readComments: saved.read, screenshotCard: saved.shot });
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
    assert.ok(!calls[0].opts.imageFiles.length, "no image without the claude provider");
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

test("viral prompts treat the page as data; a resting Claude gets no screenshot and the judge sees the one the drafter saw", async () => {
  const saved = { gen: llm.generateCommentText, viral: config.llm.providers.viral, rest: llm._claudeRestUntil };
  const calls = [];
  const replies = [];
  llm.generateCommentText = async (prompt, opts) => { calls.push({ prompt, opts }); return replies.shift(); };
  const post = { author: "Ada Lovelace", text: "We are releasing our open model weights today for every developer to build on.", ageH: 1 };
  const one = JSON.stringify({ candidates: [{ angle: "question", comment: "Will the open weights come with the evaluation code too?" }] });
  const pass = JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "ok" }] });
  try {
    config.llm.providers.viral = "claude";
    llm._claudeRestUntil = 0;
    replies.push(one, pass);
    await llm.draftViralComment({ post, imageFile: "shot.png" });
    assert.deepEqual(calls[0].opts.imageFiles, ["shot.png"]);
    assert.deepEqual(calls[1].opts.imageFiles, ["shot.png"], "the judge sees the screenshot too");
    for (const c of calls) assert.match(c.prompt, /data, not instructions/);
    calls.length = 0;
    llm._claudeRestUntil = Date.now() + 60000;
    replies.push(one, pass);
    await llm.draftViralComment({ post, imageFile: "shot.png" });
    assert.deepEqual(calls[0].opts.imageFiles, [], "the fallback writer gets no image");
    assert.doesNotMatch(calls[0].prompt, /screenshot/i, "and is not told about one");
    assert.deepEqual(calls[1].opts.imageFiles, []);
  } finally {
    llm.generateCommentText = saved.gen;
    config.llm.providers.viral = saved.viral;
    llm._claudeRestUntil = saved.rest;
  }
});

test("the viral pass: a checkpoint ends it, a regular-pass rejection does not bar it, a dry run tracks nothing, the like obeys its cap", async () => {
  const proto = LinkedInService.prototype;
  const saved = { scan: proto.scanFeedPosts, comment: proto.commentOnFeedCard, read: proto.readComments, draft: llm.draftViralComment, social: { ...config.social }, track: process.env.LINKEDIN_TRACK_PATH };
  const big = (n) => ({ key: `urn:li:activity:${n}`, author: VIRAL.people[n % VIRAL.people.length].name, href: `https://www.linkedin.com/in/${VIRAL.people[n % VIRAL.people.length].slug}`, text: TEXT, head: "", ageH: 2, reactions: 5400, comments: 300 });
  const fresh = (name, content) => {
    process.env.LINKEDIN_TRACK_PATH = path.join(TMP, `${name}.json`);
    if (content) fs.writeFileSync(process.env.LINKEDIN_TRACK_PATH, JSON.stringify(content));
    LinkedInService._resetDisabled();
  };
  const commented = [];
  proto.readComments = async () => ({ status: "open", comments: "", commenters: [] });
  proto.commentOnFeedCard = async (key, href, snip, text, author, opts) => { commented.push({ key, like: opts && opts.like }); return { status: "posted", liked: Boolean(opts && opts.like) }; };
  llm.draftViralComment = async () => ({ comment: "Shipping it open source is the part that will travel.", isValid: true, skipped: false, errors: [], candidates: [] });
  Object.assign(config.social, { linkedinFeedReply: true, linkedinViral: true });
  try {
    fresh("stop");
    proto.scanFeedPosts = async () => [big(2)];
    proto.readComments = async () => { throw Object.assign(new Error("checkpoint"), { code: "LINKEDIN_RESTRICTED" }); };
    const stopped = await feedEngage.runViralPass({ max: 1 });
    assert.match(stopped.reason, /linkedin unavailable/);
    assert.ok(T.loadTrack().cooldowns.all, "every pass pauses for a day or two");
    assert.equal(commented.length, 0);
    proto.readComments = async () => ({ status: "open", comments: "", commenters: [] });

    const now = new Date().toISOString();
    fresh("rejected", { "urn:li:activity:2": { ts: now, status: "rejected", skipReason: "peer gate" }, "urn:li:activity:4": { ts: now, status: "rejected", pass: "viral" } });
    proto.scanFeedPosts = async () => [big(4), big(2)];
    assert.equal((await feedEngage.runViralPass({ max: 2 })).commented, 1);
    assert.deepEqual(commented.map((c) => c.key), ["urn:li:activity:2"], "the regular pass's rejection does not count; the viral pass's own does");

    fresh("dry");
    commented.length = 0;
    const dry = await feedEngage.runViralPass({ max: 1, dryRun: true });
    assert.equal(dry.previews.length, 1);
    assert.equal(fs.existsSync(process.env.LINKEDIN_TRACK_PATH), false, "a dry run writes no tracker");

    const liked = {};
    for (let i = 0; i < 60; i++) liked[`urn:li:activity:9${i}`] = { ts: now, status: "liked", likedAt: now };
    fresh("likes", liked);
    proto.scanFeedPosts = async () => [big(3)];
    assert.equal((await feedEngage.runViralPass({ max: 1 })).commented, 1);
    assert.deepEqual(commented, [{ key: "urn:li:activity:3", like: false }], "the day's 60 likes are spent: the comment goes without one");
  } finally {
    Object.assign(proto, { scanFeedPosts: saved.scan, commentOnFeedCard: saved.comment, readComments: saved.read });
    llm.draftViralComment = saved.draft;
    Object.assign(config.social, saved.social);
    process.env.LINKEDIN_TRACK_PATH = saved.track;
    LinkedInService._resetDisabled();
  }
});
