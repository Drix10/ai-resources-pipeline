const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

// Every tracker read/write in this file goes to a throwaway dir, never data/.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "linkedin-track-test-"));
process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "track.json");
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const LinkedInService = require("../src/services/linkedin");
const feedEngage = require("../src/services/feedEngage");
const llm = require("../src/services/llm");
const { scorePost, isSensitivePost, _tracker: T } = feedEngage;

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

// ---- Sensitive posts and comment-bait get no like, follow or comment ----
test("sensitive posts score -99 even when they hit every audience term", () => {
  const audience = " Venture capital investors in New York, fintech and AI startups.";
  const cases = [
    "My father passed away last week. He taught me everything about markets." + audience,
    "Election day is here and the other party is destroying this country, vote them out." + audience,
    "Our hearts are with everyone in Gaza tonight." + audience,
    "After 6 years I was laid off this morning along with 300 colleagues." + audience,
    "Thoughts and prayers for the victims of the shooting downtown." + audience,
    "RIP to a legend of the trading floor." + audience,
    "The war in Ukraine keeps reshaping energy and commodities markets." + audience,
  ];
  for (const text of cases) assert.equal(scorePost({ head: "VC partner", text, ageH: 1 }), -99, text.slice(0, 40));
});

test("comment-bait is excluded outright, not just penalised", () => {
  const bait = [
    "Comment AGENT and I'll send you my fintech AI agents playbook for venture capital investors.",
    "Drop a YES below and I will DM you the guide to raising venture capital for AI startups.",
    "Comment \"PDF\" to get the full private equity and AI investing template.",
  ];
  for (const text of bait) assert.equal(scorePost({ head: "", text, ageH: 1 }), -99, text.slice(0, 40));
});

test("finance/tech compounds and ordinary verbs are not sensitive", () => {
  assert.equal(isSensitivePost("The price war in cloud GPUs is squeezing AI startups."), false);
  assert.equal(isSensitivePost("A talent war for ML engineers is back in New York."), false);
  assert.equal(isSensitivePost("We rip and replace legacy systems for banks."), false, "lowercase rip is a verb");
  const finance = scorePost({ head: "VC partner, New York", text: "The Fed held rates while venture funding for AI startups rose; investors price equity differently now.", ageH: 2 });
  assert.ok(finance >= 6, `finance ${finance}`);
});

// ---- Post keys: tallies, reactions and "…more" never change a key ----
const BODY = "\nWe moved our payments ledger to an event-sourced design and settlement errors fell sharply for the finance team.";
test("tally, reaction and video lines never change a post's key", () => {
  const a = LinkedInService.postKeys({ href: "https://x/in/a", body: `${BODY}\nJane Smith and 45 others\n2 comments` });
  const b = LinkedInService.postKeys({ href: "https://x/in/a", body: `${BODY}\nJohn Doe and 46 others\n3 comments • 1 repost` });
  const c = LinkedInService.postKeys({ href: "https://x/in/a", body: `${BODY}\nRemaining time 0:45\n12 reactions` });
  const d = LinkedInService.postKeys({ href: "https://x/in/a", body: `${BODY} …more` });
  assert.equal(a.key, b.key);
  assert.equal(a.key, c.key);
  assert.equal(a.key, d.key);
  assert.match(a.key, /^c1:[0-9a-f]{16}$/);
});

test("the activity URN wins as the key; older key schemes stay as altKeys", () => {
  const crypto = require("crypto");
  const h = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
  const body = `${BODY}\n2 comments`;
  const k = LinkedInService.postKeys({ href: "https://x/in/a", urn: "urn:li:activity:7212345678901234567", body });
  assert.equal(k.key, "urn:li:activity:7212345678901234567");
  assert.ok(k.altKeys.includes(h(`body|${body.slice(0, 300)}`)), "pre-change body key still looked up");
  assert.equal(k.legacyKey, h(`https://x/in/a|${body.slice(0, 300)}`));
  assert.equal(LinkedInService.postKeys({ urn: "urn:li:activity:1 OR 1", body }).key.startsWith("c1:"), true, "junk URN ignored");
});

test("a body sentence about comments is commentary, not a tally line", () => {
  const t = LinkedInService.commentaryText("I read 300 comments on the Fed thread and two ideas stood out for treasury teams.\n4 comments");
  assert.equal(t, "I read 300 comments on the Fed thread and two ideas stood out for treasury teams.");
});

test("header strip handles month and year timestamps", () => {
  const body = LinkedInService.postBodyFromLines(["Feed post", "Jane Doe • 2nd", "CFO at Foo", "3mo • Edited", "Quarter close took nine days less after we automated reconciliations."]);
  assert.equal(body.trim(), "Quarter close took nine days less after we automated reconciliations.");
});

test("Promoted is an ad label only as its own header line", () => {
  assert.equal(LinkedInService.isFeedSpamText("Acme Corp\nPromoted\nOur new cloud platform scales to millions of requests."), true);
  assert.equal(LinkedInService.isFeedSpamText("Acme Corp • Promoted • Follow Our new cloud platform scales."), true);
  assert.equal(LinkedInService.isFeedSpamText("Jane Doe • 1st • 3h\nPromoted by the board to CFO this week, grateful for the trust."), false);
  assert.equal(LinkedInService.isFeedSpamText("Jane Doe • 1st • 3h\nThe promoted products in our app grew 2x."), false);
});

test("restriction pages are recognised from the URL and page chrome", () => {
  const R = LinkedInService.restrictionReason;
  assert.equal(R("https://www.linkedin.com/checkpoint/challenge/abc"), "restricted");
  assert.equal(R("https://www.linkedin.com/authwall?trk=x"), "restricted");
  assert.equal(R("https://www.linkedin.com/uas/login?session_redirect=x"), "login");
  assert.equal(R("https://www.linkedin.com/feed/", "LinkedIn | We've detected unusual activity"), "restricted");
  assert.equal(R("https://www.linkedin.com/feed/", "Let’s do a quick security check"), "restricted");
  assert.equal(R("https://www.linkedin.com/search/results/people/", "You've reached the monthly limit for profile searches"), "restricted");
  assert.equal(R("https://www.linkedin.com/feed/", "Feed | LinkedIn"), "");
});

// ---- Critic verdict fails closed ----
test("critic: only a verdict that opens with PASS passes", () => {
  for (const raw of ["PASS", "PASS: grounded", "**PASS**: fine", "pass - names the point"]) {
    assert.equal(llm.parseCriticVerdict(raw).pass, true, raw);
  }
  for (const raw of ["**FAIL**: invents a number", "Verdict: FAIL", "The reply fails (5).", "", "   ", null, "I think this is okay", "FAIL"]) {
    assert.equal(llm.parseCriticVerdict(raw).pass, false, String(raw));
  }
  assert.equal(llm.parseCriticVerdict("FAIL: invents \"40%\"").reason, "invents \"40%\"");
});

test("critic: an empty model answer is a FAIL, not a PASS", async () => {
  const real = llm.generateCommentText;
  llm.generateCommentText = async () => "";
  try {
    assert.equal((await llm.criticFeedComment("Congrats on the launch!", "We launched today.")).pass, false);
  } finally {
    llm.generateCommentText = real;
  }
});

// ---- Tracker: fails closed, durable writes ----
const file = process.env.LINKEDIN_TRACK_PATH;
const reset = () => { for (const f of fs.readdirSync(TMP)) fs.rmSync(path.join(TMP, f), { force: true }); };

test("tracker: missing file is a fresh start; saves keep a .bak", () => {
  reset();
  const t = T.loadTrack();
  assert.deepEqual(t, {});
  assert.equal(t.disabled, undefined);
  t.k1 = { ts: ago(0), status: "liked", likedAt: ago(0) };
  assert.equal(T.saveTrack(t), true);
  t.k2 = { ts: ago(0), status: "commented" };
  assert.equal(T.saveTrack(t), true);
  assert.ok(fs.existsSync(`${file}.bak`));
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8"))), ["k1"]);
  assert.deepEqual(Object.keys(T.loadTrack()), ["k1", "k2"]);
  assert.equal(fs.readdirSync(TMP).filter((f) => f.endsWith(".tmp")).length, 0, "no tmp left behind");
});

test("tracker: a corrupt file is moved aside and the .bak restored", () => {
  reset();
  fs.writeFileSync(`${file}.bak`, JSON.stringify({ old: { ts: ago(1), status: "commented" } }));
  fs.writeFileSync(file, "{ \"half\": { \"ts\": ");
  const t = T.loadTrack();
  assert.equal(t.disabled, undefined);
  assert.ok(t.old, "backup content returned");
  assert.equal(fs.readdirSync(TMP).filter((f) => f.startsWith("track.json.corrupt-")).length, 1);
});

test("tracker: corrupt with no backup disables LinkedIn instead of returning {}", () => {
  reset();
  fs.writeFileSync(file, "not json at all");
  const t = T.loadTrack();
  assert.ok(t.disabled, "disabled tracker");
  assert.equal(T.saveTrack(t), false, "a disabled tracker is never written");
  assert.match(T.passBlocked(t, "like", { dryRun: true }), /^linkedin unavailable/);
  // Next run: the bad file was moved aside and nothing replaced it - still off, not a reset.
  assert.ok(T.loadTrack().disabled);
});

test("tracker: old-format files load unchanged and have no cooldowns", () => {
  reset();
  fs.writeFileSync(file, JSON.stringify({ a: "2026-09-19T16:07:27.441Z", b: { ts: ago(1), status: "liked" } }));
  const t = T.loadTrack();
  assert.equal(t.a, "2026-09-19T16:07:27.441Z");
  assert.equal(T.passBlocked(t, "connect", { dryRun: true }), "");
});

// ---- Circuit breaker ----
test("cooldowns: 'all' stops every pass, 'connect' only connects", () => {
  reset();
  const t = {};
  T.setCooldown(t, "connect", 7 * DAY, "test");
  assert.equal(T.passBlocked(t, "like", { dryRun: true }), "");
  assert.match(T.passBlocked(t, "connect", { dryRun: true }), /^linkedin unavailable \(connect cooldown/);
  T.setCooldown(t, "all", DAY, "test");
  assert.match(T.passBlocked(t, "comment", { dryRun: true }), /^linkedin unavailable \(cooldown/);
  assert.ok(T.loadTrack().cooldowns.all, "cooldown persisted");
});

test("a process-level disable blocks every pass until reset", () => {
  LinkedInService.disable(60000, "login required");
  try {
    assert.match(T.passBlocked({}, "like", { dryRun: true }), /^linkedin unavailable \(login required\)/);
  } finally {
    LinkedInService._resetDisabled();
  }
  assert.equal(T.passBlocked({}, "like", { dryRun: true }), "");
});

test("active hours: 8-22 by default, wrapping specs work", () => {
  const at = (h) => new Date(2026, 0, 1, h, 30);
  assert.equal(T.withinActiveHours(at(7), "8-22"), false);
  assert.equal(T.withinActiveHours(at(8), "8-22"), true);
  assert.equal(T.withinActiveHours(at(21), "8-22"), true);
  assert.equal(T.withinActiveHours(at(22), "8-22"), false);
  assert.equal(T.withinActiveHours(at(23), "22-6"), true);
  assert.equal(T.withinActiveHours(at(12), "22-6"), false);
});

// ---- Entries merge, prune keeps what caps need ----
test("a comment merges into the entry and keeps likedAt/followedAt", () => {
  const post = { key: "urn:li:activity:1", altKeys: ["c1:abc"], legacyKey: "old", href: "https://www.linkedin.com/in/jane/?x=1" };
  const track = { "c1:abc": { ts: ago(0.1), status: "liked", likedAt: ago(0.1), followedAt: ago(0.1) } };
  T.markPost(track, post, { status: "commented", ts: ago(0), commentedAt: ago(0) });
  const e = track["urn:li:activity:1"];
  assert.equal(e.status, "commented");
  assert.ok(e.likedAt && e.followedAt, "like/follow history kept");
  assert.equal(e.authorHref, "https://www.linkedin.com/in/jane");
  assert.equal(T.likedSince(track, DAY), 2, "both entries carry the like; caps over-count, never under-count");
  assert.equal(T.commentedSince(track, DAY), 1);
});

test("prune drops stale posts but keeps invite history and recently liked entries", () => {
  const track = {
    "conn:https://www.linkedin.com/in/x": { ts: ago(90), status: "invited" },
    stale: { ts: ago(40), status: "liked" },
    relike: { ts: ago(40), status: "skipped", likedAt: ago(0.5) },
    cooldowns: { all: ago(-1) },
  };
  T.pruneTrack(track);
  assert.deepEqual(Object.keys(track).sort(), ["conn:https://www.linkedin.com/in/x", "cooldowns", "relike"]);
});

test("LLM skips rest 30 days, gate rejections 3, and every key scheme is checked", () => {
  assert.equal(T.shouldSkipTracked({ k: { ts: ago(10), status: "skipped" } }, "k"), true);
  assert.equal(T.shouldSkipTracked({ k: { ts: ago(31), status: "skipped" } }, "k"), false);
  assert.equal(T.shouldSkipTracked({ k: { ts: ago(4), status: "rejected" } }, "k"), false);
  assert.equal(T.shouldSkipTracked({ old: { ts: ago(5), status: "commented" } }, "new", ["c1:x", "old"]), true);
});
