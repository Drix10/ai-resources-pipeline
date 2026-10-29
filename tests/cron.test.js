require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// cron.js wires real services at require time: swap them for scripted fakes first.
const calls = [];
const state = { fetch: () => [], upload: (items) => items.map((it, i) => ({ ...it, url: `https://x/${it.queryName}/${i}`, content: "md" })), generate: (tweets) => ({ markdown: "# md", usedTweets: tweets.slice(0, 2) }) };
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
  finishRunBranches: async () => calls.push("merge-run"),
});
stub("src/services/llm.js", { beginRun: () => calls.push("llm-beginRun"), generateMarkdownBatched: async (tweets) => state.generate(tweets) });
// The X reply passes: recorded with the instance they were handed (cron's own TwitterService).
const xPasses = [];
stub("src/services/xReplies.js", { runXReplyPass: async (opts) => { calls.push(`x-replies:${opts.viral ? "viral" : "regular"}`); xPasses.push(opts); return { replied: 0, skipped: 0, reason: "" }; } });
const redditPasses = [];
stub("src/services/redditComments.js", { runRedditPass: async (opts) => { calls.push("reddit"); redditPasses.push(opts); return { commented: 0, skipped: 0, pains: 0, reason: "" }; }, cleanup: async () => calls.push("reddit-cleanup") });
// The weekly Hugging Face upload: scripted, with the options cron handed it.
const hfRuns = [];
stub("src/services/hfDataset.js", { runHfDataset: async (opts) => { calls.push("hf-dataset"); hfRuns.push(opts); if (state.hfFails) throw new Error("HF down"); return { skipped: "not due" }; } });
stub("src/services/kbTopics.js", { runKbTopics: async () => { calls.push("kb-topics"); if (state.topicsFail) throw new Error("topics down"); return { skipped: "not due" }; } });
stub("src/services/syndication.js", { processQueue: async () => { calls.push("syndication"); return null; } });
const config = require("../config");
config.folders = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
config.social = { ...config.social, linkedinLike: false, linkedinFeedReply: false, linkedinConnect: false, xReplies: true, redditComments: true };
config.factory = { ...config.factory, enabled: false };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-"));
const LOCK = path.join(dir, ".pipeline.lock");
process.env.PIPELINE_LOCK_PATH = LOCK; // read when cron.js loads
const cron = require("../src/services/cron");
const helpers = require("../src/utils/helpers");
// The scripted failures log loudly; the assertions are what matter here.
for (const t of helpers.logger.transports) t.silent = true;

const tweets = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), tweetId: String(i) }));

test("a run commits, marks only the sources used, replies on X after each batch and cleans up", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  const r = await cron.processAllFolders();
  assert.equal(r.ran, true);
  assert.equal(r.articles, 4);
  assert.ok(calls.indexOf("beginRun") < calls.indexOf("init"), "the ID store is reloaded before X starts");
  assert.ok(calls.includes("llm-beginRun"));
  const marks = calls.filter((c) => c.startsWith("mark:"));
  assert.ok(marks.length === 4 && marks.every((c) => c === "mark:2"), "every committed item is marked, with only its usedTweets");
  const firstUpload = calls.findIndex((c) => c.startsWith("upload:"));
  assert.ok(firstUpload >= 0 && calls.indexOf("x-replies:regular") > firstUpload, "X replies come after a batch commit");
  assert.ok(calls.indexOf("x-replies:regular") < calls.indexOf("x-replies:viral"), "the regular pass, then the viral one");
  const batches = calls.filter((c) => c.startsWith("upload:")).length;
  assert.equal(calls.filter((c) => c === "x-replies:regular").length, batches, "one regular pass per batch");
  assert.ok(xPasses.every((o) => o.twitter instanceof FakeTwitter && typeof o.shouldStop === "function"));
  assert.ok(xPasses.every((o) => (o.viral ? o.max >= 1 && o.max <= 2 : o.max >= 2 && o.max <= 3)), "2-3 regular, 1-2 viral, like LinkedIn");
  assert.ok(calls.includes("readme") && calls.includes("syndication"));
  assert.ok(calls.indexOf("merge-run") < calls.indexOf("hf-dataset") && calls.indexOf("hf-dataset") < calls.indexOf("syndication"), "the weekly dataset step follows the run-branch merge");
  assert.equal(calls.filter((c) => c === "hf-dataset").length, 1, "once per run");
  assert.ok(calls.indexOf("readme") < calls.indexOf("kb-topics") && calls.indexOf("kb-topics") < calls.indexOf("merge-run"), "topic pages land on the run branch before its merge");
  assert.equal(typeof hfRuns[hfRuns.length - 1].shouldStop, "function", "it is handed the stop check");
  assert.equal(calls.filter((c) => c === "reddit").length, batches, "one Reddit pass per batch");
  assert.ok(calls.indexOf("reddit") > firstUpload && redditPasses.every((o) => o.max === 1 && typeof o.shouldStop === "function"), "one Reddit comment at most, after a commit");
  assert.ok(calls.includes("x-cleanup") && calls.includes("li-cleanup") && calls.includes("reddit-cleanup"), "browsers released at the end of every run");
  assert.ok(!fs.existsSync(LOCK), "lock released");
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
  state.fetch = () => tweets(10);
  state.initFails = true;
  const r = await cron.processAllFolders();
  state.initFails = false;
  assert.equal(r.xReady, false);
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 0);
  assert.ok(!calls.some((c) => c.startsWith("x-replies:")), "no X replies without an X session");
  assert.ok(calls.includes("readme"));
  config.social.xReplies = false;
  config.social.redditComments = false;
  calls.length = 0;
  await cron.processAllFolders();
  config.social.xReplies = true;
  config.social.redditComments = true;
  assert.ok(!calls.includes("reddit"), "REDDIT_COMMENTS=false turns them off");
  assert.ok(calls.some((c) => c.startsWith("upload:")) && !calls.some((c) => c.startsWith("x-replies:")), "X_REPLIES=false turns them off");
});

test("a failing Hugging Face upload or topic build never fails the run", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  state.hfFails = true;
  state.topicsFail = true;
  try {
    const r = await cron.processAllFolders();
    assert.equal(r.ran, true);
    assert.ok(calls.includes("kb-topics") && calls.includes("merge-run"), "the run branch is still merged");
    assert.ok(calls.includes("hf-dataset") && calls.includes("syndication"), "the rest of the run still happens");
  } finally {
    state.hfFails = false;
    state.topicsFail = false;
  }
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

test("an ID store that cannot be saved stops curation; the save is retried before the run ends", { timeout: 60000 }, async () => {
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
  assert.ok(!calls.includes("readme") && !calls.includes("hf-dataset") && !calls.includes("kb-topics"), "no dataset upload or topic build once a stop was asked for");

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
