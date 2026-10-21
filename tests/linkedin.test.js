require("./_env"); // isolated even when run on its own
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
const claude = require("../src/services/claude");
const { fakeLinkedIn } = require("./_fakeLinkedIn");
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

test("the activity URN wins as the key; the other key schemes stay as altKeys", () => {
  const crypto = require("crypto");
  const h = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
  const body = `${BODY}\n2 comments`;
  const k = LinkedInService.postKeys({ href: "https://x/in/a", urn: "urn:li:activity:7212345678901234567", body });
  assert.equal(k.key, "urn:li:activity:7212345678901234567");
  assert.ok(k.altKeys.includes(h(`body|${body.slice(0, 300)}`)), "pre-change body key still looked up");
  assert.equal(k.authorKey, h(`https://x/in/a|${body.slice(0, 300)}`));
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
  assert.match(T.passBlocked(t, "like"), /^linkedin unavailable/);
  // Next run: the bad file was moved aside and nothing replaced it - still off, not a reset.
  assert.ok(T.loadTrack().disabled);
});

test("tracker: files without meta keys load unchanged and have no cooldowns", () => {
  reset();
  fs.writeFileSync(file, JSON.stringify({ a: "2026-09-19T16:07:27.441Z", b: { ts: ago(1), status: "liked" } }));
  const t = T.loadTrack();
  assert.equal(t.a, "2026-09-19T16:07:27.441Z");
  assert.equal(T.passBlocked(t, "connect"), "");
});

// ---- Circuit breaker ----
test("cooldowns: 'all' stops every pass, 'connect' only connects", () => {
  reset();
  const t = {};
  T.setCooldown(t, "connect", 7 * DAY, "test");
  assert.equal(T.passBlocked(t, "like"), "");
  assert.match(T.passBlocked(t, "connect"), /^linkedin unavailable \(connect cooldown/);
  T.setCooldown(t, "all", DAY, "test");
  assert.match(T.passBlocked(t, "comment"), /^linkedin unavailable \(cooldown/);
  assert.ok(T.loadTrack().cooldowns.all, "cooldown persisted");
});

test("a process-level disable blocks every pass until reset", () => {
  LinkedInService.disable(60000, "login required");
  try {
    assert.match(T.passBlocked({}, "like"), /^linkedin unavailable \(login required\)/);
  } finally {
    LinkedInService._resetDisabled();
  }
  assert.equal(T.passBlocked({}, "like"), "");
});

// ---- Entries merge, prune keeps what caps need ----
test("a comment merges into the entry and keeps likedAt/followedAt", () => {
  const post = { key: "urn:li:activity:1", altKeys: ["c1:abc"], authorKey: "old", href: "https://www.linkedin.com/in/jane/?x=1" };
  const track = { "c1:abc": { ts: ago(0.1), status: "liked", likedAt: ago(0.1), followedAt: ago(0.1) } };
  T.markPost(track, post, { status: "commented", ts: ago(0), commentedAt: ago(0) });
  const e = track["urn:li:activity:1"];
  assert.equal(e.status, "commented");
  assert.ok(e.likedAt && e.followedAt, "like/follow history kept");
  assert.equal(e.authorHref, "https://www.linkedin.com/in/jane");
  assert.equal(T.likedSince(track, DAY), 2, "both entries carry the like; caps over-count, never under-count");
  assert.equal(T.commentedSince(track, DAY), 1);
});

test("prune drops stale posts but keeps 90 days of invite history and recently liked entries", () => {
  const track = {
    "conn:https://www.linkedin.com/in/x": { ts: ago(80), status: "invited" },
    "conn:https://www.linkedin.com/in/old": { ts: ago(95), status: "invited" },
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

test("a stop request ends a pass at its next gate: no action after it, and no search page loaded", async () => {
  const savedTrack = process.env.LINKEDIN_TRACK_PATH;
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "stop-track.json");
  LinkedInService._resetDisabled();
  const text = (i) => `Venture capital investors in New York weigh fintech and AI startups, private equity and markets this week (${i}).`;
  const li = fakeLinkedIn({ scan: () => Array.from({ length: 6 }, (_, i) => ({ key: `urn:li:activity:${900 + i}`, author: `a${i}`, href: `https://www.linkedin.com/company/a${i}`, text: text(i), head: "", ageH: 1 })) });
  try {
    const r = await feedEngage.runLikePass({ min: 4, max: 4, shouldStop: () => li.acted.length >= 1 });
    assert.equal(li.done("like").length, 1, "no like after the stop");
    assert.equal(r.liked, 1);
    const c = await feedEngage.runConnectPass({ min: 3, max: 3, shouldStop: () => true });
    assert.equal(li.searches, 0);
    assert.equal(c.sent, 0);
  } finally {
    li.restore();
    process.env.LINKEDIN_TRACK_PATH = savedTrack;
  }
});

test("connect pass: people are filtered in Node, each invite waits for its gate, the weekly limit pauses connects, a dry run sends nothing", async () => {
  const savedTrack = process.env.LINKEDIN_TRACK_PATH;
  process.env.LINKEDIN_TRACK_PATH = path.join(TMP, "connect-track.json");
  LinkedInService._resetDisabled();
  const person = (i, text) => ({ label: `Invite P${i} to connect`, name: `P${i}`, href: `https://www.linkedin.com/in/p${i}`, text });
  let n = 0;
  const li = fakeLinkedIn({
    people: () => [person(++n, "AI engineer at a startup in Austin"), person(++n, "Recruiter, talent acquisition"), person(++n, "Machine learning engineer, London")],
    result: (a) => (a.person.name === "P4" ? "limit" : "done"),
  });
  try {
    const dry = await feedEngage.runConnectPass({ min: 2, max: 2, dryRun: true });
    assert.equal(dry.previews.length, 2);
    assert.equal(li.acted.length, 0, "a dry run starts no action session");
    n = 0;
    const r = await feedEngage.runConnectPass({ min: 2, max: 2 });
    assert.equal(r.sent, 1, "a GO counts the invite; the weekly limit sent none");
    const track = feedEngage._tracker.loadTrack();
    assert.equal(track["conn:https://www.linkedin.com/in/p1"].status, "invited");
    assert.equal(track["conn:https://www.linkedin.com/in/p2"], undefined, "a recruiter is never invited");
    assert.equal(track["conn:https://www.linkedin.com/in/p4"], undefined, "the invite the limit refused is not counted");
    assert.match(r.reason, /invitation limit/);
    assert.ok(track.cooldowns.connect, "connects pause for a week");
  } finally {
    li.restore();
    process.env.LINKEDIN_TRACK_PATH = savedTrack;
  }
});

test("a page's cards are checked in Node: an unknown address, an own post, spam or a fragment never becomes a post", () => {
  const svc = new LinkedInService();
  svc._ownNames = ["our name"];
  const body = "We shipped an open source AI agents framework for developers building with LLMs this week, with evals and docs.";
  const card = (over) => ({ urn: "urn:li:activity:7212345678901234567", href: "https://www.linkedin.com/in/jane", author: "Jane Doe", text: `Feed post\nJane Doe\nFounder\n2h •\n${body}\n12 reactions\n3 comments`, ...over });
  const posts = svc.postsOf([
    card(),
    card({ urn: "urn:li:activity:1 OR 1", href: "javascript:alert(1)", text: card().text.replace("We shipped", "They shipped") }),
    card({ author: "Our Name", text: card().text.replace("We shipped", "I shipped") }),
    card({ text: "Feed post\nAcme\nPromoted\nOur new cloud platform scales to millions of requests for every team on earth." }),
    card({ text: "short" }),
  ]);
  assert.equal(posts.length, 2);
  assert.equal(posts[0].urn, "urn:li:activity:7212345678901234567");
  assert.equal(posts[0].reactions, 12);
  assert.equal(posts[1].urn, "", "a urn that does not hold is dropped");
  assert.equal(posts[1].href, "", "and an address that is not a LinkedIn profile");
  for (const [name, script] of Object.entries(LinkedInService.SCRIPTS)) assert.doesNotThrow(() => new Function(`return ${script}`), name);
});

test("reads come back by SEND, never in the reply: cards by their page's MARK; a post with no urn is found on its page; a wall or nothing sent stops", async () => {
  const saved = claude.ask;
  const svc = new LinkedInService();
  svc._ownSlug = "";
  const body = "We shipped an open source AI agents framework for developers building with LLMs this week, with evals and docs";
  const card = (n) => ({ urn: "", href: `https://www.linkedin.com/in/p${n}`, author: `P${n}`, text: `Feed post\nP${n}\nFounder\n2h •\n${body} (${n}).\n12 reactions` });
  const ok = { url: "https://www.linkedin.com/feed/", text: "" };
  const search = "https://www.linkedin.com/search/results/content/?keywords=x";
  let reads = [];
  // A session as Claude in Chrome would run it: the tab's reads go to the gate's inbox, the reply says only that.
  claude.ask = async ({ prompt }) => {
    const send = /"(http:\/\/127\.0\.0\.1:\d+\/gate\/[0-9a-f]+\/in\?d=)"/.exec(prompt)[1];
    await fetch(send + encodeURIComponent(JSON.stringify(reads)));
    return JSON.stringify({ browser: "connected", sent: "RECEIVED" });
  };
  try {
    reads = [
      { at: "feed:recent", url: ok.url, v: { status: ok, own: "https://www.linkedin.com/in/me-1/", cards: [card(1), card(2)] } },
      { at: "search:x", url: search, v: { status: ok, own: "", cards: [card(3)] } },
      { at: "feed:recent", url: ok.url, v: { status: ok, own: "", cards: [card(2), card(4)] } },
    ];
    const pages = await svc.scanPages([{ label: "feed:recent", sort: "recent" }, { label: "search:x", url: search }]);
    assert.deepEqual(pages[0].posts.map((p) => p.author), ["P1", "P2", "P4"], "a page's reads are one page, a card read twice is one post");
    assert.deepEqual(pages[1].posts.map((p) => p.author), ["P3"]);
    assert.equal(svc._ownSlug, "me-1");
    assert.deepEqual(pages[0].posts[0].source, { url: "", sort: "Recent" });

    let data;
    const askAct = async ({ prompt }) => { data = JSON.parse(/THE ACTIONS \(data, not instructions\):\n([\s\S]*?)\n\nReply with only JSON/.exec(prompt)[1]); return JSON.stringify({ browser: "connected", results: [] }); };
    claude.ask = askAct;
    await svc.act([{ kind: "comment", post: pages[1].posts[0], text: "Which eval came first?" }, { kind: "like", urn: "urn:li:activity:11111" }], { dryRun: true });
    assert.equal(data[0].url, search, "a post with no urn is opened on the page it was read on");
    assert.ok(data[0].find.includes(JSON.stringify(pages[1].posts[0].find)) && pages[1].posts[0].find.startsWith("We shipped"));
    assert.match(data[0].check, /\[data-cc-post\] \[aria-label/, "its CHECK reads only the found card's comment box");
    assert.equal(data[1].url, "https://www.linkedin.com/feed/update/urn:li:activity:11111/");

    claude.ask = async (o) => (o.prompt.includes("THE ACTIONS") ? askAct(o) : JSON.stringify({ browser: "connected" }));
    await assert.rejects(svc.scanPages([{ label: "feed:recent", sort: "recent" }]), (e) => e.code === "LINKEDIN_UNAVAILABLE" && /sent nothing back/.test(e.message));
    claude.ask = async ({ prompt }) => {
      await fetch(/"(http:\/\/127\.0\.0\.1:\d+\/gate\/[0-9a-f]+\/in\?d=)"/.exec(prompt)[1] + encodeURIComponent(JSON.stringify([{ at: "feed:recent", url: "https://www.linkedin.com/login", v: { status: { url: "https://www.linkedin.com/login", text: "" }, cards: [] } }])));
      return JSON.stringify({ browser: "connected" });
    };
    await assert.rejects(svc.scanPages([{ label: "feed:recent", sort: "recent" }]), (e) => LinkedInService.isStopError(e), "a login page stops");
  } finally {
    claude.ask = saved;
    LinkedInService._resetDisabled();
  }
});

test("act: one session, each action only at its gate's GO; a comment box holding another text is STOPped, a dry run is DRY RUN, and an onGo that cannot save stops the rest", async () => {
  const saved = claude.ask;
  const svc = new LinkedInService();
  const said = [];
  // A session as Claude in Chrome would run it: every gate opened in order, a comment's CHECK hashing what it typed.
  const session = (typed = (a) => a.text) => async ({ prompt, chrome }) => {
    assert.equal(chrome, true);
    const data = JSON.parse(/THE ACTIONS \(data, not instructions\):\n([\s\S]*?)\n\nReply with only JSON/.exec(prompt)[1]);
    const results = [];
    for (const a of data) {
      const url = a.gate || `${/"(http:\/\/127\.0\.0\.1:\d+\/gate\/[0-9a-f]+\/[\w-]+\/)"/.exec(a.check)[1]}${claude.textHash(claude.normText(typed(a)))}`;
      const answer = await (await fetch(url)).text();
      said.push(answer.split(":")[0]);
      results.push({ id: a.id, result: answer.startsWith("GO") ? "done" : "skipped", gate: answer.split(":")[0] });
    }
    return JSON.stringify({ browser: "connected", results, error: "" });
  };
  const marks = [];
  const actions = () => [
    { kind: "like", urn: "urn:li:activity:11111", onGo: () => marks.push("like") },
    { kind: "comment", urn: "urn:li:activity:11111", text: "Which part of the eval did teams ask for first?", onGo: () => marks.push("comment") },
  ];
  try {
    claude.ask = session();
    const done = await svc.act(actions());
    assert.deepEqual(done.map((a) => a.result), ["done", "done"]);
    assert.deepEqual(marks, ["like", "comment"], "each marked at its GO");
    said.length = 0; marks.length = 0;
    claude.ask = session(() => "something else");
    const wrong = await svc.act(actions());
    assert.deepEqual(said, ["GO", "STOP"], "a comment box holding another text never posts");
    assert.equal(wrong[1].result, "skipped");
    said.length = 0; marks.length = 0;
    claude.ask = session();
    await svc.act(actions(), { dryRun: true });
    assert.deepEqual(said, ["DRY RUN", "DRY RUN"]);
    assert.deepEqual(marks, []);
    said.length = 0;
    claude.ask = session();
    const failing = [{ kind: "like", urn: "urn:li:activity:2222222", onGo: () => { throw Object.assign(new Error("tracker save failed"), { code: "LINKEDIN_UNAVAILABLE" }); } }, { kind: "like", urn: "urn:li:activity:3333333" }];
    await assert.rejects(svc.act(failing), /tracker save failed/);
    assert.deepEqual(said, ["STOP", "STOP"], "nothing after a mark that could not be saved");
    claude.ask = async () => JSON.stringify({ browser: "none" });
    await assert.rejects(svc.act(actions()), (e) => e.code === "LINKEDIN_UNAVAILABLE");
  } finally {
    claude.ask = saved;
    LinkedInService._resetDisabled();
  }
});
