// Preloaded by `npm test` (node --require) and required at the top of every test file, so a file
// run on its own is isolated too. Everything here is set before config/index.js loads dotenv, and
// dotenv never overrides a variable that is already set (even to ""), so no real key or posting
// flag from a developer's .env reaches a test. Nothing here ever reaches the network.
const fs = require("fs");
const os = require("os");
const path = require("path");

// config/index.js refuses to load without GitHub settings: inert placeholders.
process.env.GITHUB_PAT = "test-token-not-real";
process.env.GITHUB_USERNAME = "test-owner";
process.env.GITHUB_REPONAME = "test-repo";
// Commits go straight to main with no co-author unless a test turns run branches on itself.
process.env.GITHUB_RUN_BRANCHES = "false";
process.env.GITHUB_CO_AUTHOR = "";
// Secrets (key names from .env.example, plus the GitHub tokens the gh CLI reads): blank, so a
// stray call cannot authenticate or spend money.
for (const key of [
  "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "DEVTO_API_KEY", "GITHUB_TOKEN", "GH_TOKEN", "HF_TOKEN",
]) process.env[key] = "";
process.env.HF_DATASET_REPO = "";
// Posting flags: off. Several default to on when unset, so they are set to "false", not blanked.
// FACTORY_ENABLED is off too: the optional content factory never runs in a test unless the test
// turns it on itself.
for (const flag of [
  "X_REPLIES", "REDDIT_COMMENTS", "LINKEDIN_LIKE", "LINKEDIN_CONNECT", "LINKEDIN_FEED_REPLY", "LINKEDIN_VIRAL", "LINKEDIN_OWN_REPLIES",
  "DEVTO_AUTO_PUBLISH", "FACTORY_ENABLED",
]) process.env[flag] = "false";
// LLM providers: the documented default (openrouter, with no key) for every job, and the claude CLI
// settings at their defaults. Tests that need claude set the provider and CLAUDE_BIN themselves.
process.env.LLM_PROVIDER = "openrouter";
// LinkedIn targeting at its default (on); tests of the untargeted mode switch config.social.linkedinTargeted.
process.env.LINKEDIN_TARGETED = "true";
// No linked page is fetched and no t.co link resolved: tests that need either stub or enable it.
process.env.ARTICLE_FETCH_LINKS = "false";
for (const key of [
  "LLM_ARTICLE_PROVIDER", "LLM_COMMENT_PROVIDER", "LLM_VIRAL_PROVIDER",
  "CLAUDE_BIN", "CLAUDE_MODEL", "CLAUDE_EFFORT", "CLAUDE_VIRAL_MODEL", "CLAUDE_VIRAL_EFFORT", "CLAUDE_REQUEST_TIMEOUT_MS",
]) process.env[key] = "";

// helpers.js writes no log files when NODE_TEST_CONTEXT is set. node --test sets it in each file's
// process; set it for a file run on its own too, but never in the --test runner itself (its run()
// skips every file when the variable is already set).
if (!process.env.NODE_TEST_CONTEXT && !process.execArgv.includes("--test")) process.env.NODE_TEST_CONTEXT = "standalone";

// Every state file a test could touch lives in a throwaway dir per test process (test files run
// in parallel), never in the live repo a running `npm start` depends on. Tests that need their own
// paths set them again.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
process.env.PROCESSED_IDS_PATH = path.join(dir, ".processed-tweet-ids.json");
process.env.PIPELINE_LOCK_PATH = path.join(dir, ".pipeline.lock");
process.env.LINKEDIN_TRACK_PATH = path.join(dir, "data", "linkedin-feed-commented.json");
process.env.X_REPLIES_TRACK_PATH = path.join(dir, "data", "x-replies.json");
process.env.REDDIT_TRACK_PATH = path.join(dir, "data", "reddit-comments.json");
process.env.REDDIT_PAINPOINTS_PATH = path.join(dir, "data", "reddit-painpoints.jsonl");
process.env.SYNDICATION_QUEUE_PATH = path.join(dir, "data", "syndication-queue.json");
process.env.HF_DATASET_STATE_PATH = path.join(dir, "data", "hf-dataset.json");
process.env.KB_TOPICS_STATE_PATH = path.join(dir, "data", "kb-topics.json");
// Neither exists: the blog index rebuild and the blog's git sync find nothing to do.
process.env.BLOG_DIR = path.join(dir, "blog");
process.env.BLOG_REPO_DIR = path.join(dir, "no-repo");
// No factory checkout: its state (state/demand.json) never reaches a test that does not write one.
process.env.FACTORY_DIR = path.join(dir, "factory");
process.on("exit", () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});
// Retry delays (cron's folder retries) are real sleeps: none in tests.
process.env.PIPELINE_RETRY_DELAY_MS = "0";
