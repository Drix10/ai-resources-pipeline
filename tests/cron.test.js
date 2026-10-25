require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// cron.js wires real services at require time: swap them for scripted fakes first.
const calls = [];
const tweetTexts = [];
const tweetReplies = [];
const state = { fetch: () => [], upload: (items) => items.map((it, i) => ({ ...it, url: `https://x/${it.queryName}/${i}`, content: "md" })), tweet: () => true, generate: (tweets) => ({ markdown: "# md", usedTweets: tweets.slice(0, 2) }) };
const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, "..", rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
class FakeTwitter {
  beginRun() { calls.push("beginRun"); }
  async init() { calls.push("init"); if (state.initFails) throw new Error("no X"); }
  async fetchTweets({ folder }) { calls.push(`fetch:${folder.name}`); return state.fetch(folder); }
  markContentAsPublished(t) { calls.push(`mark:${t.length}`); return state.markOk ?? true; }
  persistProcessedIds() { calls.push("persist"); return state.persistOk ?? true; }
  async postTweet(text, { reply = "" } = {}) { calls.push("tweet"); tweetTexts.push(text); tweetReplies.push(reply); return state.tweet(); }
  cleanupScreenshots() {}
  async cleanup() { calls.push("x-cleanup"); }
}
stub("src/services/twitter.js", FakeTwitter);
stub("src/services/feedEngage.js", { cleanup: async () => calls.push("li-cleanup"), runLikePass: async () => ({ liked: 0, target: 0 }), runFeedEngagement: async () => ({ commented: 0, skipped: 0 }), runConnectPass: async () => ({ sent: 0, target: 0 }), runWithdrawPass: async () => ({ withdrawn: 0, stale: 0 }), runOwnRepliesPass: async () => ({ replied: 0, owner: [], skipped: 0 }) });
// Like the real one, marks the batch through onCommitted the moment the commit lands.
const uploads = [];
stub("src/services/github.js", {
  uploadMarkdownBatch: async (items, repo, opts = {}) => {
    calls.push(`upload:${items.length}`);
    uploads.push(opts);
    const results = state.upload(items, opts);
    await opts.onCommitted?.(items);
    return results;
  },
  updateReadmeWithNewFile: async () => calls.push("readme"),
});
// The announcement writer fails by default: the plain line goes out.
state.announce = async () => { throw new Error("no model in tests"); };
stub("src/services/llm.js", { beginRun: () => calls.push("llm-beginRun"), generateMarkdownBatched: async (tweets) => state.generate(tweets), writeAnnouncement: (a) => state.announce(a) });
stub("src/services/syndication.js", { processQueue: async () => { calls.push("syndication"); return null; } });
const config = require("../config");
config.folders = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
config.social = { ...config.social, linkedinLike: false, linkedinFeedReply: false, linkedinConnect: false, twitterPost: true, tweetCredit: { madeBy: "", via: "" } };
config.factory = { ...config.factory, enabled: false };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-"));
const LOCK = path.join(dir, ".pipeline.lock");
process.env.PIPELINE_LOCK_PATH = LOCK; // read when cron.js loads
const cron = require("../src/services/cron");
const helpers = require("../src/utils/helpers");
// The scripted failures log loudly; the assertions are what matter here.
for (const t of helpers.logger.transports) t.silent = true;

const tweets = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), tweetId: String(i) }));

test("a run commits, marks only the sources used, caps tweets and cleans up", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  const r = await cron.processAllFolders();
  assert.equal(r.ran, true);
  assert.equal(r.articles, 4);
  assert.ok(calls.indexOf("beginRun") < calls.indexOf("init"), "the ID store is reloaded before X starts");
  assert.ok(calls.includes("llm-beginRun"));
  const marks = calls.filter((c) => c.startsWith("mark:"));
  assert.ok(marks.length === 4 && marks.every((c) => c === "mark:2"), "every committed item is marked, with only its usedTweets");
  assert.ok(calls.indexOf("mark:2") < calls.indexOf("tweet"), "sources are marked before any tweet");
  assert.equal(calls.filter((c) => c === "tweet").length, 1, "tweets are spaced 20 min apart: one per quick run");
  assert.ok(calls.includes("readme") && calls.includes("syndication"));
  assert.ok(calls.includes("x-cleanup") && calls.includes("li-cleanup"), "browsers released at the end of every run");
  assert.ok(!fs.existsSync(LOCK), "lock released");
});

test("the model writes the announcement; when it cannot, the plain line leads with the digest's top headline, or goes without one", { timeout: 60000 }, async () => {
  const saved = state.upload;
  const lead = "Acme Fooql 2.0 makes joins 3x faster";
  try {
    state.fetch = () => tweets(10);
    state.upload = (items) => items.map((it, i) => ({ ...it, url: `https://x/${it.queryName}/${i}`, content: `### 🚀 ${lead}\n\nAcme released Fooql 2.0, a query engine with joins that run three times faster.` }));
    tweetTexts.length = 0;
    tweetReplies.length = 0;
    await cron.processAllFolders();
    assert.equal(tweetTexts.length, 1);
    assert.ok(tweetTexts[0].includes(lead) && !tweetTexts[0].includes("🚀"), tweetTexts[0]);
    assert.ok(!tweetTexts[0].includes("https://"), "no link in the post itself");
    assert.equal(tweetReplies[0], "https://x/A/0", "the link goes in the reply under it");
    state.upload = saved;
    tweetTexts.length = 0;
    await cron.processAllFolders();
    assert.ok(tweetTexts[0] && !tweetTexts[0].includes(lead) && /roundup is out, link below/.test(tweetTexts[0]), tweetTexts[0]);
    const asked = [];
    state.announce = async (a) => { asked.push(a); return "Joins got 3x faster, details below."; };
    tweetTexts.length = 0;
    await cron.processAllFolders();
    assert.equal(tweetTexts[0], "Joins got 3x faster, details below.", "the model's post goes out as written");
    assert.deepEqual(asked[0], { topic: "A", content: "md" });
  } finally {
    state.upload = saved;
    state.announce = async () => { throw new Error("no model in tests"); };
  }
});

test("three folder failures in a row end the X phase, and the rest of the run still happens", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => { throw new Error("getaddrinfo ENOTFOUND x.com"); };
  const r = await cron.processAllFolders();
  assert.equal(r.ran, true);
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 9, "3 folders x 3 attempts, then the breaker");
  assert.ok(!calls.includes("fetch:D"));
  assert.ok(calls.includes("readme"), "README update still runs");
});

test("X_UNAVAILABLE ends the X phase at once; an X init failure skips curation but not the run", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => { throw Object.assign(new Error("logged out"), { code: "X_UNAVAILABLE" }); };
  await cron.processAllFolders();
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 1);
  calls.length = 0;
  state.initFails = true;
  const r = await cron.processAllFolders();
  state.initFails = false;
  assert.equal(r.xReady, false);
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 0);
  assert.ok(calls.includes("readme"));
});

test("a failed GitHub batch is retried once at the end of the run", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  let first = true;
  state.upload = (items) => {
    if (first) { first = false; throw Object.assign(new Error("GitHub 502"), { prepared: "paths-of-attempt-1" }); }
    return items.map((it, i) => ({ ...it, url: `https://x/${i}`, content: "md" }));
  };
  uploads.length = 0;
  const r = await cron.processAllFolders();
  assert.equal(r.articles, 4, "every article made it after the retry");
  assert.ok(calls.filter((c) => c.startsWith("upload:")).length >= 2);
  assert.equal(uploads[uploads.length - 1].prepared, "paths-of-attempt-1", "the retry reuses the failed attempt's paths");
});

test("an ID store that cannot be saved stops curation and tweets; the save is retried before the run ends", { timeout: 60000 }, async () => {
  const random = Math.random;
  Math.random = () => 0; // one article per commit batch
  try {
    calls.length = 0;
    state.fetch = () => tweets(10);
    state.upload = (items) => items.map((it, i) => ({ ...it, url: `https://x/${i}`, content: "md" }));
    state.markOk = false;
    state.persistOk = true;
    await cron.processAllFolders();
    assert.deepEqual(calls.filter((c) => c.startsWith("fetch:")), ["fetch:A"], "no folder after the failed save");
    assert.ok(!calls.includes("tweet"), "no tweet for an article whose sources are not saved");
    assert.equal(calls.filter((c) => c === "persist").length, 1, "saved on the first retry");
    assert.ok(calls.indexOf("persist") < calls.indexOf("x-cleanup"));
  } finally {
    Math.random = random;
    state.markOk = undefined;
    state.persistOk = undefined;
  }
});

test("a writer outage marks the sources it already judged (only those) and ends the X phase", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  const generate = state.generate;
  state.generate = (t) => { throw Object.assign(new Error("writer down"), { code: "LLM_UNAVAILABLE", usedTweets: t.slice(0, 3) }); };
  try {
    await cron.processAllFolders();
  } finally {
    state.generate = generate;
  }
  assert.deepEqual(calls.filter((c) => c.startsWith("mark:")), ["mark:3"]);
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 1);
});

test("a stale lock is taken over; a fresh one held by a live process is not", { timeout: 60000 }, async () => {
  const old = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  // A leftover with this process's own pid (Windows reuses pids): taken over.
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.pid, startedAt: old, heartbeatAt: old }));
  calls.length = 0;
  state.fetch = () => [];
  assert.equal((await cron.processAllFolders()).ran, true);
  assert.ok(!fs.existsSync(LOCK));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".stale")), [], "nothing left aside");
  // A live holder (the test runner) with a fresh heartbeat: this run is skipped.
  const now = new Date().toISOString();
  fs.writeFileSync(LOCK, JSON.stringify({ pid: process.ppid, startedAt: now, heartbeatAt: now }));
  try {
    assert.equal((await cron.processAllFolders()).ran, false);
    assert.equal(JSON.parse(fs.readFileSync(LOCK, "utf8")).pid, process.ppid, "the live lock is untouched");
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
});

test("runPipeline does one run and reports it; a second call during it is refused", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  const [first, second] = await Promise.all([cron.runPipeline(), cron.runPipeline()]);
  assert.equal(first, "ok");
  assert.equal(second, "busy");
  assert.equal(calls.filter((c) => c === "init").length, 1, "one run, not two");
  assert.ok(!fs.existsSync(LOCK), "lock released");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith(".pipeline-schedule")), [], "no schedule is kept");
});

test("a stop request ends the run at the next step and skips README, blog and factory", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = (folder) => { if (folder.name === "B") cron.requestStop(); return tweets(10); };
  state.upload = (items) => items.map((it, i) => ({ ...it, url: `https://x/${i}`, content: "md" }));
  const r = await cron.processAllFolders();
  assert.equal(r.stopped, true);
  assert.ok(!calls.includes("fetch:C"), "no new folder after the stop");
  assert.ok(calls.some((c) => c.startsWith("upload:")), "articles already generated are still committed");
  assert.ok(!calls.includes("readme"));

  // A stop that reaches the writer (CLAUDE_STOPPED) is no failure: not retried, and the sources it judged are kept.
  calls.length = 0;
  state.fetch = () => tweets(10);
  let generated = 0;
  const generate = state.generate;
  state.generate = (t) => { generated++; throw Object.assign(new Error("the pipeline is stopping"), { code: "CLAUDE_STOPPED", usedTweets: t.slice(0, 2) }); };
  try {
    const started = Date.now();
    await cron.runDataPipeline({ name: "E" }).catch((e) => assert.equal(e.code, "CLAUDE_STOPPED"));
    assert.equal(generated, 1, "never retried");
    assert.ok(Date.now() - started < 3000, "no retry sleep");
    assert.deepEqual(calls.filter((c) => c.startsWith("mark:")), ["mark:2"]);
  } finally {
    state.generate = generate;
  }
});

test("a killed Claude ends the run before the stop flag is seen; a real failure that lands with a stop keeps its line", { timeout: 60000 }, async () => {
  const generate = state.generate;
  const info = helpers.logger.info;
  const lines = [];
  try {
    cron._resetStop();
    calls.length = 0;
    state.fetch = () => tweets(10);
    let n = 0;
    state.generate = (t) => { if (++n === 2) throw Object.assign(new Error("the pipeline is stopping"), { code: "CLAUDE_STOPPED", usedTweets: [] }); return generate(t); };
    const r = await cron.processAllFolders();
    assert.equal(r.stopped, true, "the kill is a stop");
    assert.ok(calls.includes("fetch:B") && !calls.includes("fetch:C"), "no folder after the kill");
    assert.ok(!calls.includes("readme"));

    cron._resetStop();
    helpers.logger.info = (m, ...rest) => { lines.push(String(m)); return info.call(helpers.logger, m, ...rest); };
    state.generate = () => { cron.requestStop(); throw Object.assign(new Error("402: insufficient credits"), { code: "LLM_UNAVAILABLE" }); };
    await cron.processAllFolders();
    assert.ok(lines.some((l) => /^Stopping: A ends here \(it failed as the stop came: LLM_UNAVAILABLE: 402: insufficient credits\)\.$/.test(l)), lines.join("\n"));
  } finally {
    state.generate = generate;
    helpers.logger.info = info;
    cron.requestStop();
  }
});
