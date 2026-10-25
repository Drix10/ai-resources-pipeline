require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Every tracker read/write in this file goes to a throwaway dir, never data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-engage-test-"));
process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "track.json");
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const config = require("../config");
const LinkedInService = require("../src/services/linkedin");
const feedEngage = require("../src/services/feedEngage");
const llm = require("../src/services/llm");
const { scorePost, _tracker, _reciprocity: R } = feedEngage;
const { shouldSkipTracked, entryOfPost } = _tracker;

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

test("a post commented under another of its keys is still recognised", () => {
  const track = { oldkey: { ts: ago(1), status: "commented" } };
  assert.equal(shouldSkipTracked(track, "newkey", "oldkey"), true);
  assert.equal(shouldSkipTracked(track, "newkey", "otherkey"), false);
});

test("an entry under the primary key wins over a stale one under another key", () => {
  const track = { newkey: { ts: ago(1), status: "liked" }, oldkey: { ts: ago(1), status: "commented" } };
  assert.equal(shouldSkipTracked(track, "newkey", "oldkey"), false, "the new entry is the source of truth");
});

test("commented posts are never repeated; rejected posts rest 3 days, skipped posts 30", () => {
  assert.equal(shouldSkipTracked({ k: { ts: ago(20), status: "commented" } }, "k"), true);
  assert.equal(shouldSkipTracked({ k: { ts: ago(1), status: "rejected" } }, "k"), true);
  assert.equal(shouldSkipTracked({ k: { ts: ago(1), status: "skipped" } }, "k"), true);
  assert.equal(shouldSkipTracked({ k: { ts: ago(4), status: "rejected" } }, "k"), false, "eligible again after the rest period");
  assert.equal(shouldSkipTracked({ k: { ts: ago(4), status: "skipped" } }, "k"), true, "an LLM SKIP is about the post: remembered 30 days");
  assert.equal(shouldSkipTracked({ k: { ts: ago(0.1), status: "liked" } }, "k"), false, "a like alone does not block a comment");
  assert.equal(shouldSkipTracked({}, "k"), false);
  assert.equal(shouldSkipTracked({ k: "2026-01-01T00:00:00Z" }, "k"), true, "a plain-string entry counts as commented");
});

test("entryOfPost reads the primary key first, then the author key, and tolerates both missing", () => {
  assert.equal(entryOfPost({ a: { ts: ago(0), status: "liked", likedAt: "x" } }, { key: "a", authorKey: "b" }).likedAt, "x");
  assert.equal(entryOfPost({ b: { ts: ago(0), status: "liked", likedAt: "y" } }, { key: "a", authorKey: "b" }).likedAt, "y");
  assert.equal(entryOfPost({}, { key: "a" }).likedAt, undefined);
});

// ---- Audience targeting: AI and tech first, then finance ----
const BUILDER = "We shipped an open source AI agents framework for developers building with LLMs this week.";

test("audience scoring: an AI post outranks a finance-only one, both are engaged, and off-topic or promo posts get nothing", () => {
  const builder = scorePost({ head: "Founder • 2nd", text: BUILDER, ageH: 2, reactions: 80, comments: 6 });
  const finance = scorePost({ head: "Portfolio manager", text: "The Fed held rates and bond yields moved; equity markets priced in a slower economy this quarter.", ageH: 2 });
  const generic = scorePost({ head: "someone", text: "Had a great weekend with the family and the dog at the lake.", ageH: 2, reactions: 40 });
  const promo = scorePost({ head: "", text: "We're hiring! Join us for our fintech webinar, register now, link in bio.", ageH: 1 });
  assert.ok(builder >= 7, `builder ${builder}: the priority audience, commented on and followed`);
  assert.ok(finance >= 4 && finance < builder, `finance ${finance}: the second audience, liked and commented on`);
  assert.equal(generic, 0, "off-topic: nothing, however fresh");
  assert.ok(promo < 3, `promo ${promo}`);
});

test("LINKEDIN_TARGETED=false: every pass reads the home feed, any topic counts, and connects come from People you may know", async () => {
  const proto = LinkedInService.prototype;
  const saved = { targeted: config.social.linkedinTargeted, people: proto.scanPeopleSearch, suggested: proto.scanSuggestedPeople, send: proto.sendConnectRequest, onPage: proto.onPeopleSearchPage, track: process.env.LINKEDIN_TRACK_PATH };
  const generic = { head: "Product designer • 1st", text: "Had a great weekend with the family and the dog at the lake, back to the roadmap tomorrow.", ageH: 2, reactions: 40, comments: 3 };
  assert.equal(scorePost(generic), 0, "targeted: off-topic gets nothing");
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "untargeted-track.json");
  LinkedInService._resetDisabled();
  let searched = 0;
  const sent = [];
  proto.scanPeopleSearch = async () => { searched++; return { people: [] }; };
  proto.scanSuggestedPeople = async () => ({ people: [
    { label: "Invite Mia Chen to connect", name: "Mia Chen", href: "https://www.linkedin.com/in/mia", text: "Mia Chen Product designer at a studio in London" },
    { label: "Invite Sam Roe to connect", name: "Sam Roe", href: "https://www.linkedin.com/in/sam", text: "Sam Roe Technical recruiter, talent acquisition" },
  ] });
  proto.sendConnectRequest = async (p) => { sent.push(p.href); return "sent"; };
  proto.onPeopleSearchPage = async () => true;
  try {
    config.social.linkedinTargeted = false;
    assert.ok(scorePost(generic) >= 4, "untargeted: a post in our feed is liked and commented on whatever its topic");
    assert.equal(scorePost({ ...generic, text: "We're hiring! Join our webinar, register now, link in bio, apply now today." }) < 3, true, "promo is still marked down");
    assert.deepEqual(R.buildSources({}).map((s) => s.label), ["feed:top", "feed:recent"]);
    assert.deepEqual(feedEngage.buildViralSources({}).map((s) => s.label), ["feed:top", "feed:recent"]);
    const c = await feedEngage.runConnectPass({ min: 2, max: 2 });
    assert.equal(searched, 0, "no people search");
    assert.deepEqual(sent, ["https://www.linkedin.com/in/mia"], "no topic or US filter; recruiters still skipped");
    assert.equal(c.sent, 1);
  } finally {
    config.social.linkedinTargeted = saved.targeted;
    Object.assign(proto, { scanPeopleSearch: saved.people, scanSuggestedPeople: saved.suggested, sendConnectRequest: saved.send, onPeopleSearchPage: saved.onPage });
    process.env.LINKEDIN_TRACK_PATH = saved.track;
  }
});

test("audience scoring: an early, mid-size, in-network post where a comment is seen beats a buried celebrity one", () => {
  const base = { text: BUILDER };
  const early = scorePost({ ...base, head: "Engineer • 2nd", ageH: 1, reactions: 120, comments: 8 });
  const buried = scorePost({ ...base, head: "CEO • 3rd+", ageH: 30, reactions: 25000, comments: 900 });
  const stale = scorePost({ ...base, head: "Engineer • 3rd+", ageH: 100, reactions: 0, comments: 0 });
  const recruiter = scorePost({ ...base, head: "Technical Recruiter • 2nd", ageH: 1, reactions: 120, comments: 8 });
  assert.ok(early - buried >= 4, `early ${early} vs buried ${buried}`);
  assert.ok(stale < early, `stale ${stale}`);
  assert.equal(early - recruiter, 3, "a recruiter account is marked down");
});

// ---- Reciprocity: notifications, warm people, warm sources ----
test("notifications: only what people did with our account counts, with its age", () => {
  const kind = LinkedInService.notificationKind;
  assert.equal(kind("Jane Doe commented on your post: Nice work on the eval harness 3h"), "comment");
  assert.equal(kind("Jane Doe replied to your comment on Sam Lee's post 1d"), "reply");
  assert.equal(kind("Jane Doe mentioned you in a comment 2d"), "mention");
  assert.equal(kind("Jane Doe and 12 others reacted to your post 5h"), "reaction");
  assert.equal(kind("Jane Doe likes your comment: The retry part matters 1w"), "reaction");
  assert.equal(kind("Jane Doe reposted your post 4h"), "repost");
  assert.equal(kind("Jane Doe accepted your invitation. Start a conversation 6h"), "accepted");
  assert.equal(kind("Jane Doe followed you 2d"), "follow");
  assert.equal(kind("Jane Doe posted: We launched our new AI agent 2h"), "", "a post by someone we follow is not engagement with us");
  assert.equal(kind("Jane Doe posted: Has anyone mentioned you can deduct this? 2h"), "", "quoted text after the headline is never read");
  assert.equal(kind("Jane Doe posted: Nobody likes your post if it has no hook 1d"), "");
  assert.equal(kind("Sam Lee commented on Jane Doe's post: it commented on your post earlier 3h"), "");
  assert.equal(kind("Jane Doe commented on Sam Lee's post 2h"), "");
  assert.equal(kind("Your post is getting attention. 3h"), "");
  const name = LinkedInService.notificationName;
  assert.equal(name("Jane Doe", "Jane Doe commented on your post"), "Jane Doe");
  assert.equal(name("Status is reachable", "Status is reachable Jane Doe commented on your post: great"), "Jane Doe", "the picture's presence label is no name");
  assert.equal(name("", "Jane Doe and 3 others reacted to your post"), "Jane Doe");
  const age = LinkedInService.notificationAgeH;
  assert.equal(age("Jane Doe commented on your post 3h"), 3);
  assert.equal(age("Jane Doe followed you 2d"), 48);
  assert.equal(age("Jane Doe commented on your post: It took 2 weeks to ship 1w"), 168, "the age chrome after the text, not a number quoted from the comment");
  assert.equal(age("Jane Doe reposted your post"), null, "no age shown: unknown, not new");
});

test("warm people: recorded with what they did, an accepted invite marked, old and company notifications ignored", () => {
  const now = Date.now();
  const track = {
    "conn:https://www.linkedin.com/in/new-connection": { ts: new Date(now - 2 * DAY).toISOString(), status: "invited" },
    p1: { ts: ago(3), status: "liked", likedAt: ago(3), authorHref: "https://www.linkedin.com/in/commenter" },
  };
  const added = R.noteWarmPeople(track, [
    { kind: "comment", name: "Commenter", href: "https://www.linkedin.com/in/commenter/", ageH: 2 },
    { kind: "reaction", name: "Commenter", href: "https://www.linkedin.com/in/commenter", ageH: 30 },
    { kind: "accepted", name: "New Connection", href: "https://www.linkedin.com/in/new-connection", ageH: 5 },
    { kind: "comment", name: "Old", href: "https://www.linkedin.com/in/old", ageH: 10 * 24 },
    { kind: "comment", name: "Acme", href: "https://www.linkedin.com/company/acme", ageH: 1 },
  ], now);
  assert.equal(added, 2);
  const c = track["warm:https://www.linkedin.com/in/commenter"];
  assert.deepEqual(c.kinds, ["comment", "reaction"]);
  assert.equal(c.ourFirst, true, "we liked them first, and they came back");
  assert.equal(Date.parse(c.ts), now - 2 * 3600000, "ts is their latest engagement");
  assert.equal(track["warm:https://www.linkedin.com/in/new-connection"].ourFirst, true);
  assert.ok(track["conn:https://www.linkedin.com/in/new-connection"].acceptedAt, "the invite is marked accepted");
  assert.equal(track["warm:https://www.linkedin.com/in/old"], undefined, "a notification over a week old");
  assert.equal(Object.keys(track).filter((k) => k.includes("company")).length, 0);
  assert.equal(R.warmPeople(track).length, 2);
  // a notification with no age never moves a known person's ts (it would keep them warm forever)
  const ts = track["warm:https://www.linkedin.com/in/commenter"].ts;
  R.noteWarmPeople(track, [{ kind: "comment", name: "Commenter", href: "https://www.linkedin.com/in/commenter", ageH: null }], now + 5 * DAY);
  assert.equal(track["warm:https://www.linkedin.com/in/commenter"].ts, ts);
  assert.equal(_tracker.likedSince(track, DAY), 0, "warm entries never count toward a cap");
  assert.equal(_tracker.commentedSince(track, DAY), 0);
});

test("a reply, reaction or mention from an author we commented on marks our latest comment to them as answered", () => {
  const now = Date.now();
  const ada = "https://www.linkedin.com/in/ada";
  const track = {
    old: { ts: ago(5), status: "commented", commentedAt: ago(5), comment: "Older comment on Ada.", authorHref: ada },
    latest: { ts: ago(2), status: "commented", commentedAt: ago(2), comment: "Latest comment on Ada.", authorHref: ada },
    after: { ts: new Date(now - 3600000).toISOString(), status: "commented", commentedAt: new Date(now - 3600000).toISOString(), comment: "Comment after her reply.", authorHref: ada },
    bob: { ts: ago(1), status: "commented", commentedAt: ago(1), comment: "Comment on Bob.", authorHref: "https://www.linkedin.com/in/bob" },
  };
  R.noteWarmPeople(track, [
    { kind: "reply", name: "Ada", href: `${ada}/`, ageH: 24 },
    { kind: "follow", name: "Bob", href: "https://www.linkedin.com/in/bob", ageH: 2 },
  ], now);
  assert.ok(track.latest.answeredAt, "the latest comment before her reply earned it");
  assert.equal(track.old.answeredAt, undefined);
  assert.equal(track.after.answeredAt, undefined, "a comment after the reply did not earn it");
  assert.equal(track.bob.answeredAt, undefined, "a follow is not an answer to a comment");
  assert.deepEqual(_tracker.recentComments(track).map((c) => [c.text, c.answered]), [
    ["Comment after her reply.", false], ["Comment on Bob.", false], ["Latest comment on Ada.", true], ["Older comment on Ada.", false],
  ]);
});

test("warm sources go first: a conversation before a nod, never a page read lately or a person liked today", () => {
  const now = Date.now();
  const iso = (h) => new Date(now - h * 3600000).toISOString();
  const track = {
    "warm:https://www.linkedin.com/in/nod": { ts: iso(1), status: "warm", kinds: ["reaction"] },
    "warm:https://www.linkedin.com/in/talker": { ts: iso(20), status: "warm", kinds: ["comment"] },
    "warm:https://www.linkedin.com/in/visited": { ts: iso(1), status: "warm", kinds: ["comment"], visitedAt: iso(5) },
    "warm:https://www.linkedin.com/in/liked": { ts: iso(1), status: "warm", kinds: ["mention"] },
    "warm:https://www.linkedin.com/in/cold": { ts: iso(20 * 24), status: "warm", kinds: ["comment"] },
    p1: { ts: iso(2), status: "liked", likedAt: iso(2), authorHref: "https://www.linkedin.com/in/liked" },
  };
  const src = R.warmSources(track, 5, now);
  assert.deepEqual(src.map((s) => s.label), ["warm:talker", "warm:nod"]);
  // the comment pass has its own visits and its own author gap: liked today is no bar to a comment
  assert.deepEqual(R.warmSources(track, 5, now, "comment").map((s) => s.label), ["warm:visited", "warm:talker", "warm:liked", "warm:nod"]);
  assert.equal(src[0].url, "https://www.linkedin.com/in/talker/recent-activity/all/");
  assert.deepEqual(R.buildSources(track).slice(0, 2).map((s) => s.label), ["warm:talker", "warm:nod"]);
});

test("a warm author's post scores higher; a sensitive one still gets nothing", () => {
  const track = { "warm:https://www.linkedin.com/in/warm": { ts: ago(0.1), status: "warm", kinds: ["comment"] } };
  const off = { href: "https://www.linkedin.com/in/warm", head: "", text: "A long weekend hiking the coastal trail with old friends, the views were worth every step.", ageH: 5 };
  assert.equal(scorePost(off), 0);
  assert.equal(R.audienceScore(track, off), 3, "a like back, whatever the topic");
  assert.equal(R.audienceScore(track, { ...off, href: "https://www.linkedin.com/in/stranger" }), 0);
  assert.ok(R.audienceScore(track, { ...off, text: "We're hiring! Apply now, link in bio, join our free webinar." }) < 0, "a warm author's promo still gets nothing");
  assert.equal(R.audienceScore(track, { ...off, text: "My father passed away last week, after a long illness. Thank you all for the kind words." }), -99);
});

test("a warm person known by member id is recognised on their posts' vanity link once their page is read", () => {
  const idKey = "warm:https://www.linkedin.com/in/ACoAAB12345";
  const track = { [idKey]: { ts: ago(0.1), status: "warm", name: "Jane Doe", kinds: ["comment"] } };
  const vanity = "https://www.linkedin.com/in/jane-doe-42";
  R.noteWarmPage(track, { warmKey: idKey }, [
    { author: "Jane Doe", href: vanity },
    { author: "Sam Lee", href: "https://www.linkedin.com/in/sam-lee" },
  ]);
  assert.ok(track[idKey].visitedAt);
  assert.equal(track[`warm:${vanity}`].aliasOf, idKey);
  assert.equal(track["warm:https://www.linkedin.com/in/sam-lee"], undefined, "only the person whose page it is");
  const post = { href: vanity, head: "", text: "A long weekend hiking the coastal trail with old friends, the views were worth every step.", ageH: 5 };
  assert.equal(R.audienceScore(track, post), 3);
  assert.equal(R.warmPeople(track).length, 1, "one person, not two");
  // A notification's escaped link ("%2D") is the same person as their posts' link.
  const fresh = {};
  R.noteWarmPeople(fresh, [{ kind: "reaction", name: "Jane Doe", href: "https://www.linkedin.com/in/jane%2Ddoe%2D42", ageH: 2 }]);
  assert.deepEqual(Object.keys(fresh).filter((k) => k.startsWith("warm:")), [`warm:${vanity}`]);
  // A comment on their vanity link this week keeps their page out of the comment pass.
  assert.equal(R.warmSources(track, 5, Date.now(), "comment").length, 1);
  track["urn:li:activity:1"] = { status: "commented", ts: ago(1), commentedAt: ago(1), authorHref: vanity };
  assert.deepEqual(R.warmSources(track, 5, Date.now(), "comment"), []);
});

test("the like pass reads notifications at most every 3 h and likes and follows back the warm person first; a company is never followed", async () => {
  const proto = LinkedInService.prototype;
  const saved = { scan: proto.scanFeedPosts, like: proto.likeFeedCard, follow: proto.followFeedCard, notes: proto.scanNotifications };
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "like-track.json");
  LinkedInService._resetDisabled();
  const scanned = [], follows = [];
  let notes = 0, stop = false;
  const warmHref = "https://www.linkedin.com/in/warm-person";
  proto.scanNotifications = async () => { notes++; return [{ kind: "comment", name: "Warm Person", href: warmHref, ageH: 2 }]; };
  proto.scanFeedPosts = async ({ url = "" } = {}) => {
    scanned.push(url);
    if (url.startsWith(warmHref)) return [{ key: "urn:li:activity:501", author: "Warm Person", href: warmHref, text: "A long weekend hiking the coastal trail with old friends, the views were worth every step.", head: "", ageH: 5 }];
    if (url.includes("/search/")) return [{ key: "urn:li:activity:502", author: "Acme", href: "https://www.linkedin.com/company/acme", text: BUILDER, head: "", ageH: 1, reactions: 50 }];
    return [];
  };
  proto.likeFeedCard = async () => { stop = true; return true; };
  proto.followFeedCard = async (snippet) => { follows.push(snippet); return true; };
  try {
    const r = await feedEngage.runLikePass({ min: 1, max: 1, shouldStop: () => stop });
    assert.equal(r.liked, 1);
    assert.ok(scanned[0].startsWith(`${warmHref}/recent-activity`), "the warm person's posts are the first source");
    assert.equal(follows.length, 1, "followed back below the follow score");
    const track = _tracker.loadTrack();
    assert.ok(track[`warm:${warmHref}`].visitedAt, "their page is not reloaded for a few days");
    assert.equal(track.counters.notifLoads.length, 1);
    stop = false;
    proto.likeFeedCard = async () => { stop = true; return true; };
    const again = await feedEngage.runLikePass({ min: 1, max: 1, shouldStop: () => stop });
    assert.equal(notes, 1, "notifications are not read again within 3 h");
    assert.equal(again.liked, 1, "the company's AI post is liked");
    assert.ok(!scanned.slice(1).some((u) => u.startsWith(warmHref)), "a warm page read today waits");
    assert.equal(follows.length, 1, "a company page is never followed");
  } finally {
    Object.assign(proto, { scanFeedPosts: saved.scan, likeFeedCard: saved.like, followFeedCard: saved.follow, scanNotifications: saved.notes });
  }
});

test("a page whose comment box will not open is left after two tries", async () => {
  const proto = LinkedInService.prototype;
  const saved = { scan: proto.scanFeedPosts, comment: proto.commentOnFeedCard, notes: proto.scanNotifications, draft: llm.draftFeedComment, reply: config.social.linkedinFeedReply };
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "no-editor-track.json");
  LinkedInService._resetDisabled();
  let scans = 0;
  const tries = new Map();
  proto.scanNotifications = async () => [];
  proto.scanFeedPosts = async () => {
    scans++;
    return [1, 2, 3, 4].map((i) => ({ key: `urn:li:activity:9${scans}0${i}`, author: `Builder ${scans}${i}`, href: `https://www.linkedin.com/in/builder-${scans}-${i}`, text: BUILDER, head: "", ageH: 1, reactions: 30, comments: 2 }));
  };
  proto.commentOnFeedCard = async (key) => {
    const page = key.slice("urn:li:activity:9".length, -2);
    tries.set(page, (tries.get(page) || 0) + 1);
    return { status: "failed", liked: false, reason: "no-editor" };
  };
  llm.draftFeedComment = async () => ({ comment: "Which part of the framework did the developers ask for first?", isValid: true, skipped: false, errors: [] });
  try {
    config.social.linkedinFeedReply = true;
    const res = await feedEngage.runFeedEngagement({ max: 2 });
    assert.equal(res.commented, 0);
    assert.ok(tries.size >= 1, "comments were tried");
    for (const [page, n] of tries) assert.equal(n, 2, `page ${page}: two tries, then the page is left`);
  } finally {
    Object.assign(proto, { scanFeedPosts: saved.scan, commentOnFeedCard: saved.comment, scanNotifications: saved.notes, readComments: saved.read });
    llm.draftFeedComment = saved.draft;
    config.social.linkedinFeedReply = saved.reply;
  }
});

// ---- Comment memory: never the same structure twice, never about us ----
test("the comment pass remembers what it posted and drafts against its latest comments and the post's thread", async () => {
  const proto = LinkedInService.prototype;
  const saved = { scan: proto.scanFeedPosts, comment: proto.commentOnFeedCard, notes: proto.scanNotifications, read: proto.readComments, draft: llm.draftFeedComment, reply: config.social.linkedinFeedReply };
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "comment-track.json");
  LinkedInService._resetDisabled();
  let n = 0;
  const recents = [];
  proto.scanNotifications = async () => [];
  proto.scanFeedPosts = async () => { n++; return [{ key: `urn:li:activity:70${n}`, author: `Builder ${n}`, href: `https://www.linkedin.com/in/builder-${n}`, text: BUILDER, head: "", ageH: 1, reactions: 30, comments: 2 }]; };
  proto.commentOnFeedCard = async () => ({ status: "posted", liked: false });
  const threads = [];
  proto.readComments = async () => ({ status: "open", comments: "Ana Lima\nThe agents part is underrated.", commenters: [] });
  llm.draftFeedComment = async ({ recent, comments }) => { recents.push(recent); threads.push(comments); return { comment: `Which part of the framework did the developers ask for first, take ${recents.length}?`, isValid: true, skipped: false, errors: [] }; };
  try {
    config.social.linkedinFeedReply = true;
    assert.equal((await feedEngage.runFeedEngagement({ max: 1 })).commented, 1);
    assert.equal((await feedEngage.runFeedEngagement({ max: 1 })).commented, 1);
    assert.deepEqual(recents[0], []);
    assert.equal(threads[0], "Ana Lima\nThe agents part is underrated.", "the thread readComments read reaches the drafter");
    assert.deepEqual(recents[1], [{ text: "Which part of the framework did the developers ask for first, take 1?", answered: false }]);
    const track = _tracker.loadTrack();
    assert.deepEqual(_tracker.recentComments(track).map((c) => c.text), [
      "Which part of the framework did the developers ask for first, take 2?",
      "Which part of the framework did the developers ask for first, take 1?",
    ], "newest first");
  } finally {
    Object.assign(proto, { scanFeedPosts: saved.scan, commentOnFeedCard: saved.comment, scanNotifications: saved.notes });
    llm.draftFeedComment = saved.draft;
    config.social.linkedinFeedReply = saved.reply;
  }
});

test("comment gates: a reply that opens or runs like a recent comment, or promotes us, is rejected", () => {
  const post = "We open sourced our evaluation suite for agents today, with the retry logic we use in production.";
  const recent = ["The retry logic is the part most teams will copy first.", "Curious how the suite handles flaky tools.", "Congrats on the launch!"];
  const errs = (reply) => llm.validateCommentReply(reply, post, "Ada", recent).errors.join(" ");
  assert.match(errs("The retry logic is what I would read first in production."), /opens like one of your recent comments/);
  assert.match(errs("Shipping the suite is the part most teams will copy first."), /repeats the phrasing/);
  assert.match(errs("Does the suite keep the retry logic per agent? I wrote about this on my blog."), /promotes the replier/);
  assert.match(errs("Is the retry logic per agent? Check out my repo for one."), /promotes the replier/);
  assert.equal(errs("Does the suite keep the retry logic separate per agent?"), "");
  // a short congratulation may share an opening; only the same words twice are a repeat
  assert.equal(errs("Congrats on the open sourced suite!"), "");
  assert.match(errs("Congrats on the launch!"), /word for word/);
  // a question about the post's own pricing or usage is not self-promotion
  assert.doesNotMatch(errs("Would teams subscribe to the suite if usage drops in production?"), /promotes/);
  assert.doesNotMatch(errs("Do you check out the retry logic per agent in production?"), /promotes/);
  assert.equal(llm.validateCommentReply("The retry logic is the part most teams will copy first.", post, "Ada").isValid, true, "no memory, no repeat");
});

test("the viral drafter sees our latest comments and drops a candidate that repeats one", async () => {
  const saved = llm.generateCommentText;
  const prompts = [];
  const replies = [
    JSON.stringify({ skip: false, candidates: [
      { angle: "detail", comment: "Releasing the weights is the part most teams will copy first." },
      { angle: "question", comment: "Will the open weights come with the evaluation code too?" },
    ] }),
    JSON.stringify({ verdicts: [{ n: 1, pass: true, reason: "specific" }] }),
  ];
  llm.generateCommentText = async (prompt) => { prompts.push(prompt); return replies.shift(); };
  try {
    const post = { author: "Ada Lovelace", text: "We are releasing our open model weights today for every developer to build on.", ageH: 1, reactions: 900, comments: 40 };
    const r = await llm.draftViralComment({ post, recent: [{ text: "Shipping the harness is the part most teams will copy first.", answered: false }] });
    assert.equal(r.comment, "Will the open weights come with the evaluation code too?");
    assert.match(r.candidates[0].gate.join(" "), /repeats the phrasing/);
    assert.match(prompts[0], /YOUR LATEST COMMENTS ON OTHER POSTS[\s\S]*Shipping the harness/);
    assert.match(prompts[1], /promotes the commenter/, "the judge fails self-promotion");
  } finally {
    llm.generateCommentText = saved;
  }
});
