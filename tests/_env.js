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
// Secrets (key names from .env.example, plus the GitHub tokens the gh CLI reads): blank, so a
// stray call cannot authenticate or spend money.
for (const key of [
  "OPENROUTER_API_KEY", "NVIDIA_API_KEY", "DEVTO_API_KEY", "DISCORD_WEBHOOK_URL", "GITHUB_TOKEN", "GH_TOKEN",
]) process.env[key] = "";
// Posting flags: off. Several default to on when unset, so they are set to "false", not blanked.
// FACTORY_ENABLED is off too: the optional content factory never runs in a test unless the test
// turns it on itself.
for (const flag of [
  "TWITTER_POST", "LINKEDIN_LIKE", "LINKEDIN_CONNECT", "LINKEDIN_FEED_REPLY", "LINKEDIN_SIMPLE_REPLY",
  "DEVTO_AUTO_PUBLISH", "FACTORY_ENABLED",
]) process.env[flag] = "false";

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
process.env.SYNDICATION_QUEUE_PATH = path.join(dir, "data", "syndication-queue.json");
// Neither exists: the blog index rebuild and the blog's git sync find nothing to do.
process.env.BLOG_DIR = path.join(dir, "blog");
process.env.BLOG_REPO_DIR = path.join(dir, "no-repo");
process.on("exit", () => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
});
// Retry delays (cron's folder retries) are real sleeps: none in tests.
process.env.PIPELINE_RETRY_DELAY_MS = "0";
