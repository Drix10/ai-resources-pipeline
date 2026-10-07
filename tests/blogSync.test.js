const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { syncBlogToGit } = require("../src/services/cron");

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const write = (root, rel, text) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
};

// A bare "remote", a working clone (the pipeline checkout) and a second clone that plays the
// pipeline's own GitHub API commits advancing the remote behind its back.
function sandbox({ buildPasses = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "blogsync-"));
  const remote = path.join(base, "remote.git");
  git(base, "init", "--bare", "-b", "main", remote);
  const clone = (name) => {
    const dir = path.join(base, name);
    git(base, "clone", remote, dir);
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Tester");
    git(dir, "checkout", "-B", "main");
    return dir;
  };
  const work = clone("work");
  write(work, "blog/package.json", JSON.stringify({ scripts: { build: buildPasses ? "node -e \"process.exit(0)\"" : "node -e \"process.exit(1)\"" } }));
  write(work, "blog/content/Cat/a.md", "### A\nbody");
  write(work, "blog/lib/articles-index.json", "{}");
  write(work, "other/keep.txt", "x");
  git(work, "add", "-A");
  git(work, "commit", "-m", "init");
  git(work, "push", "-u", "origin", "main");
  return { base, remote, work, clone };
}

const inDir = async (dir, fn) => {
  const prev = process.cwd();
  process.chdir(dir);
  try { return await fn(); } finally { process.chdir(prev); }
};

test("publishes new blog files and rebases over commits the remote gained meanwhile", { timeout: 120000 }, async () => {
  const { work, clone, remote } = sandbox();
  const other = clone("other");
  write(other, "blog/content/Cat/api.md", "### From the API\nbody");
  git(other, "add", "-A");
  git(other, "commit", "-m", "api commit");
  git(other, "push", "origin", "main"); // the remote moves ahead of `work`

  write(work, "blog/content/Cat/b.md", "### B\nbody");
  write(work, "other/unrelated.txt", "must not be committed");
  await inDir(work, () => syncBlogToGit());

  const files = git(remote, "ls-tree", "-r", "--name-only", "main").split("\n");
  assert.ok(files.includes("blog/content/Cat/b.md"), "the new article reached the remote");
  assert.ok(files.includes("blog/content/Cat/api.md"), "the remote's own commit survived");
  assert.ok(!files.includes("other/unrelated.txt"), "unrelated working-tree files never ride along");
  assert.equal(git(work, "rev-parse", "HEAD"), git(remote, "rev-parse", "main"), "local and remote agree: no divergence");
  assert.match(git(work, "log", "-1", "--format=%s"), /sync new curated AI resource guides/);
  assert.equal(git(work, "status", "--porcelain", "--", "other/unrelated.txt"), "?? other/unrelated.txt", "the unrelated file is still just untracked");
});

test("nothing to publish is a quiet no-op", { timeout: 60000 }, async () => {
  const { work, remote } = sandbox();
  const before = git(remote, "rev-parse", "main");
  await inDir(work, () => syncBlogToGit());
  assert.equal(git(remote, "rev-parse", "main"), before);
});

test("a failing blog build publishes nothing and leaves the files staged for the next try", { timeout: 120000 }, async () => {
  const { work, remote } = sandbox({ buildPasses: false });
  const before = git(remote, "rev-parse", "main");
  write(work, "blog/content/Cat/b.md", "### B\nbody");
  await inDir(work, () => syncBlogToGit());
  assert.equal(git(remote, "rev-parse", "main"), before, "remote untouched");
  assert.equal(git(work, "log", "-1", "--format=%s"), "init", "no commit was made");
  assert.match(git(work, "status", "--porcelain"), /A\s+blog\/content\/Cat\/b\.md/, "still staged");
});

test("a push that failed last cycle is retried even when there is nothing new", { timeout: 120000 }, async () => {
  const { work, remote } = sandbox();
  write(work, "blog/content/Cat/b.md", "### B\nbody");
  git(work, "add", "-A");
  git(work, "commit", "-m", "feat(blog): earlier cycle, push never happened");
  assert.notEqual(git(work, "rev-parse", "HEAD"), git(remote, "rev-parse", "main"));
  await inDir(work, () => syncBlogToGit());
  assert.equal(git(work, "rev-parse", "HEAD"), git(remote, "rev-parse", "main"));
});

test("a detached HEAD is refused instead of pushing something odd", { timeout: 60000 }, async () => {
  const { work, remote } = sandbox();
  write(work, "blog/content/Cat/b.md", "### B\nbody");
  git(work, "checkout", "--detach");
  const before = git(remote, "rev-parse", "main");
  await inDir(work, () => syncBlogToGit());
  assert.equal(git(remote, "rev-parse", "main"), before);
});

test("a rebase conflict is aborted cleanly rather than leaving the checkout mid-rebase", { timeout: 120000 }, async () => {
  const { work, clone, remote } = sandbox();
  const other = clone("other");
  write(other, "blog/lib/articles-index.json", '{"remote":true}');
  git(other, "add", "-A");
  git(other, "commit", "-m", "remote edits the index");
  git(other, "push", "origin", "main");

  write(work, "blog/lib/articles-index.json", '{"local":true}');
  write(work, "blog/content/Cat/b.md", "### B\nbody");
  const remoteBefore = git(remote, "rev-parse", "main");
  await inDir(work, () => syncBlogToGit());
  assert.equal(git(remote, "rev-parse", "main"), remoteBefore, "nothing pushed on conflict");
  assert.ok(!fs.existsSync(path.join(work, ".git", "rebase-merge")) && !fs.existsSync(path.join(work, ".git", "rebase-apply")), "no rebase left in progress");
});
