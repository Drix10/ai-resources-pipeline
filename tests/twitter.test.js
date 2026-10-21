require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const TwitterService = require("../src/services/twitter");
const claude = require("../src/services/claude");

const {
  classifyTweetText, isOfftopicTweet, snowflakeTime, isTooOld, pruneIds,
  loadIdStore, saveIdStore, classifyXUrl, PROCESSED_IDS_PATH,
} = TwitterService.__test;

const DAY = 24 * 60 * 60 * 1000;
// A snowflake ID for a given creation time (inverse of snowflakeTime).
const idAt = (ms) => ((BigInt(Math.round(ms)) - 1288834974657n) << 22n).toString();
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "x-ids-test-"));

// Every false positive and false negative the review found, plus the posts the filters exist for.
// [folder, text]
const SHOULD_KEEP = [
  ["AI Developer Tools", "Our new reranker reaches a 0.91 F1 score on BEIR while running 3x faster than the previous release on a single A100."],
  ["AI Companies and Ventures", "New Runway model Gen-5 generates 20-second clips at 1080p with consistent characters across shots."],
  ["AI Powered Film and Media", "Runway's AI Film Festival opens submissions today, with prizes for shorts made with generative video tools."],
  ["AI Powered Film and Media", "The first fully AI-assisted feature crossed $12M at the box office ahead of its wide theatrical release next month."],
  ["AI Developer Tools", "Every step of the agent was directed by the planner model, which hands subtasks to smaller executor models."],
  ["AI Developer Tools", "The new API tier gives developers 1M free tokens per day on the small model, with rate limits raised to 500 RPM."],
  ["Tech Infrastructure", "To reach the managed database from CI, add the runner's IP to the whitelist in the network settings first."],
  ["Tech Infrastructure", "Consul uses a gossip protocol (SWIM) to track membership, so failure detection scales to thousands of nodes."],
  ["Investors and Venture Capital", "Billionaire investor backs robotics startup Figure in a $500M round to scale humanoid production."],
  ["AI and Robotics Applications", "DeepMind's small humanoid robots learned to play soccer end to end with deep reinforcement learning."],
  ["AI in Healthcare and Science", "An AI skincare startup trained a model on 2M dermoscopy images that flags melanoma with 94% sensitivity."],
  ["Tech Companies and News", "AirDrop between iPhone and Android now works on Pixel 10 phones through Quick Share interoperability."],
  ["Computer Vision and AI Applications", "The Golden State Warriors use computer vision to track every player's movement and shot arc in practice."],
  ["AI Artists and Creators", "This paper adapts an LDM for video generation with temporal attention layers and releases the weights."],
  ["Devs, Designers, DevRel", "I open sourced the whole parser on GitHub. Feel free to use my code for your own projects, it is MIT licensed."],
  ["AI Leaders and Thinkers", "Speaking at a high level, transformers trade recurrence for attention, which is why they parallelise so well."],
  ["Decentralized AI", "Join us in building the open-source inference network: contributors can run nodes on consumer GPUs."],
];

const SHOULD_DROP = [
  ["AI Leaders and Thinkers", "I wrote a 40-page playbook on AI agents. Comment “guide” and I'll send it to you."],
  ["AI Leaders and Thinkers", "I built 50 prompts for founders. Reply \"AI\" and I'll DM you the whole pack for free."],
  ["Crypto and Web3", "$PEPEX is the next 100x memecoin. Presale is live, ape in before the CEX listing!"],
  ["Crypto and Web3", "Huge airdrop for early wallet holders, free tokens for everyone who joins the whitelist."],
  ["Tech VIPs", "Lakers beat the Celtics 112-108 in overtime, what a game last night."],
  ["Tech VIPs", "Verstappen wins the F1 race at Monza after a perfect pit stop."],
  ["Tech VIPs", "Paris Fashion Week was incredible, loved the new lipstick line and the shoes."],
  ["Tech VIPs", "Movie review: a standout performance in the film directed by Greta Gerwig."],
  ["Tech VIPs", "Huge box office weekend for the new superhero sequel."],
  ["Tech VIPs", "The latest celebrity gossip from the red carpet last night."],
  ["Founders and Entrepreneurs", "5 morning habits that changed my life and my business forever."],
  ["Founders and Entrepreneurs", "We're hiring senior backend engineers in Berlin, apply now."],
  ["Founders and Entrepreneurs", "Join us at our webinar next Tuesday on scaling teams."],
  ["Founders and Entrepreneurs", "DM for collabs and sponsorships."],
  ["Founders and Entrepreneurs", "Use my code SAVE20 for 20% off the course."],
  ["Founders and Entrepreneurs", "I'm speaking at Web Summit next week, come say hi."],
];

test("filter table: real tech posts are kept", () => {
  for (const [folder, text] of SHOULD_KEEP) {
    assert.equal(classifyTweetText(text, folder), null, `should keep [${folder}]: ${text}`);
  }
});

test("filter table: spam, bait, shilling and off-topic posts are dropped", () => {
  for (const [folder, text] of SHOULD_DROP) {
    assert.notEqual(classifyTweetText(text, folder), null, `should drop [${folder}]: ${text}`);
  }
});

test("off-topic blocks are folder-aware", () => {
  const film = "The documentary had a strong theatrical release and a solid box office run.";
  assert.equal(isOfftopicTweet(film, "AI Powered Film and Media"), false);
  assert.equal(isOfftopicTweet(film, "Tech VIPs"), true);
  const match = "Great soccer match tonight, the referee was terrible.";
  assert.equal(isOfftopicTweet(match, "AI and Robotics Applications"), false);
  assert.equal(isOfftopicTweet(match, "Tech VIPs"), true);
  // Without a folder, every block applies.
  assert.equal(TwitterService.isOfftopicTweet(match), true);
});

test("snowflake time round-trips and drives the age gate", () => {
  const now = Date.UTC(2026, 9, 10);
  assert.equal(snowflakeTime(idAt(now - 5 * DAY)), now - 5 * DAY);
  assert.ok(Number.isNaN(snowflakeTime("not-an-id")));
  assert.equal(isTooOld(idAt(now - 5 * DAY), "", 14, now), false);
  assert.equal(isTooOld(idAt(now - 20 * DAY), "", 14, now), true);
  // A scraped timestamp wins over the ID.
  assert.equal(isTooOld(idAt(now - 20 * DAY), new Date(now - DAY).toISOString(), 14, now), false);
});

test("eviction is by tweet age, never by insertion order", () => {
  const now = Date.now();
  const recentFirst = idAt(now - 2 * DAY);
  const oldLast = idAt(now - 400 * DAY);
  const kept = pruneIds(new Set([recentFirst, idAt(now - 10 * DAY), oldLast]), { now, retentionDays: 120 });
  assert.ok(kept.has(recentFirst));
  assert.ok(!kept.has(oldLast));
  // Over the hard cap, the newest tweets survive whatever order they were added in.
  const ids = [1, 2, 3, 4, 5].map((d) => idAt(now - d * DAY));
  const capped = pruneIds(new Set([...ids].reverse()), { now, max: 3 });
  assert.deepEqual([...capped].sort(), ids.slice(0, 3).sort());
});

test("the store path is anchored to the repo, not the working directory", () => {
  assert.equal(PROCESSED_IDS_PATH, path.resolve(__dirname, "..", ".processed-tweet-ids.json"));
});

test("store saves durably with a .bak and recovers from a corrupt main file", () => {
  const dir = tmpDir();
  const file = path.join(dir, "ids.json");
  try {
    assert.deepEqual(loadIdStore(file), { ids: new Set(), error: null }, "first run starts empty without error");
    saveIdStore(file, new Set(["111"]));
    saveIdStore(file, new Set(["111", "222"]));
    assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, "utf8")), ["111"], ".bak holds the last good file");
    assert.ok(!fs.existsSync(`${file}.tmp`));

    fs.writeFileSync(file, "{ not json");
    const recovered = loadIdStore(file);
    assert.equal(recovered.error, null);
    assert.deepEqual([...recovered.ids], ["111"], "falls back to the .bak");
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith("ids.json.corrupt-")), "bad file is set aside");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a leftover .tmp from a crash is merged in", () => {
  const dir = tmpDir();
  const file = path.join(dir, "ids.json");
  try {
    fs.writeFileSync(file, JSON.stringify(["1"]));
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(["1", "2"]));
    assert.deepEqual([...loadIdStore(file).ids].sort(), ["1", "2"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable store blocks curation instead of starting empty, and stays blocked", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "ids.json");
  try {
    fs.writeFileSync(file, "garbage");
    const service = new TwitterService({ storePath: file });
    assert.match(service.storeError, /processed-ID store unreadable/);
    await assert.rejects(service.fetchTweets({ folder: { name: "F", lists: ["1"] } }), (err) => err.code === "X_UNAVAILABLE" && /unreadable/.test(err.message));
    // The bad file was set aside; a reload must not mistake that for a first run.
    assert.ok(!fs.existsSync(file));
    service.beginRun();
    assert.match(service.storeError, /unreadable/);
    // Nothing is written over it either, and the caller is told the IDs are not saved.
    assert.equal(service.markContentAsPublished([{ tweets: [{ tweetId: "5" }] }]), false);
    assert.ok(!fs.existsSync(file));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("markContentAsPublished prefers tweetId and parses /status/ID/photo/1 URLs", () => {
  const dir = tmpDir();
  const file = path.join(dir, "ids.json");
  try {
    const service = new TwitterService({ storePath: file });
    const recent = idAt(Date.now() - DAY);
    const other = idAt(Date.now() - 2 * DAY);
    assert.equal(service.markContentAsPublished([
      { tweets: [{ tweetId: recent, url: "https://x.com/a/status/999/photo/1" }] },
      { tweets: [{ url: `https://x.com/b/status/${other}/photo/1` }] },
    ]), true);
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(saved.sort(), [recent, other].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed save is reported, and the next mark retries it even with nothing new", () => {
  const dir = tmpDir();
  const file = path.join(dir, "ids.json");
  try {
    const service = new TwitterService({ storePath: file });
    const id = idAt(Date.now() - DAY);
    fs.mkdirSync(`${file}.tmp`); // the write of the .tmp copy fails
    assert.equal(service.markContentAsPublished([{ tweets: [{ tweetId: id }] }]), false);
    assert.ok(!fs.existsSync(file));
    fs.rmSync(`${file}.tmp`, { recursive: true });
    assert.equal(service.markContentAsPublished([{ tweets: [{ tweetId: id }] }]), true, "same ID again: still written");
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), [id]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("beginRun rereads the store and resets reservations", () => {
  const dir = tmpDir();
  const file = path.join(dir, "ids.json");
  try {
    const service = new TwitterService({ storePath: file });
    service.reservedIds.add("123");
    const id = idAt(Date.now() - DAY);
    fs.writeFileSync(file, JSON.stringify([id]));
    service.beginRun();
    assert.equal(service.reservedIds.size, 0);
    assert.ok(service.isKnownId(id), "an ID written by another instance is respected");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const words = (n, seed) => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ") + " with benchmarks on GPUs";
const post = (id, over = {}) => ({
  tweetId: id, url: `https://x.com/u/status/${id}`, timestamp: "", text: words(35, `w${id}x`), mainText: "x",
  links: [], images: [], truncated: false, isAd: false, isReply: false, ...over,
});

test("findContent skips ads, replies, truncated, stale and already-reserved posts", () => {
  const dir = tmpDir();
  try {
    const service = new TwitterService({ storePath: path.join(dir, "ids.json") });
    const now = Date.now();
    const fresh = Array.from({ length: 20 }, (_, i) => idAt(now - DAY - i * 1000));
    const first = service.findContent("AI Developer Tools", [
      post(idAt(now - 100), { isAd: true }),
      post(idAt(now - 200), { isReply: true }),
      post(idAt(now - 300), { truncated: true }),
      post(idAt(now - 30 * DAY)),
      post(idAt(now - 400), { mainText: "" }),
      ...fresh.map((id) => post(id)),
    ]);
    const firstIds = first.map((c) => c.tweets[0].tweetId);
    assert.equal(firstIds.length, 16);
    assert.deepEqual(firstIds, fresh.slice(0, 16));
    assert.ok(first.every((c) => c.tweets[0].tweetId && c.tweets[0].url), "tweetId is stored on every collected post");

    // A second folder whose list overlaps never yields the same post in the same run.
    const more = Array.from({ length: 12 }, (_, i) => idAt(now - 2 * DAY - i * 1000));
    const second = service.findContent("AI Companies and Ventures", [...fresh, ...more].map((id) => post(id)));
    const secondIds = second.map((c) => c.tweets[0].tweetId);
    assert.equal(secondIds.filter((id) => firstIds.includes(id)).length, 0);
    assert.deepEqual(secondIds, [...fresh.slice(16), ...more]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a list is read by one read-only Claude in Chrome session; its posts are checked, and a wall or no browser is X_UNAVAILABLE", async () => {
  const dir = tmpDir();
  const saved = claude.ask;
  try {
    const service = new TwitterService({ storePath: path.join(dir, "ids.json") });
    service.RATE_LIMIT_DELAY = 0;
    const now = Date.now();
    const ids = Array.from({ length: 3 }, (_, i) => idAt(now - DAY - i * 1000));
    let reply = null;
    let reads = [];
    const seen = [];
    // A session as Claude in Chrome would run it: its tab's reads go to the gate by SEND, the reply carries none.
    claude.ask = async (opts) => {
      seen.push(opts);
      const send = /"(http:\/\/127\.0\.0\.1:\d+\/gate\/[0-9a-f]+\/in\?d=)"/.exec(opts.prompt)[1];
      const back = "&back=" + encodeURIComponent("https://x.com/i/lists/42");
      assert.equal((await fetch(send + encodeURIComponent(JSON.stringify(reads.map((v) => ({ at: "", url: v.url, v })))) + back, { redirect: "manual" })).headers.get("location"), "https://x.com/i/lists/42#gate=RECEIVED");
      return JSON.stringify(reply);
    };
    reply = { browser: "connected", sent: "RECEIVED" };
    const list = { url: "https://x.com/i/lists/42", problem: "", posts: [...ids.map((id) => post(id, { truncated: id === ids[0] })), { tweetId: "1", url: "https://evil.example/status/1", text: "x" }, post(idAt(now - 500), { url: "https://x.com/u/status/999" })] };
    // ids[0]'s own page: its full copy replaces the cut one, and a reply under it is not a list post.
    const own = { url: `https://x.com/u/status/${ids[0]}`, problem: "", posts: [post(ids[0]), post(idAt(now - 600))] };
    reads = [list, own];
    const found = await service.fetchTweets({ folder: { name: "AI Developer Tools", lists: ["42"] } });
    assert.deepEqual(found.map((c) => c.tweets[0].tweetId), ids, "a post whose id or address does not hold is dropped, a long post's page adds only it");
    assert.equal(seen[0].chrome, true);
    assert.match(seen[0].prompt, /https:\/\/x\.com\/i\/lists\/42/);
    assert.match(seen[0].prompt, /Read only/);
    assert.doesNotThrow(() => new Function(`return ${TwitterService.__test.READ_SCRIPT}`), "READ is one valid expression");

    reads = [];
    await assert.rejects(service.fetchTweets({ folder: { name: "A", lists: ["42"] } }), (e) => e.code === "X_UNAVAILABLE" && /sent no read back/.test(e.message));
    reads = [{ url: "https://x.com/i/flow/login", problem: "", posts: [] }];
    await assert.rejects(service.fetchTweets({ folder: { name: "A", lists: ["42"] } }), (e) => e.code === "X_UNAVAILABLE" && /logged out/.test(e.message));
    reply = { browser: "none" };
    await assert.rejects(service.fetchTweets({ folder: { name: "A", lists: ["42"] } }), (e) => e.code === "X_UNAVAILABLE" && /no browser/.test(e.message));
    claude.ask = async () => { throw Object.assign(new Error("usage limit reached"), { code: "CLAUDE_LIMIT" }); };
    await assert.rejects(service.fetchTweets({ folder: { name: "A", lists: ["42"] } }), (e) => e.code === "X_UNAVAILABLE");
  } finally {
    claude.ask = saved;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// A posting session as Claude in Chrome would run it: it types `typed`, runs CHECK (here: the hash of what it
// typed) and opens the gate; Post is "pressed" only at a GO.
const postingSession = (typed, result = {}) => async ({ prompt }) => {
  const gate = /"(http:\/\/127\.0\.0\.1:\d+\/gate\/[0-9a-f]+\/post\/)"/.exec(prompt)[1];
  const said = await (await fetch(gate + claude.textHash(claude.normText(typed)))).text();
  const go = said.startsWith("GO");
  return JSON.stringify({ browser: "connected", gate: said.split(":")[0], posted: go, error: "", detail: said, ...result });
};

test("a post is typed, read back at the gate and posted only at its GO; a dry run or another text never posts", async () => {
  const saved = claude.ask;
  const text = "New in AI Developer Tools: a faster reranker\n\nRead them here:\nhttps://example.com/x";
  try {
    const service = new TwitterService({ storePath: path.join(tmpDir(), "ids.json") });
    claude.ask = postingSession(text);
    assert.equal(await service.postTweet(text), true);
    claude.ask = postingSession(text);
    assert.equal(await service.postTweet(text, { dryRun: true }), true, "a dry run reaches the gate");
    let posted = null;
    claude.ask = async (opts) => { const r = JSON.parse(await postingSession("another text")(opts)); posted = r.posted; return JSON.stringify(r); };
    assert.equal(await service.postTweet(text), false, "the composer holding another text never posts");
    assert.equal(posted, false);
    claude.ask = async (opts) => { assert.match(opts.prompt, /Press Post ONLY after the gate/); return JSON.stringify({ browser: "connected", gate: "none", posted: true }); };
    assert.equal(await service.postTweet(text), false, "a post with no GO is not taken as posted");
  } finally {
    claude.ask = saved;
  }
});

test("X login and account-access pages are classified as unavailable", () => {
  assert.match(classifyXUrl("https://x.com/i/flow/login?redirect_after_login=%2Fhome"), /logged out/);
  assert.match(classifyXUrl("https://x.com/login"), /logged out/);
  assert.match(classifyXUrl("https://x.com/account/access"), /locked/);
  assert.equal(classifyXUrl("https://x.com/i/lists/123"), null);
  assert.equal(classifyXUrl("https://x.com/loginbot/status/1"), null);
});
