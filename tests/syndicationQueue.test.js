const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const config = require("../config");
const syndication = require("../src/services/syndication");

// Every test gets its own queue file and a fake fetch: nothing here reaches DEV.to or the blog.
const BLOG = config.syndication.canonicalBaseUrl;
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function withQueue({ live = () => true, devto }, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "synd-queue-"));
  const saved = { fetch: global.fetch, key: config.syndication.devto.apiKey, delay: syndication.RATE_LIMIT_DELAY_MS, env: process.env.SYNDICATION_QUEUE_PATH };
  const posts = [];
  process.env.SYNDICATION_QUEUE_PATH = path.join(dir, "data", "syndication-queue.json");
  config.syndication.devto.apiKey = "test-key";
  syndication.RATE_LIMIT_DELAY_MS = 0;
  syndication._blockedUntil = 0;
  global.fetch = async (url, opts = {}) => {
    if (String(url).startsWith(BLOG)) return new Response(null, { status: live(String(url), opts.method) ? 200 : 404 });
    if (String(url) === "https://dev.to/api/articles") {
      const body = JSON.parse(opts.body);
      posts.push(body.article);
      return devto(body.article, posts.length);
    }
    throw new Error(`unexpected network call to ${url}`);
  };
  try {
    return await fn({ posts, file: process.env.SYNDICATION_QUEUE_PATH });
  } finally {
    global.fetch = saved.fetch;
    config.syndication.devto.apiKey = saved.key;
    syndication.RATE_LIMIT_DELAY_MS = saved.delay;
    syndication._blockedUntil = 0;
    if (saved.env === undefined) delete process.env.SYNDICATION_QUEUE_PATH; else process.env.SYNDICATION_QUEUE_PATH = saved.env;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const queueOne = (n, folder = "AI Agents") => syndication.queueMarkdownArticle({
  title: `${folder} #${n}`,
  markdown: `### 🚀 Article number ${n}\n\nBody text for article ${n}.`,
  tags: ["aiagents"],
  category: folder,
  relativePath: `${folder}/resources-${String(n).padStart(3, "0")}.md`,
  seoSlug: `article-${n}`,
});
const items = (file) => JSON.parse(fs.readFileSync(file, "utf8")).items;

test("queueing records the article on disk and never posts", async () => {
  await withQueue({ devto: () => assert.fail("must not post while queueing") }, async ({ posts, file }) => {
    const item = await queueOne(1);
    assert.equal(item.status, "pending");
    assert.equal(item.canonicalUrl, `${BLOG}/articles/ai-agents/article-1`);
    await queueOne(1); // same canonical: one record
    assert.equal(Object.keys(items(file)).length, 1);
    assert.equal(posts.length, 0);
    assert.match(items(file)[item.canonicalUrl].markdown, /Read More & Connect/);
  });
});

test("an item whose canonical page is not live stays pending, then posts once it is", async () => {
  let deployed = false;
  await withQueue({ live: () => deployed, devto: () => json(201, { url: "https://dev.to/x/1", id: 1 }) }, async ({ posts, file }) => {
    const { canonicalUrl } = await queueOne(1);
    const first = await syndication.processQueue();
    assert.equal(first.notLive, 1);
    assert.equal(posts.length, 0, "nothing posted before the blog page exists");
    assert.equal(items(file)[canonicalUrl].status, "pending");
    deployed = true;
    const second = await syndication.processQueue();
    assert.equal(second.posted, 1);
    assert.equal(posts[0].canonical_url, canonicalUrl);
    const done = items(file)[canonicalUrl];
    assert.equal(done.status, "done");
    assert.equal(done.markdown, undefined, "body dropped once posted");
    assert.equal((await syndication.processQueue()).posted, 0, "never posted twice");
  });
});

test("a 429 pauses the queue and keeps every remaining item pending", async () => {
  await withQueue({ devto: () => json(429, { error: "Rate limit reached" }) }, async ({ posts, file }) => {
    for (const n of [1, 2, 3]) await queueOne(n);
    // The in-request backoff waits are real seconds; answer 429 only once per request here.
    const orig = syndication.publishToDevTo;
    syndication.publishToDevTo = async () => ({ success: false, platform: "devto", status: 429, error: "DEV.to returned HTTP 429" });
    try {
      const summary = await syndication.processQueue();
      assert.equal(summary.paused, true);
    } finally { syndication.publishToDevTo = orig; }
    const all = Object.values(items(file));
    assert.equal(all.length, 3);
    assert.ok(all.every((it) => it.status === "pending" && !it.attempts), "nothing dropped or charged an attempt");
    assert.equal(posts.length, 0);
  });
});

test("a tripped breaker stops the pass without touching the rest", async () => {
  await withQueue({ devto: () => json(401, { error: "unauthorized" }) }, async ({ posts, file }) => {
    for (const n of [1, 2]) await queueOne(n);
    const summary = await syndication.processQueue();
    assert.equal(summary.paused, true);
    assert.equal(posts.length, 1, "one request, then the breaker holds the rest");
    assert.ok(Object.values(items(file)).every((it) => it.status === "pending"));
  });
});

test("only 'has already been taken' counts as a duplicate; any other 422 is a failure, retried up to 3 times", async () => {
  await withQueue({ devto: (a) => (a.canonical_url.endsWith("article-1") ? json(422, { error: "Canonical url has already been taken", status: 422 }) : json(422, { error: "Canonical url is invalid", status: 422 })) }, async ({ file }) => {
    const dup = await queueOne(1);
    const bad = await queueOne(2);
    const s1 = await syndication.processQueue();
    assert.equal(s1.duplicates, 1);
    assert.equal(s1.retrying, 1);
    assert.equal(items(file)[dup.canonicalUrl].status, "done");
    assert.equal(items(file)[bad.canonicalUrl].status, "pending");
    assert.equal(items(file)[bad.canonicalUrl].attempts, 1);
    await syndication.processQueue();
    const s3 = await syndication.processQueue();
    assert.equal(s3.failed, 1);
    assert.equal(items(file)[bad.canonicalUrl].status, "failed");
    assert.equal(items(file)[bad.canonicalUrl].attempts, 3);
    assert.match(items(file)[bad.canonicalUrl].lastError, /invalid/);
  });
});

test("maxItems bounds the posts per pass; the queue survives a restart (fresh read from disk)", async () => {
  await withQueue({ devto: (a, n) => json(201, { url: `https://dev.to/x/${n}`, id: n }) }, async ({ posts, file }) => {
    for (const n of [1, 2, 3]) await queueOne(n);
    assert.equal((await syndication.processQueue({ maxItems: 2 })).posted, 2);
    const raw = items(file);
    assert.deepEqual(Object.values(raw).map((it) => it.status), ["done", "done", "pending"], "oldest first");
    assert.equal((await syndication.processQueue()).posted, 1);
    assert.equal(posts.length, 3);
  });
});

test("DEVTO_AUTO_PUBLISH still decides draft vs published", async () => {
  const saved = config.syndication.devto.enabled;
  try {
    for (const enabled of [false, true]) {
      config.syndication.devto.enabled = enabled;
      await withQueue({ devto: (a, n) => json(201, { url: `https://dev.to/x/${n}`, id: n }) }, async ({ posts }) => {
        await queueOne(1);
        await syndication.processQueue();
        assert.equal(posts[0].published, enabled);
      });
    }
  } finally { config.syndication.devto.enabled = saved; }
});

test("a corrupt queue file is set aside, not silently overwritten", async () => {
  await withQueue({ devto: () => json(201, { url: "https://dev.to/x/1", id: 1 }) }, async ({ file }) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ not json");
    await queueOne(1);
    assert.equal(Object.keys(items(file)).length, 1);
    assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes(".corrupt-")), "damaged file kept beside the new queue");
  });
});

test("without a DEV.to key nothing is queued and processQueue is a no-op", async () => {
  await withQueue({ devto: () => assert.fail("no key, no post") }, async ({ file }) => {
    config.syndication.devto.apiKey = "";
    assert.equal(await queueOne(1), null);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual(await syndication.processQueue(), { posted: 0, duplicates: 0, notLive: 0, failed: 0, retrying: 0, paused: false });
  });
});
