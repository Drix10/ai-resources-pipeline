const { logger, handleError, sleep, REPO_ROOT } = require("../utils/helpers");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { factoryModule } = require("../utils/factory");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const feedEngage = require("./feedEngage");
const xReplies = require("./xReplies");
const redditComments = require("./redditComments");
const hnComments = require("./hnComments");
const hfDataset = require("./hfDataset");
const kbTopics = require("./kbTopics");
const GithubService = require("./github");
const llmService = require("./llm");

const BLOG_PATHS = ["blog/content", "blog/lib/articles-index.json"];
const BLOG_SYNC_SUBJECT = "feat(blog): sync new curated AI resource guides";
// The only branch the blog sync commits to and pushes (the one Vercel deploys).
const BLOG_DEPLOY_BRANCH = process.env.BLOG_DEPLOY_BRANCH || "main";
const envMs = (name, fallback) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const MAX_RETRIES = 3;
// Base delay between a folder's attempts (tests set PIPELINE_RETRY_DELAY_MS=0).
const RETRY_DELAY = envMs("PIPELINE_RETRY_DELAY_MS", 5000);
// The writer keeps about half its sources and a file needs 2 articles: fewer than 4 vetted posts is not
// worth a list's writing calls. Quality is the article gates' job, not this count's.
const MIN_PUBLISHABLE_CANDIDATES = 4;
// Anchored to the repo, not process.cwd(); tests point PIPELINE_LOCK_PATH and BLOG_REPO_DIR at temp folders.
const PIPELINE_LOCK_PATH = process.env.PIPELINE_LOCK_PATH || path.join(REPO_ROOT, ".pipeline.lock");
// The git checkout the blog sync commits in and pushes from.
const blogRepoDir = () => process.env.BLOG_REPO_DIR || REPO_ROOT;
// Longer than any step that blocks the event loop (a synchronous ffmpeg encode is capped at 15 min),
// so a live run's lock is never mistaken for a dead one.
const PIPELINE_LOCK_STALE_AFTER_MS = 30 * 60 * 1000;
let lockHeartbeatTimer = null;

// Set by stopPipeline: the running cycle stops at its next step (no new folders, no more posts).
let stopRequested = false;
const stopping = () => stopRequested;

// One browser job per site at a time, in the order asked: the article loop (X fetches, LinkedIn likes) and
// the engagement loop share each site's tab and chromedriver session. Different sites run side by side:
// each service attaches its own session and drives its own window (a hidden tab would stop rendering).
const siteQueues = {};
const withSite = (site, job) => {
  const run = (siteQueues[site] || Promise.resolve()).then(job);
  siteQueues[site] = run.catch(() => {});
  return run;
};
// Each engagement pass runs at most once in this window (jittered), so a run is no longer paced by them.
const ENGAGE_EVERY_MS = 25 * 60 * 1000;

// Two processes can race to reclaim the same stale lock; the loser finds it already gone.
const safeUnlink = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

// Removes a lock judged stale (`judged` is what was read from it; null when unreadable). Moved aside
// by rename, which succeeds for one process only, and the moved file must be the very lock judged
// stale: another run may have taken over in between, and its fresh lock is put back.
const takeOverStaleLock = (judged) => {
  const grave = `${PIPELINE_LOCK_PATH}.${process.pid}.stale`;
  try {
    fs.renameSync(PIPELINE_LOCK_PATH, grave);
  } catch {
    return false;
  }
  let moved = null;
  try { moved = JSON.parse(fs.readFileSync(grave, "utf8")); } catch { /* unreadable, like the one judged */ }
  if (moved && (!judged || moved.pid !== judged.pid || moved.heartbeatAt !== judged.heartbeatAt)) {
    try { fs.renameSync(grave, PIPELINE_LOCK_PATH); } catch { /* gone; nothing to restore */ }
    return false;
  }
  safeUnlink(grave);
  return true;
};

const startLockHeartbeat = () => {
  if (lockHeartbeatTimer) clearInterval(lockHeartbeatTimer);
  lockHeartbeatTimer = setInterval(() => {
    try {
      if (!fs.existsSync(PIPELINE_LOCK_PATH)) return;
      const lock = JSON.parse(fs.readFileSync(PIPELINE_LOCK_PATH, "utf8"));
      if (lock.pid === process.pid) {
        fs.writeFileSync(
          PIPELINE_LOCK_PATH,
          JSON.stringify({ ...lock, heartbeatAt: new Date().toISOString() }),
          "utf8",
        );
      }
    } catch (error) {
      logger.warn(`Could not update pipeline lock heartbeat: ${error.message}`);
    }
  }, 30000);
  if (lockHeartbeatTimer.unref) lockHeartbeatTimer.unref();
};

const lockIsFresh = (lock) => {
  const timestamp = Date.parse(lock?.heartbeatAt || lock?.startedAt || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp <= PIPELINE_LOCK_STALE_AFTER_MS;
};

const lockFileIsFresh = () => {
  try {
    return Date.now() - fs.statSync(PIPELINE_LOCK_PATH).mtimeMs <= PIPELINE_LOCK_STALE_AFTER_MS;
  } catch (error) {
    return false;
  }
};

const acquirePipelineLock = () => {
  try {
    const fd = fs.openSync(PIPELINE_LOCK_PATH, "wx");
    try {
      const now = new Date().toISOString();
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, startedAt: now, heartbeatAt: now }));
      startLockHeartbeat();
    } finally {
      try { fs.closeSync(fd); } catch (closeError) { }
    }
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let lock = null;
    try {
      lock = JSON.parse(fs.readFileSync(PIPELINE_LOCK_PATH, "utf8"));
      if (!Number.isInteger(lock?.pid) || lock.pid <= 0) {
        if (lockFileIsFresh()) {
          logger.warn("Pipeline lock is being initialized; skipping this run.");
          return false;
        }
        return takeOverStaleLock(lock) && acquirePipelineLock();
      }
      // Our own pid in the lock can only be a leftover (Windows reuses pids after a quick
      // restart): this process never asks for the lock while it holds it.
      if (lock.pid === process.pid) {
        return takeOverStaleLock(lock) && acquirePipelineLock();
      }
      // A lock left by a terminated run must not block the next run.
      process.kill(lock.pid, 0);
      // The PID may have been reused by an unrelated process: a live holder keeps
      // heartbeating, so a stale heartbeat means the lock is dead.
      if (!lockIsFresh(lock)) {
        logger.warn(`Pipeline lock heartbeat is stale (PID ${lock.pid} reused or hung); reclaiming.`);
        return takeOverStaleLock(lock) && acquirePipelineLock();
      }
      logger.warn(`Another pipeline process is already running (PID ${lock.pid}); skipping this run.`);
      return false;
    } catch (lockError) {
      if (lockError.code === "ESRCH" || (lockError instanceof SyntaxError && !lockFileIsFresh())) {
        return takeOverStaleLock(lock) && acquirePipelineLock();
      }
      if (lockError instanceof SyntaxError && lockFileIsFresh()) {
        logger.warn("Pipeline lock is being updated; skipping this run.");
        return false;
      }
      if (lockError.code === "EPERM") {
        if (!lock || !lockIsFresh(lock)) {
          return takeOverStaleLock(lock) && acquirePipelineLock();
        }
        logger.warn(`Pipeline lock belongs to an inaccessible active process (PID ${lock.pid}); skipping this run.`);
        return false;
      }
      throw lockError;
    }
  }
};

const releasePipelineLock = () => {
  if (lockHeartbeatTimer) {
    clearInterval(lockHeartbeatTimer);
    lockHeartbeatTimer = null;
  }
  try {
    if (!fs.existsSync(PIPELINE_LOCK_PATH)) return;
    const lock = JSON.parse(fs.readFileSync(PIPELINE_LOCK_PATH, "utf8"));
    if (lock.pid === process.pid) safeUnlink(PIPELINE_LOCK_PATH);
  } catch (error) {
    logger.warn(`Could not release pipeline lock: ${error.message}`);
  }
};

// Runs a command without blocking the event loop (the lock heartbeat must keep beating during a
// multi-minute build) and returns its exit status and output instead of throwing.
const run = (command, args, { timeout = 60000, shell = false, cwd } = {}) =>
  new Promise((resolve) => {
    const { spawn, spawnSync } = require("child_process");
    let out = "";
    let err = "";
    let timedOut = false;
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    // Git must never wait on a login prompt or a credential-manager window nobody will answer.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
    const child = spawn(command, args, { shell, windowsHide: true, env, cwd });
    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the whole tree (a shell's grandchild holds the pipes open otherwise), then stop waiting.
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 15000 });
      else child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
      finish({ status: -1, out, err, timedOut });
    }, timeout);
    child.stdout.on("data", (d) => { out = (out + d).slice(-4000); });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    child.on("error", (e) => finish({ status: -1, out, err: err || e.message, timedOut }));
    child.on("close", (status) => finish({ status: timedOut ? -1 : status, out, err, timedOut }));
  });

/**
 * Publishes blog/content and the search index to the repo Vercel deploys; true once pushed. This runs git in the
 * checkout the bot runs from, which may also be where you develop, so it is careful:
 *  - only on BLOG_DEPLOY_BRANCH (main): never commits to or pushes a feature branch;
 *  - at most one new blog commit a day: once one reached origin today, new files wait for tomorrow;
 *  - never pushes your own unpushed commits: it waits until you have pushed them;
 *  - builds first and stages after, so a failed build never leaves blog files in your index;
 *  - pulls only when upstream did not touch a file you have uncommitted edits in, so the
 *    autostash can never leave conflict markers in source files;
 *  - recovers from an interrupted rebase or a stale index.lock left by a killed run.
 */
const publishBlog = async (root) => {
  const fail = (step, result) => {
    const detail = (result.err || result.out || "").trim().split("\n").slice(-3).join(" | ");
    logger.error(`Cycle End: blog sync stopped at "${step}"${result.timedOut ? " (timed out)" : ""}: ${detail}`);
  };
  const lines = (r) => String(r.out || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const inRepo = (command, args, opts) => run(command, args, { ...opts, cwd: root });
  try {
    // A run killed mid-rebase or mid-commit leaves these behind; nothing else ever clears them.
    const gitDir = path.join(root, ".git");
    if (fs.existsSync(path.join(gitDir, "rebase-merge")) || fs.existsSync(path.join(gitDir, "rebase-apply"))) {
      logger.warn("Cycle End: aborting a rebase a previous run left behind.");
      await inRepo("git", ["rebase", "--abort"], { timeout: 30000 });
    }
    const indexLock = path.join(gitDir, "index.lock");
    try { if (Date.now() - fs.statSync(indexLock).mtimeMs > 10 * 60 * 1000) fs.rmSync(indexLock, { force: true }); } catch { /* none */ }

    const branchResult = await inRepo("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 10000 });
    const branch = branchResult.out.trim();
    if (branchResult.status !== 0 || !branch || branch === "HEAD") {
      return logger.error("Cycle End: blog sync skipped: not on a branch (detached HEAD).");
    }
    if (branch !== BLOG_DEPLOY_BRANCH) {
      return logger.warn(`Cycle End: blog sync skipped: the checkout is on "${branch}", not ${BLOG_DEPLOY_BRANCH}; switch back and the next run publishes everything.`);
    }

    const changed = await inRepo("git", ["status", "--porcelain", "--", ...BLOG_PATHS], { timeout: 30000 });
    const hasChanges = changed.status === 0 && lines(changed).length > 0;
    const unpushed = await inRepo("git", ["log", `origin/${branch}..HEAD`, "--format=%s"], { timeout: 30000 });
    const unpushedSubjects = unpushed.status === 0 ? lines(unpushed) : [];
    // Your own commits never ride along with the bot's push: they go when you push them.
    const ownCommits = unpushedSubjects.filter((s) => s !== BLOG_SYNC_SUBJECT);
    if (!hasChanges && !unpushedSubjects.length) return logger.info("Cycle End: no new blog files to publish.");

    // Every push is a Vercel deploy, and a deploy renders and stores every page again: new files wait
    // in the checkout and ship in one push a day.
    if (hasChanges && !unpushedSubjects.includes(BLOG_SYNC_SUBJECT)) {
      const synced = await inRepo("git", ["log", "-5", "--format=%ct %s", "--fixed-strings", `--grep=${BLOG_SYNC_SUBJECT}`, `origin/${branch}`], { timeout: 30000 });
      const last = lines(synced).find((l) => l.slice(l.indexOf(" ") + 1) === BLOG_SYNC_SUBJECT);
      if (last && new Date(Number(last.split(" ")[0]) * 1000).toDateString() === new Date().toDateString()) {
        return logger.info(`Cycle End: the blog already shipped today; ${lines(changed).length} blog change(s) wait for the next day's run.`);
      }
    }

    if (hasChanges) {
      logger.info("Cycle End: running the blog build before publishing...");
      // (one command string: npm is a .cmd on Windows, so it needs the shell, and Node warns of args passed beside one)
      const build = await inRepo("npm --prefix blog run build", [], { timeout: 15 * 60 * 1000, shell: true });
      if (build.status !== 0) return fail("blog build", build);
      logger.info("Cycle End: blog build passed.");

      const added = await inRepo("git", ["add", "--", ...BLOG_PATHS], { timeout: 30000 });
      if (added.status !== 0) return fail("git add", added);
      const commit = await inRepo("git", ["commit", "-m", BLOG_SYNC_SUBJECT, "--", ...BLOG_PATHS], { timeout: 60000 });
      if (commit.status !== 0) {
        await inRepo("git", ["reset", "-q", "--", ...BLOG_PATHS], { timeout: 30000 });
        return fail("git commit", commit);
      }
    }

    if (ownCommits.length) {
      return logger.warn(`Cycle End: blog committed locally but not pushed: ${ownCommits.length} of your own commit(s) are unpushed on ${branch} ("${ownCommits[0]}"). The bot never pushes your work; push it and the blog goes with it.`);
    }

    const fetched = await inRepo("git", ["fetch", "origin", branch], { timeout: 120000 });
    if (fetched.status !== 0) return fail("git fetch", fetched);
    // Upstream changes to a file you are editing would make the autostash conflict: wait instead.
    const dirty = await inRepo("git", ["status", "--porcelain", "--untracked-files=no"], { timeout: 30000 });
    const dirtyFiles = new Set(lines(dirty).map((l) => l.slice(3).replace(/^"|"$/g, "")));
    const incoming = await inRepo("git", ["diff", "--name-only", `HEAD...origin/${branch}`], { timeout: 30000 });
    const clash = lines(incoming).filter((f) => dirtyFiles.has(f));
    if (clash.length) {
      return logger.warn(`Cycle End: blog committed locally but not pushed: origin changed ${clash.length} file(s) you have uncommitted edits in (${clash.slice(0, 3).join(", ")}). Commit or stash them; the next run pushes.`);
    }

    const pulled = await inRepo("git", ["pull", "--rebase", "--autostash", "origin", branch], { timeout: 120000 });
    if (pulled.status !== 0) {
      await inRepo("git", ["rebase", "--abort"], { timeout: 30000 });
      return fail("git pull --rebase", pulled);
    }
    const pushed = await inRepo("git", ["push", "origin", `HEAD:${branch}`], { timeout: 120000 });
    if (pushed.status !== 0) return fail("git push", pushed);
    logger.info(`Cycle End: pushed the blog to origin/${branch} (triggers the Vercel deploy).`);
    return true;
  } catch (error) {
    logger.error(`Cycle End: blog sync failed unexpectedly: ${error.message}`);
  }
  return false;
};
const syncBlogToGit = async (root = blogRepoDir()) => (await publishBlog(root)) === true;

// Outages that hit every folder the same way: retrying them only hammers X or the provider.
const RUN_ENDING_CODES = new Set(["LOCAL_LLM_UNAVAILABLE", "LLM_UNAVAILABLE", "X_UNAVAILABLE"]);

// Set when the published-ID store could not be written: curation stops for the run and
// the save is retried before it ends (the next run would otherwise curate the same sources again).
let idsUnsaved = false;
const markPublished = (collections) => {
  if (TwitterService.markContentAsPublished(collections) === false) idsUnsaved = true;
};

// Two tries inside (it reattaches the browser on a session error) times runDataPipeline's three.
const fetchFolder = (folder) => withSite("x", () => {
  logger.info(`Fetching tweets for folder: ${folder.name}...`);
  return TwitterService.fetchTweets({ folder, maxRetries: 2, shouldStop: stopping });
});

// `prefetched`: this folder's fetch, already started (its first attempt); `onFetched` runs once the
// sources are in, before the writer starts (the run fetches the next folder meanwhile).
const runDataPipeline = async (folder, { prefetched = null, onFetched = () => {} } = {}) => {
  let tweets = null;
  for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
    try {
      if (!tweets) {
        // Let failures reach the retry loop. Converting a browser/network failure
        // into an empty array makes the pipeline falsely report "no new content".
        const pending = prefetched || fetchFolder(folder);
        prefetched = null; // a retry fetches again
        const fetched = await pending;
        if (!Array.isArray(fetched)) {
          throw new Error(`X fetch returned an invalid result for folder ${folder.name}`);
        }

        if (fetched.length === 0) {
          logger.info(`No new content found on X for folder: ${folder.name}`);
          return null;
        }

        if (fetched.length < MIN_PUBLISHABLE_CANDIDATES) {
          logger.info(
            `Skipping ${folder.name}: only ${fetched.length} vetted posts (fewer than ${MIN_PUBLISHABLE_CANDIDATES}).`
          );
          return null;
        }
        // A writer retry reuses these instead of scraping X again.
        tweets = fetched;
        onFetched();
      }

      const { markdown: markdownContent, usedTweets } = await llmService.generateMarkdownBatched(tweets, folder?.name);

      return {
        folder,
        queryName: folder.name,
        // Only the sources the writer consumed are marked after the commit; the rest stay
        // available for the next run.
        tweets: Array.isArray(usedTweets) ? usedTweets : tweets,
        markdownContent,
        fileBuffer: Buffer.from(markdownContent)
      };
    } catch (error) {
      if (error.code === "MARKDOWN_QUALITY_REJECTED") {
        // The writer judged these sources (thin, off-topic, rejected): mark them so the next run
        // does not spend calls on them again. The error carries them, so log only its message.
        if (Array.isArray(error.usedTweets) && error.usedTweets.length) markPublished(error.usedTweets);
        logger.warn(`${folder.name}: no file this run (${error.message}); ${error.usedTweets?.length || 0} judged source(s) will not be retried.`);
        return null;
      }
      // A stop is no failure: nothing is retried or reported, and the sources judged before it are kept.
      if (error.code === "CLAUDE_STOPPED" || stopping()) {
        if (Array.isArray(error.usedTweets) && error.usedTweets.length) markPublished(error.usedTweets);
        throw error;
      }
      logger.error(`Pipeline error for folder ${folder.name} (attempt ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`, { code: error.code });
      if (RUN_ENDING_CODES.has(error.code)) {
        // The writer judged some sources before it went down: mark those (only those), or the next
        // run pays to judge them again.
        if (Array.isArray(error.usedTweets) && error.usedTweets.length) markPublished(error.usedTweets);
        throw error;
      }
      if (retryCount === MAX_RETRIES - 1) {
        handleError(
          error,
          `Pipeline error for folder (attempt ${retryCount + 1}/${MAX_RETRIES})`,
          { folder }
        );
        throw error;
      }
      logger.info(`Retrying in ${RETRY_DELAY * (retryCount + 1)}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
    }
  }
};

// A long wait that ends as soon as a stop is requested.
const pauseUnlessStopped = async (ms) => {
  const end = Date.now() + ms;
  while (!stopping() && Date.now() < end) await sleep(Math.min(1000, end - Date.now()));
};

// The IDs of committed sources are only in memory: keep trying to write them before the run ends.
const saveIdsBeforeExit = async () => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await sleep(RETRY_DELAY * attempt);
    if (TwitterService.persistProcessedIds()) {
      idsUnsaved = false;
      return logger.info("Published X IDs saved on retry.");
    }
  }
  logger.error("Published X IDs could NOT be saved: the next run may curate this run's sources again. Check the store file (.processed-tweet-ids.json) and its folder permissions.");
};

/**
 * One run: curates every folder and commits the articles in batches while the engagement passes run beside
 * them, then updates the README, syncs the blog, runs the optional factory and the DEV.to queue.
 */
const processAllFolders = async () => {
  if (!acquirePipelineLock()) return { ran: false };

  try {
    // Re-read the processed-ID store (another instance or a manual edit may have changed it) and
    // start this run's cross-folder dedupe sets.
    TwitterService.beginRun?.();
    llmService.beginRun?.();
    idsUnsaved = false;
    const successfulArticles = [];
    const folders = config.folders;
    logger.info(`Processing all ${folders.length} folders this run.`);
    // A random batch size of 1 to 8 articles per commit.
    const nextBatchSize = () => Math.floor(Math.random() * 8) + 1;
    let COMMIT_BATCH_SIZE = nextBatchSize(); // re-rolled after every batch commit
    let pendingBatch = [];
    // Optional content factory add-on: digest items committed this run become reel/carousel candidates.
    const factoryInbox = [];

    // Two loops run side by side, each browser job under its site's lock (withSite):
    //  - the article loop: while the writer works on a folder, the next folder is fetched on X and the
    //    previous article's few random LinkedIn likes are done (likeAfterArticle); commits go in batches
    //  - the engagement loop: replies on our own posts (first, at the start of the run: a run started right
    //    after a post covers its golden hour), 2 or 3 LinkedIn comments, 1 or 2 more on posts going viral,
    //    X replies (X_REPLIES) the same way, at most one Reddit comment (REDDIT_COMMENTS) and one
    //    HN comment (HN_COMMENTS), then stale
    //    invites withdrawn and a few connection requests. Each pass runs at most once per ENGAGE_EVERY_MS;
    //    a pass at its daily cap returns before it touches the browser. One pass at a time: the passes
    //    share llmService.commentDeadline.
    // Sources follow LINKEDIN_TARGETED; non-English posts are skipped. Never fatal.
    // A fatal error in the article loop stops the engagement loop too.
    let aborted = false;
    const halted = () => stopping() || aborted;
    const repliesOnOurPosts = async () => {
      try {
        const r = await feedEngage.runOwnRepliesPass({ max: 6, shouldStop: halted });
        logger.info(`Engagement: LinkedIn replies on our posts ${r.replied} posted, ${r.owner.length} need you, ${r.skipped} skipped. ${r.reason || ""}`);
      } catch (replyErr) {
        logger.error("LinkedIn replies on our posts failed (non-fatal):", replyErr.message);
      }
    };
    const likeAfterArticle = async () => {
      if (!config.social.linkedinLike || halted()) return;
      try {
        const likeResult = await feedEngage.runLikePass({ min: 3, max: 6, shouldStop: halted });
        logger.info(`Article done: LinkedIn likes ${likeResult.liked}/${likeResult.target}.`);
      } catch (feedErr) {
        logger.error("LinkedIn likes failed (non-fatal):", feedErr.message);
      }
    };
    const xPass = (viral) => async () => {
      try {
        const r = await xReplies.runXReplyPass({ twitter: TwitterService, viral, max: (viral ? 1 : 2) + Math.floor(Math.random() * 2), shouldStop: halted });
        logger.info(`Engagement: X ${viral ? "viral " : ""}replies ${r.replied} posted, ${r.skipped} skipped. ${r.reason || ""}`);
      } catch (xErr) {
        logger.error(`X ${viral ? "viral " : ""}reply pass failed (non-fatal):`, xErr.message);
      }
    };
    // In the order they run; `on` is read under the site's lock (xReady is known once X init is done).
    const passes = [
      { site: "linkedin", on: () => config.social.linkedinOwnReplies, run: repliesOnOurPosts },
      { site: "linkedin", on: () => config.social.linkedinFeedReply, run: async () => {
        try {
          const engageResult = await feedEngage.runFeedEngagement({ max: 2 + Math.floor(Math.random() * 2), shouldStop: halted });
          logger.info(`Engagement: LinkedIn comments ${engageResult.commented} posted, ${engageResult.skipped} skipped. ${engageResult.reason || ""}`);
        } catch (feedErr) {
          logger.error("LinkedIn comment pass failed (non-fatal):", feedErr.message);
        }
      } },
      { site: "linkedin", on: () => config.social.linkedinFeedReply && config.social.linkedinViral, run: async () => {
        try {
          const viral = await feedEngage.runViralPass({ max: 1 + Math.floor(Math.random() * 2), shouldStop: halted });
          logger.info(`Engagement: LinkedIn viral comments ${viral.commented} posted, ${viral.skipped} skipped. ${viral.reason || ""}`);
        } catch (viralErr) {
          logger.error("LinkedIn viral comment pass failed (non-fatal):", viralErr.message);
        }
      } },
      { site: "x", on: () => config.social.xReplies && xReady, run: xPass(false) },
      { site: "x", on: () => config.social.xReplies && xReady, run: xPass(true) },
      { site: "reddit", on: () => config.social.redditComments, run: async () => {
        try {
          const r = await redditComments.runRedditPass({ max: 1, shouldStop: halted });
          logger.info(`Engagement: Reddit comments ${r.commented} posted, ${r.skipped} skipped, ${r.pains} pain points logged. ${r.reason || ""}`);
        } catch (redditErr) {
          logger.error("Reddit comment pass failed (non-fatal):", redditErr.message);
        }
      } },
      { site: "hn", on: () => config.social.hnComments, run: async () => {
        try {
          const r = await hnComments.runHnPass({ max: 1, shouldStop: halted });
          logger.info(`Engagement: HN comments ${r.commented} posted, ${r.skipped} skipped. ${r.reason || ""}`);
        } catch (hnErr) {
          logger.error("HN comment pass failed (non-fatal):", hnErr.message);
        }
      } },
      // Stale pending invites go first: a low acceptance rate narrows the account's reach.
      { site: "linkedin", on: () => config.social.linkedinConnect, run: async () => {
        try {
          const wd = await feedEngage.runWithdrawPass({ max: 5, shouldStop: halted });
          logger.info(`Engagement: LinkedIn invites withdrawn ${wd.withdrawn} (${wd.stale} pending 14+ days). ${wd.reason || ""}`);
        } catch (wdErr) {
          logger.error("LinkedIn withdraw pass failed (non-fatal):", wdErr.message);
        }
      } },
      { site: "linkedin", on: () => config.social.linkedinConnect, run: async () => {
        try {
          const conn = await feedEngage.runConnectPass({ min: 3, max: 7, shouldStop: halted });
          logger.info(`Engagement: LinkedIn connections ${conn.sent}/${conn.target} sent. ${conn.reason || ""}`);
        } catch (connErr) {
          logger.error("LinkedIn connection pass failed (non-fatal):", connErr.message);
        }
      } },
    ].map((p) => ({ ...p, dueAt: 0 }));
    let articlesDone = false;
    let wakeEngagement = () => {};
    const articlesFinished = new Promise((resolve) => { wakeEngagement = resolve; });
    // Rounds of the passes that are due, until the articles are done (one last round then: whatever came
    // due meanwhile) or the run halts.
    const engagementLoop = async () => {
      try {
        while (!halted()) {
          const last = articlesDone;
          for (const p of passes) {
            if (halted()) return;
            if (Date.now() < p.dueAt) continue;
            await withSite(p.site, () => (p.on() && !halted() ? p.run() : null));
            p.dueAt = Date.now() + ENGAGE_EVERY_MS * (0.88 + Math.random() * 0.24);
          }
          if (last) return;
          const wake = Math.min(...passes.map((p) => p.dueAt));
          while (!halted() && !articlesDone && Date.now() < wake) {
            await Promise.race([articlesFinished, sleep(Math.min(1000, wake - Date.now()))]);
          }
        }
      } catch (loopErr) {
        logger.error("Engagement loop failed (non-fatal):", loopErr?.message ?? loopErr);
      }
    };

    // A batch whose commit failed (a GitHub blip) is retried once at the end of the run, with the
    // paths it was given: if the failed attempt landed after all, the retry finds it on the branch.
    const failedBatches = [];
    const flushBatch = async ({ retry = false, prepared = null } = {}) => {
      if (pendingBatch.length === 0) return;
      // Committing while the published-ID store cannot be written would let the next run curate
      // (and commit) the same sources again: these stay uncommitted and their sources unmarked.
      if (idsUnsaved) {
        logger.error(`Not committing ${pendingBatch.length} article(s): the published-ID store could not be saved this run.`);
        pendingBatch = [];
        return;
      }
      const batchToCommit = [...pendingBatch];
      pendingBatch = [];
      COMMIT_BATCH_SIZE = nextBatchSize();

      logger.info(
        `Flushing batch of ${batchToCommit.length} folder article(s) to GitHub in 1 consolidated commit...`
      );

      try {
        const results = await GithubService.uploadMarkdownBatch(
          batchToCommit,
          `${config.github.owner}/${config.github.repo}`,
          {
            prepared,
            // Only a confirmed GitHub commit consumes the source IDs, and they are marked the moment
            // it lands, before anything else: a kill afterwards never leaves committed items unmarked.
            onCommitted: (committed) => { for (const item of committed) markPublished(item.tweets); },
          }
        );

        for (const item of results) {
          logger.info(`Pipeline succeeded for folder ${item.queryName}: ${item.url}`);
          if (config.factory.enabled) {
            try {
              factoryInbox.push(...factoryModule("sources").fromDigest(item.content, { topic: item.queryName, url: item.url }));
            } catch (inboxErr) {
              logger.warn(`Factory: could not read ${item.queryName} digest (non-fatal): ${inboxErr.message}`);
            }
          }
          successfulArticles.push({
            title: item.queryName,
            githubUrl: item.url,
            fullContent: item.content
          });
        }
      } catch (batchErr) {
        logger.error(`Batch GitHub commit failed for ${batchToCommit.length} folders${retry ? " (retry)" : "; will retry at the end of the run"}:`, batchErr);
        if (!retry) failedBatches.push({ items: batchToCommit, prepared: batchErr?.prepared || null });
      }
    };

    // A branch an earlier run left unmerged (stopped, crashed) goes into main first: a new day's branch made
    // from main without it would number the same digest files again and never merge.
    await GithubService.finishRunBranches(config.github.owner, config.github.repo);

    // The X phase is isolated: a session or network failure there must not cost the run its
    // README update, blog sync and factory pass. Init goes first on the X lock, before any X job.
    let xReady = true;
    const xInit = withSite("x", () => TwitterService.init()).catch((xErr) => {
      xReady = false;
      logger.error(`X session unavailable this run; skipping curation: ${xErr?.message ?? xErr}`);
    });
    const engaging = engagementLoop();

    const articleLoop = async () => {
      await xInit;
      let consecutiveFailures = 0;
      // The next folder's fetch, started while the writer works on this one.
      let prefetch = null;
      // The last article's LinkedIn likes, done while the next one is written.
      let likes = Promise.resolve();
      let likesBusy = false;
      try {
        for (const [i, folder] of (xReady ? folders : []).entries()) {
          const prefetched = prefetch?.folder === folder ? prefetch.promise : null;
          prefetch = null;
          if (stopping()) {
            logger.warn("Stop requested: no more folders this run.");
            break;
          }
          if (idsUnsaved) {
            logger.error("The published-ID store could not be saved: no more curation this run.");
            break;
          }
          const onFetched = () => {
            const next = folders[i + 1];
            if (!next || stopping() || idsUnsaved) return;
            prefetch = { folder: next, promise: fetchFolder(next) };
            prefetch.promise.catch(() => {}); // handled when its folder's turn comes
          };
          try {
            const prepared = await runDataPipeline(folder, { prefetched, onFetched });
            consecutiveFailures = 0;
            if (prepared) {
              logger.info(
                `Prepared article for ${prepared.queryName}. Queued in commit batch (${pendingBatch.length + 1}/${COMMIT_BATCH_SIZE}).`
              );
              pendingBatch.push(prepared);
              // Random feed likes, not this article's: while the last round still waits on LinkedIn (a comment
              // pass holds it), this round is skipped rather than holding up the next fetch.
              if (!likesBusy) {
                likesBusy = true;
                likes = withSite("linkedin", likeAfterArticle).finally(() => { likesBusy = false; });
              }
              if (pendingBatch.length >= COMMIT_BATCH_SIZE) {
                await flushBatch();
              }
            } else {
              logger.info(
                `Pipeline completed for folder with no article (no new threads, or generation failed gates - see warnings above).`
              );
            }
          } catch (error) {
            if (error.code === "CLAUDE_STOPPED" || stopping()) {
              // A killed Claude means the run is stopping, even before the stop flag is seen.
              requestStop();
              // A real failure that lands during a stop is still worth its line.
              const why = error.code === "CLAUDE_STOPPED" ? "" : ` (it failed as the stop came: ${error.code ? `${error.code}: ` : ""}${error.message})`;
              logger.info(`Stopping: ${folder.name} ends here${why}.`);
              break;
            }
            logger.error(`Pipeline iteration failed for folder ${folder.name}:`, error);
            if (error.code === "LOCAL_LLM_UNAVAILABLE") {
              logger.warn("Local Ollama service is unavailable. Stopping this run instead of retrying every folder.");
              break;
            }
            if (RUN_ENDING_CODES.has(error.code)) {
              logger.warn(`${error.code}: ending the X phase for this run (${error.message}).`);
              if (error.code === "X_UNAVAILABLE") xReady = false; // no X replies either
              break;
            }
            // An outage (DNS, network, a dead browser) fails every folder the same way: stop the X
            // phase after three in a row instead of retrying all of them, and still finish the run.
            if (++consecutiveFailures >= 3) {
              logger.warn("Three folders failed in a row; ending the X phase for this run.");
              break;
            }
          }
        }
      } finally {
        // Nothing of this loop outlives it: a fetch or likes still running (a break, a stop) is waited for.
        await Promise.all([prefetch?.promise.catch(() => {}), likes]);
      }

      // Flush any remaining prepared articles in final batch (also when stopping: they are generated).
      if (pendingBatch.length > 0) {
        logger.info(`Flushing final remaining batch of ${pendingBatch.length} folder article(s)...`);
        await flushBatch();
      }
      for (const batch of failedBatches.splice(0)) {
        logger.info(`Retrying a failed batch of ${batch.items.length} folder article(s)...`);
        pendingBatch = batch.items;
        await flushBatch({ retry: true, prepared: batch.prepared });
      }
    };

    // The end steps below start only once both loops are done.
    try {
      await articleLoop();
    } catch (loopErr) {
      aborted = true;
      throw loopErr;
    } finally {
      articlesDone = true;
      wakeEngagement();
      await engaging;
    }

    if (stopping()) {
      logger.warn("Stop requested: skipping the README update, blog sync and content factory.");
      return { ran: true, articles: successfulArticles.length, stopped: true };
    }

    await GithubService.updateReadmeWithNewFile(
      config.github.owner,
      config.github.repo
    );
    // Daily: topic pages and TIMELINE.md, committed on the run's branch so the merge below takes them too.
    try {
      await kbTopics.runKbTopics({ shouldStop: stopping });
    } catch (topicsErr) {
      logger.warn(`Cycle End: topic pages failed (non-fatal): ${topicsErr?.message ?? topicsErr}`);
    }
    // The run's commits (and any an earlier run left on its branch) go into main through a merged pull request.
    await GithubService.finishRunBranches(config.github.owner, config.github.repo);

    // Weekly: the resources repo as a Hugging Face dataset (skipped without HF_TOKEN or inside 7 days of the last upload).
    if (!stopping()) {
      try {
        await hfDataset.runHfDataset({ shouldStop: stopping });
      } catch (hfErr) {
        logger.warn(`Cycle End: Hugging Face dataset upload failed (non-fatal): ${hfErr?.message ?? hfErr}`);
      }
    }

    if (successfulArticles.length > 0) {
      logger.info(`Cycle End: Successfully processed and syndicated ${successfulArticles.length} curated guide(s).`);
    }
    let blogPushed = false;

    // Rebuild the blog index, then publish every new article in one blog commit.
    try {
      const { rebuildBlogIndex } = require("../utils/helpers");
      if (typeof rebuildBlogIndex === "function") {
        rebuildBlogIndex();
        logger.info("Cycle End: Rebuilt local Knowledge Hub search index.");
      }

      // Commit and push the blog content, but only after the blog still builds with it.
      blogPushed = await syncBlogToGit();
    } catch (indexErr) {
      logger.warn("Cycle End: Index rebuild skipped:", indexErr.message);
    }

    // --- Optional content factory add-on (src/utils/factory.js; FACTORY_ENABLED=true) ---
    // Last, after every commit, the LinkedIn steps and the blog sync: the editor picks this run's
    // one most viral story, researches it, makes the reel and posts within the cap. Never fatal
    // to the content pipeline.
    if (config.factory.requested && !config.factory.enabled) {
      logger.warn("FACTORY_ENABLED=true, but the content factory is not checked out at ./factory (or FACTORY_DIR): skipping it.");
    }
    if (config.factory.enabled && !stopping()) {
      try {
        await factoryModule().runCycle({ extraSources: factoryInbox });
      } catch (factoryErr) {
        logger.error(`Content factory pass failed (non-fatal): ${factoryErr?.message ?? factoryErr}`);
      }
    }

    // DEV.to copies go out only once their canonical blog page is live, so this runs last: the
    // Vercel deploy started by the blog push has had the factory pass (or a short wait) to finish.
    // Anything not live yet stays queued for the next run.
    if (!stopping()) {
      try {
        const syndication = require("./syndication");
        if (typeof syndication.processQueue === "function") {
          if (blogPushed && !(config.factory.enabled)) await pauseUnlessStopped(4 * 60 * 1000);
          if (!stopping()) {
            const synd = await syndication.processQueue();
            if (synd) logger.info(`Cycle End: DEV.to queue: ${JSON.stringify(synd)}`);
          }
        }
      } catch (syndErr) {
        logger.warn(`Cycle End: DEV.to queue failed (non-fatal): ${syndErr?.message ?? syndErr}`);
      }
    }

    // Delete failure screenshots older than three days.
    TwitterService.cleanupScreenshots();
    return { ran: true, articles: successfulArticles.length, xReady };
  } finally {
    if (idsUnsaved) await saveIdsBeforeExit();
    // Release the browsers at the end of the run, whatever happened in it.
    await TwitterService.cleanup().catch(() => {});
    await feedEngage.cleanup().catch(() => {});
    await redditComments.cleanup().catch(() => {});
    await hnComments.cleanup().catch(() => {});
    releasePipelineLock();
  }
};

let activePipelinePromise = null;

/**
 * One full run, started by `npm start`: articles and batch commits, LinkedIn, the blog push and
 * DEV.to, plus one reel when the optional content factory add-on is enabled (src/utils/factory.js).
 * Resolves "ok", "locked" (another run holds the lock), "stopped" or "failed".
 */
const runPipeline = async () => {
  if (activePipelinePromise) {
    logger.warn("A pipeline run is already in progress.");
    return "busy";
  }
  logger.info(`Running the pipeline at ${new Date().toISOString()}`);
  const pipelinePromise = processAllFolders();
  activePipelinePromise = pipelinePromise;
  try {
    const result = await pipelinePromise;
    return result?.ran === false ? "locked" : result?.stopped ? "stopped" : "ok";
  } catch (error) {
    logger.error("Pipeline run failed:", error);
    return "failed";
  } finally {
    if (activePipelinePromise === pipelinePromise) activePipelinePromise = null;
  }
};

/** Asks the running cycle to stop at its next step (no new folders, posts or LinkedIn actions). */
const requestStop = () => {
  stopRequested = true;
};

/** Stops the run (if any) at its next step, then releases the browsers. */
const stopPipeline = async () => {
  requestStop();

  if (activePipelinePromise) {
    // A film can take an hour: stop the factory's claude processes first, so shutdown is not
    // held hostage by it (and nothing gets posted after a stop was asked for).
    if (config.factory.enabled) {
      try { factoryModule().stop(); } catch (error) { logger.warn(`Could not stop the content factory: ${error?.message ?? error}`); }
    }
    try {
      await activePipelinePromise;
    } catch (error) {
      logger.error("Error waiting for active pipeline during shutdown:", error);
    } finally {
      activePipelinePromise = null;
    }
  }

  try {
    await TwitterService.cleanup();
    logger.info("Twitter service cleaned up");
  } catch (error) {
    logger.error("Error cleaning up Twitter service:", error);
  }
  try {
    await feedEngage.cleanup();
    logger.info("LinkedIn service cleaned up");
  } catch (error) {
    logger.error("Error cleaning up LinkedIn service:", error);
  }
  try {
    await redditComments.cleanup();
  } catch (error) {
    logger.error("Error cleaning up Reddit service:", error);
  }
  try {
    await hnComments.cleanup();
  } catch (error) {
    logger.error("Error cleaning up HN service:", error);
  }
};

// A hard exit (a second Ctrl+C, a forced deadline) skips the finally blocks: never leave the lock.
process.on("exit", releasePipelineLock);

module.exports = {
  runPipeline,
  stopPipeline,
  requestStop,
  releasePipelineLock,
  syncBlogToGit,
  processAllFolders,
  runDataPipeline,
  // tests only: a stopped module stays stopped (the process exits after a stop)
  _resetStop: () => { stopRequested = false; },
  _withSite: withSite, // tests only
};
