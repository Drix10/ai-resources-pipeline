require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const github = require("../src/services/github");
const helpers = require("../src/utils/helpers");
for (const t of helpers.logger.transports) t.silent = true;
github.RETRY_DELAY_MS = 0;

const blobSha = (text) => {
  const body = Buffer.from(text, "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};

// A one-branch GitHub. updateRefFails: how many ref updates apply and then report an error (a
// timeout after GitHub did the work); getRefFails: how many branch reads fail after that.
function fakeGitHub({ updateRefFails = 0, getRefFails = 0, files = {} } = {}) {
  const state = { files: new Map(Object.entries(files)), commits: 0, head: "c0", trees: new Map(), pendingGetRefFails: 0 };
  const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });
  github.octokit = {
    rateLimit: { get: async () => ({ data: { rate: { remaining: 5000, reset: 0, used: 0, limit: 5000 } } }) },
    repos: {
      get: async () => ({ data: { permissions: { push: true } } }),
      getContent: async ({ path }) => {
        if (state.files.has(path)) return { data: { name: path.split("/").pop(), sha: blobSha(state.files.get(path)) } };
        const inFolder = [...state.files.keys()].filter((k) => k.startsWith(`${path}/`)).map((k) => ({ name: k.slice(path.length + 1) }));
        if (inFolder.length) return { data: inFolder };
        throw notFound();
      },
    },
    git: {
      getRef: async () => {
        if (state.pendingGetRefFails > 0) { state.pendingGetRefFails--; throw new Error("ECONNRESET"); }
        return { data: { object: { sha: state.head } } };
      },
      getCommit: async () => ({ data: { tree: { sha: "base" } } }),
      createTree: async ({ tree }) => {
        const sha = `t${state.trees.size + 1}`;
        state.trees.set(sha, tree);
        return { data: { sha } };
      },
      createCommit: async ({ tree }) => {
        state.commits++;
        state.trees.set(`c${state.commits}`, state.trees.get(tree));
        return { data: { sha: `c${state.commits}` } };
      },
      updateRef: async ({ sha }) => {
        for (const entry of state.trees.get(sha)) state.files.set(entry.path, entry.content);
        state.head = sha;
        if (updateRefFails > 0) {
          updateRefFails--;
          state.pendingGetRefFails = getRefFails;
          throw new Error("socket hang up");
        }
        return { data: {} };
      },
    },
  };
  return state;
}

const item = (folder, text) => ({ folder: { name: folder }, queryName: folder, markdownContent: text, tweets: [{ tweets: [{ tweetId: "1" }] }] });

test("a commit that landed although its ref update reported an error is not committed again", async () => {
  const gh = fakeGitHub({ updateRefFails: 1 });
  const committed = [];
  const results = await github.uploadMarkdownBatch([item("Cat", "### One\nbody")], "o/r", { onCommitted: (items) => committed.push(...items) });
  assert.equal(gh.commits, 1, "the second attempt found the files on the branch");
  assert.equal(results[0].url, "https://github.com/o/r/blob/main/Cat/resources-001.md");
  assert.equal(committed.length, 1, "the sources are marked once the branch holds the files");
});

test("the end-of-run retry reuses the failed call's paths: no resources-N+1 duplicate", async () => {
  const gh = fakeGitHub({ updateRefFails: 1, getRefFails: 2 });
  const batch = [item("Cat", "### One\nbody")];
  const error = await github.uploadMarkdownBatch(batch, "o/r").then(() => null, (e) => e);
  assert.ok(error && Array.isArray(error.prepared), "the failed call hands its prepared paths back");
  assert.ok(gh.files.has("Cat/resources-001.md"), "the 'failed' attempt did land");

  const committed = [];
  const results = await github.uploadMarkdownBatch(batch, "o/r", { prepared: error.prepared, onCommitted: (items) => committed.push(...items) });
  assert.equal(gh.commits, 1, "nothing committed a second time");
  assert.ok(!gh.files.has("Cat/resources-002.md"));
  assert.equal(results[0].number, 1);
  assert.equal(committed.length, 1);
});

test("a retry whose path now holds other content commits nothing", async () => {
  const gh = fakeGitHub({ files: { "Cat/resources-001.md": "someone else's article" } });
  const prepared = [{ ...item("Cat", "x"), decodedFolder: "Cat", nextNumber: 1, fileName: "resources-001.md", filePath: "Cat/resources-001.md", fileUrl: "u", content: "### Mine\nbody" }];
  await assert.rejects(github.uploadMarkdownBatch([item("Cat", "x")], "o/r", { prepared }), /already exists with other content/);
  assert.equal(gh.commits, 0);
  assert.equal(gh.files.get("Cat/resources-001.md"), "someone else's article");
});

test("a committed digest is queued for DEV.to under its lead headline, with tags readers follow", async () => {
  fakeGitHub();
  const syndication = require("../src/services/syndication");
  const saved = syndication.queueMarkdownArticle;
  const queued = [];
  syndication.queueMarkdownArticle = async (args) => { queued.push(args); };
  try {
    await github.uploadMarkdownBatch([
      item("AI Developer Tools", "### 🚀 Acme Fooql 2.0 makes joins 3x faster\n\nAcme released Fooql 2.0, a query engine with joins that run three times faster."),
      item("Tech VIPs", "no heading at all, just a body long enough to be read as one"),
    ], "o/r");
  } finally { syndication.queueMarkdownArticle = saved; }
  assert.equal(queued[0].title, "Acme Fooql 2.0 makes joins 3x faster");
  assert.match(queued[0].description, /^Acme released Fooql 2\.0/, "the lead summary is the DEV.to snippet");
  assert.deepEqual(queued[0].tags, ["ai", "programming", "news"]);
  assert.equal(queued[1].title, "Tech VIPs #1", "no headline: the numbered folder title");
  assert.deepEqual(queued[1].tags, ["ai", "technology", "news"]);
});

test("a run commits to its day's branch with the co-author, and the end of the run merges it into main by a pull request", async () => {
  const config = require("../config");
  const saved = { ...config.github };
  Object.assign(config.github, { runBranches: true, coAuthor: "CosLynx <support@coslynx.com>" });
  github._runBranch = null;
  const state = fakeGitHub();
  const refs = new Set(), messages = [], calls = [];
  const getRef = github.octokit.git.getRef;
  github.octokit.git.getRef = async (args) => {
    if (args.ref !== "heads/main" && args.ref.startsWith("heads/run/") && !refs.has(args.ref.slice(6))) throw Object.assign(new Error("Not Found"), { status: 404 });
    return getRef(args);
  };
  github.octokit.git.createRef = async ({ ref }) => { refs.add(ref.replace("refs/heads/", "")); calls.push(`branch ${ref}`); return { data: {} }; };
  const createCommit = github.octokit.git.createCommit;
  github.octokit.git.createCommit = async (args) => { messages.push(args.message); return createCommit(args); };
  github.octokit.git.listMatchingRefs = async () => ({ data: [...refs].map((r) => ({ ref: `refs/heads/${r}` })) });
  github.octokit.git.deleteRef = async ({ ref }) => { refs.delete(ref.replace("heads/", "")); calls.push(`delete ${ref}`); return { data: {} }; };
  github.octokit.repos.compareCommits = async () => ({ data: { ahead_by: 2 } });
  github.octokit.pulls = {
    list: async () => ({ data: [] }),
    create: async ({ head }) => { calls.push(`pr ${head}`); return { data: { number: 42 } }; },
    merge: async ({ pull_number, merge_method }) => { calls.push(`merge #${pull_number} ${merge_method}`); return { data: {} }; },
  };
  try {
    const [r] = await github.uploadMarkdownBatch([item("AI Tools", "### 🤖 One\nbody")], "o/r");
    await github.uploadMarkdownBatch([item("AI Tools", "### 🤖 Two\nbody")], "o/r");
    assert.equal(calls.filter((c) => c.startsWith("branch")).length, 1, "one branch per day");
    assert.match(calls[0], /^branch refs\/heads\/run\/\d{4}-\d{2}-\d{2}$/);
    assert.ok(messages.every((m) => m.endsWith("\n\nCo-authored-by: CosLynx <support@coslynx.com>")), "every commit is co-authored");
    assert.match(r.url, /\/blob\/main\//, "links point at main, where the branch lands");
    assert.ok(state.commits >= 2);
    assert.deepEqual(await github.finishRunBranches("o", "r"), [42]);
    assert.deepEqual(calls.slice(1), [calls[1], "merge #42 merge", calls[3]]);
    assert.match(calls[1], /^pr run\//);
    assert.match(calls[3], /^delete heads\/run\//);
    assert.equal(refs.size, 0, "the branch is gone once merged");
  } finally {
    Object.assign(config.github, saved);
    github._runBranch = null;
  }
});
