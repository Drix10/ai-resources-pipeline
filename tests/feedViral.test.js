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
  feedEngage.noteViralPage(track, "vip:quiet", []);
  assert.equal(track.meta.viralPages["vip:quiet"].perDay, 0);
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
