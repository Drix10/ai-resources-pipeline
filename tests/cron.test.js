const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// cron.js wires real services at require time: swap them for scripted fakes first.
const calls = [];
const state = { fetch: () => [], upload: (items) => items.map((it, i) => ({ ...it, url: `https://x/${it.queryName}/${i}`, content: "md" })), tweet: () => true, generate: (tweets) => ({ markdown: "# md", usedTweets: tweets.slice(0, 2) }) };
const stub = (rel, exports) => {
  const file = require.resolve(path.join(__dirname, "..", rel));
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
class FakeTwitter {
  beginRun() { calls.push("beginRun"); }
  async init() { calls.push("init"); if (state.initFails) throw new Error("no X"); }
  async fetchTweets({ folder }) { calls.push(`fetch:${folder.name}`); return state.fetch(folder); }
  markContentAsPublished(t) { calls.push(`mark:${t.length}`); }
  async postTweet() { calls.push("tweet"); return state.tweet(); }
  cleanupScreenshots() {}
  async cleanup() { calls.push("x-cleanup"); }
}
stub("src/services/twitter.js", FakeTwitter);
stub("src/services/feedEngage.js", { cleanup: async () => calls.push("li-cleanup"), runLikePass: async () => ({ liked: 0, target: 0 }), runFeedEngagement: async () => ({ commented: 0, skipped: 0 }), runConnectPass: async () => ({ sent: 0, target: 0 }) });
stub("src/services/github.js", { uploadMarkdownBatch: async (items) => { calls.push(`upload:${items.length}`); return state.upload(items); }, updateReadmeWithNewFile: async () => calls.push("readme") });
stub("src/services/llm.js", { beginRun: () => calls.push("llm-beginRun"), generateMarkdownBatched: async (tweets) => state.generate(tweets), cleanup: () => {} });
stub("src/services/syndication.js", { processQueue: async () => { calls.push("syndication"); return null; } });
const config = require("../config");
config.folders = [{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }];
config.social = { ...config.social, linkedinLike: false, linkedinFeedReply: false, linkedinConnect: false, twitterPost: true };
config.factory = { ...config.factory, enabled: false };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cron-"));
const prev = process.cwd();
process.chdir(dir); // lock and schedule files land here
const cron = require("../src/services/cron");
const helpers = require("../src/utils/helpers");
process.chdir(prev);
// The scripted failures log loudly; the assertions are what matter here.
for (const t of helpers.logger.transports) t.silent = true;

const tweets = (n) => Array.from({ length: n }, (_, i) => ({ id: String(i), tweetId: String(i) }));
const inDir = async (fn) => { process.chdir(dir); try { return await fn(); } finally { process.chdir(prev); } };

test("a run commits, marks only the sources used, caps tweets and cleans up", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => tweets(10);
  const r = await inDir(() => cron.processAllFolders());
  assert.equal(r.ran, true);
  assert.equal(r.articles, 4);
  assert.ok(calls.indexOf("beginRun") < calls.indexOf("init"), "the ID store is reloaded before X starts");
  assert.ok(calls.includes("llm-beginRun"));
  assert.ok(calls.filter((c) => c.startsWith("mark:")).every((c) => c === "mark:2"), "only usedTweets are marked");
  assert.equal(calls.filter((c) => c === "tweet").length, 1, "tweets are spaced 20 min apart: one per quick run");
  assert.ok(calls.includes("readme") && calls.includes("syndication"));
  assert.ok(calls.includes("x-cleanup") && calls.includes("li-cleanup"), "browsers released at the end of every run");
  assert.ok(!fs.existsSync(path.join(dir, ".pipeline.lock")), "lock released");
});

test("three folder failures in a row end the X phase, and the rest of the run still happens", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => { throw new Error("getaddrinfo ENOTFOUND x.com"); };
  const orig = helpers.sleep;
  const r = await inDir(() => cron.processAllFolders());
  assert.equal(r.ran, true);
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 9, "3 folders x 3 attempts, then the breaker");
  assert.ok(!calls.includes("fetch:D"));
  assert.ok(calls.includes("readme"), "README update still runs");
  helpers.sleep = orig;
});

test("X_UNAVAILABLE ends the X phase at once; an X init failure skips curation but not the run", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = () => { throw Object.assign(new Error("logged out"), { code: "X_UNAVAILABLE" }); };
  await inDir(() => cron.processAllFolders());
  assert.equal(calls.filter((c) => c.startsWith("fetch:")).length, 1);
  calls.length = 0;
  state.initFails = true;
  const r = await inDir(() => cron.processAllFolders());
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
    if (first) { first = false; throw new Error("GitHub 502"); }
    return items.map((it, i) => ({ ...it, url: `https://x/${i}`, content: "md" }));
  };
  const r = await inDir(() => cron.processAllFolders());
  assert.equal(r.articles, 4, "every article made it after the retry");
  assert.ok(calls.filter((c) => c.startsWith("upload:")).length >= 2);
});

test("a stop request ends the run at the next step and skips README, blog and factory", { timeout: 60000 }, async () => {
  calls.length = 0;
  state.fetch = (folder) => { if (folder.name === "B") cron.requestStop(); return tweets(10); };
  state.upload = (items) => items.map((it, i) => ({ ...it, url: `https://x/${i}`, content: "md" }));
  const r = await inDir(() => cron.processAllFolders());
  assert.equal(r.stopped, true);
  assert.ok(!calls.includes("fetch:C"), "no new folder after the stop");
  assert.ok(calls.some((c) => c.startsWith("upload:")), "articles already generated are still committed");
  assert.ok(!calls.includes("readme"));
});
