const { logger, handleError, sleep } = require("../utils/helpers");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const feedEngage = require("./feedEngage");
const GithubService = require("./github");
const llmService = require("./llm");

const BLOG_PATHS = ["blog/content", "blog/lib/articles-index.json"];
const BLOG_SYNC_SUBJECT = "feat(blog): sync new curated AI resource guides";
// The only branch the blog sync commits to and pushes (the one Vercel deploys).
const BLOG_DEPLOY_BRANCH = process.env.BLOG_DEPLOY_BRANCH || "main";
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const MIN_PUBLISHABLE_CANDIDATES = 8;
const PIPELINE_LOCK_PATH = path.join(process.cwd(), ".pipeline.lock");
// Longer than any step that blocks the event loop (a synchronous ffmpeg encode is capped at 15 min),
// so a live run's lock is never mistaken for a dead one.
const PIPELINE_LOCK_STALE_AFTER_MS = 30 * 60 * 1000;
let lockHeartbeatTimer = null;

// Set by stopCronJob: the running cycle stops at its next step (no new folders, no more posts).
let stopRequested = false;
const stopping = () => stopRequested;

const replaceRuntimeFile = (filePath, content) => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(filePath, { force: true });
    fs.renameSync(tempPath, filePath);
  }
};

// Two processes can race to reclaim the same stale lock; the loser finds it already gone.
const safeUnlink = (filePath) => {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
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
        safeUnlink(PIPELINE_LOCK_PATH);
        return acquirePipelineLock();
      }
      // Our own pid in the lock can only be a leftover (Windows reuses pids after a quick
      // restart): this process never asks for the lock while it holds it.
      if (lock.pid === process.pid) {
        safeUnlink(PIPELINE_LOCK_PATH);
        return acquirePipelineLock();
      }
      // A stale lock from a terminated run must not prevent the next scheduled run.
      process.kill(lock.pid, 0);
      // The PID may have been reused by an unrelated process: a live holder keeps
      // heartbeating, so a stale heartbeat means the lock is dead.
      if (!lockIsFresh(lock)) {
        logger.warn(`Pipeline lock heartbeat is stale (PID ${lock.pid} reused or hung); reclaiming.`);
        safeUnlink(PIPELINE_LOCK_PATH);
        return acquirePipelineLock();
      }
      logger.warn(`Another pipeline process is already running (PID ${lock.pid}); skipping this run.`);
      return false;
    } catch (lockError) {
      if (lockError.code === "ESRCH" || (lockError instanceof SyntaxError && !lockFileIsFresh())) {
        safeUnlink(PIPELINE_LOCK_PATH);
        return acquirePipelineLock();
      }
      if (lockError instanceof SyntaxError && lockFileIsFresh()) {
        logger.warn("Pipeline lock is being updated; skipping this run.");
        return false;
      }
      if (lockError.code === "EPERM") {
        if (!lock || !lockIsFresh(lock)) {
          safeUnlink(PIPELINE_LOCK_PATH);
          return acquirePipelineLock();
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
const run = (command, args, { timeout = 60000, shell = false } = {}) =>
  new Promise((resolve) => {
    const { spawn, spawnSync } = require("child_process");
    let out = "";
    let err = "";
    let timedOut = false;
    let done = false;
    const finish = (r) => { if (!done) { done = true; clearTimeout(timer); resolve(r); } };
    // Git must never wait on a login prompt or a credential-manager window nobody will answer.
    const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
    const child = spawn(command, args, { shell, windowsHide: true, env });
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
 *  - never pushes your own unpushed commits: it waits until you have pushed them;
 *  - builds first and stages after, so a failed build never leaves blog files in your index;
 *  - pulls only when upstream did not touch a file you have uncommitted edits in, so the
 *    autostash can never leave conflict markers in source files;
 *  - recovers from an interrupted rebase or a stale index.lock left by a killed run.
 */
const publishBlog = async () => {
  const fail = (step, result) => {
    const detail = (result.err || result.out || "").trim().split("\n").slice(-3).join(" | ");
    logger.error(`Cycle End: blog sync stopped at "${step}"${result.timedOut ? " (timed out)" : ""}: ${detail}`);
  };
  const lines = (r) => String(r.out || "").split("\n").map((l) => l.trim()).filter(Boolean);
  try {
    // A run killed mid-rebase or mid-commit leaves these behind; nothing else ever clears them.
    const gitDir = path.join(process.cwd(), ".git");
    if (fs.existsSync(path.join(gitDir, "rebase-merge")) || fs.existsSync(path.join(gitDir, "rebase-apply"))) {
      logger.warn("Cycle End: aborting a rebase a previous run left behind.");
      await run("git", ["rebase", "--abort"], { timeout: 30000 });
    }
    const indexLock = path.join(gitDir, "index.lock");
    try { if (Date.now() - fs.statSync(indexLock).mtimeMs > 10 * 60 * 1000) fs.rmSync(indexLock, { force: true }); } catch { /* none */ }

    const branchResult = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 10000 });
    const branch = branchResult.out.trim();
    if (branchResult.status !== 0 || !branch || branch === "HEAD") {
      return logger.error("Cycle End: blog sync skipped: not on a branch (detached HEAD).");
    }
    if (branch !== BLOG_DEPLOY_BRANCH) {
      return logger.warn(`Cycle End: blog sync skipped: the checkout is on "${branch}", not ${BLOG_DEPLOY_BRANCH}; switch back and the next run publishes everything.`);
    }

    const changed = await run("git", ["status", "--porcelain", "--", ...BLOG_PATHS], { timeout: 30000 });
    const hasChanges = changed.status === 0 && lines(changed).length > 0;
    const unpushed = await run("git", ["log", `origin/${branch}..HEAD`, "--format=%s"], { timeout: 30000 });
    const unpushedSubjects = unpushed.status === 0 ? lines(unpushed) : [];
    // Your own commits never ride along with the bot's push: they go when you push them.
    const ownCommits = unpushedSubjects.filter((s) => s !== BLOG_SYNC_SUBJECT);
    if (!hasChanges && !unpushedSubjects.length) return logger.info("Cycle End: no new blog files to publish.");

    if (hasChanges) {
      logger.info("Cycle End: running the blog build before publishing...");
      const build = await run("npm", ["--prefix", "blog", "run", "build"], { timeout: 15 * 60 * 1000, shell: true });
      if (build.status !== 0) return fail("blog build", build);
      logger.info("Cycle End: blog build passed.");

      const added = await run("git", ["add", "--", ...BLOG_PATHS], { timeout: 30000 });
      if (added.status !== 0) return fail("git add", added);
      const commit = await run("git", ["commit", "-m", BLOG_SYNC_SUBJECT, "--", ...BLOG_PATHS], { timeout: 60000 });
      if (commit.status !== 0) {
        await run("git", ["reset", "-q", "--", ...BLOG_PATHS], { timeout: 30000 });
        return fail("git commit", commit);
      }
    }

    if (ownCommits.length) {
      return logger.warn(`Cycle End: blog committed locally but not pushed: ${ownCommits.length} of your own commit(s) are unpushed on ${branch} ("${ownCommits[0]}"). The bot never pushes your work; push it and the blog goes with it.`);
    }

    const fetched = await run("git", ["fetch", "origin", branch], { timeout: 120000 });
    if (fetched.status !== 0) return fail("git fetch", fetched);
    // Upstream changes to a file you are editing would make the autostash conflict: wait instead.
    const dirty = await run("git", ["status", "--porcelain", "--untracked-files=no"], { timeout: 30000 });
    const dirtyFiles = new Set(lines(dirty).map((l) => l.slice(3).replace(/^"|"$/g, "")));
    const incoming = await run("git", ["diff", "--name-only", `HEAD...origin/${branch}`], { timeout: 30000 });
    const clash = lines(incoming).filter((f) => dirtyFiles.has(f));
    if (clash.length) {
      return logger.warn(`Cycle End: blog committed locally but not pushed: origin changed ${clash.length} file(s) you have uncommitted edits in (${clash.slice(0, 3).join(", ")}). Commit or stash them; the next run pushes.`);
    }

    const pulled = await run("git", ["pull", "--rebase", "--autostash", "origin", branch], { timeout: 120000 });
    if (pulled.status !== 0) {
      await run("git", ["rebase", "--abort"], { timeout: 30000 });
      return fail("git pull --rebase", pulled);
    }
    const pushed = await run("git", ["push", "origin", `HEAD:${branch}`], { timeout: 120000 });
    if (pushed.status !== 0) return fail("git push", pushed);
    logger.info(`Cycle End: pushed the blog to origin/${branch} (triggers the Vercel deploy).`);
    return true;
  } catch (error) {
    logger.error(`Cycle End: blog sync failed unexpectedly: ${error.message}`);
  }
  return false;
};
const syncBlogToGit = async () => (await publishBlog()) === true;

// Outages that hit every folder the same way: retrying them only hammers X or the provider.
const RUN_ENDING_CODES = new Set(["LOCAL_LLM_UNAVAILABLE", "LLM_UNAVAILABLE", "X_UNAVAILABLE"]);

const runDataPipeline = async (folder) => {
  let tweets = null;
  for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
    try {
      if (!tweets) {
        logger.info(`Fetching tweets for folder: ${folder.name}...`);
        // Let failures reach the retry loop. Converting a browser/network failure
        // into an empty array makes the pipeline falsely report "no new content".
        // Two tries inside (it reattaches the browser on a session error) times this loop's three.
        const fetched = await TwitterService.fetchTweets({ folder, maxRetries: 2 });
        if (!Array.isArray(fetched)) {
          throw new Error(`X fetch returned an invalid result for folder ${folder.name}`);
        }

        if (fetched.length === 0) {
          logger.info(`No new content found on X for folder: ${folder.name}`);
          return null;
        }

        if (fetched.length < MIN_PUBLISHABLE_CANDIDATES) {
          logger.info(
            `Skipping ${folder.name}: only ${fetched.length}/${MIN_PUBLISHABLE_CANDIDATES} pre-vetted sources were collected; preserving the quality bar.`
          );
          return null;
        }
        // A writer retry reuses these instead of scraping X again.
        tweets = fetched;
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
        if (Array.isArray(error.usedTweets) && error.usedTweets.length) TwitterService.markContentAsPublished(error.usedTweets);
        logger.warn(`${folder.name}: no file this run (${error.message}); ${error.usedTweets?.length || 0} judged source(s) will not be retried.`);
        return null;
      }
      logger.error(`Pipeline error for folder ${folder.name} (attempt ${retryCount + 1}/${MAX_RETRIES}): ${error.message}`, { code: error.code });
      if (RUN_ENDING_CODES.has(error.code)) {
        throw error;
      }
      if (retryCount === MAX_RETRIES - 1) {
        handleError(
          error,
          `Pipeline error for folder type (attempt ${retryCount + 1}/${MAX_RETRIES})`,
          { folder }
        );
        throw error;
      }
      logger.info(`Retrying in ${RETRY_DELAY * (retryCount + 1)}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
    }
  }
};

function getTopicName(queryName) {
  const folder = config.folders.find((f) => f.name === queryName);
  return folder ? folder.name : "AI Scrapped";
}

// Announcement tweets: a few per run, spaced out, in varied words. Eight identical link posts a
// minute apart read as a bot to X and get throttled ("Composer still open").
const TWEETS_PER_RUN = Math.max(0, Number(process.env.TWITTER_POSTS_PER_RUN ?? 3) || 0);
const TWEET_GAP_MS = 20 * 60 * 1000;
const ANNOUNCEMENTS = [
  (topic, url) => `New ${topic} resource added!\n\nMade by @Drix10 via @CosLynxAI\n\nCheck out the latest resource here:\n${url}`,
  (topic, url) => `Fresh ${topic} picks, sorted and summarised.\n\nRead them here:\n${url}`,
  (topic, url) => `Just published: the latest ${topic} roundup.\n\nvia @CosLynxAI\n${url}`,
  (topic, url) => `${topic}: this week's most useful finds in one place.\n\n${url}`,
];

/**
 * Single canonical pipeline runner: initialises services, processes all folders,
 * updates README, runs end-of-run LinkedIn curation, and cleans up temp files.
 */
const processAllFolders = async () => {
  if (!acquirePipelineLock()) return { ran: false };

  try {
    // Re-read the processed-ID store (another instance or a manual edit may have changed it) and
    // start this run's cross-folder dedupe sets.
    TwitterService.beginRun?.();
    llmService.beginRun?.();
    const successfulArticles = [];
    let tweetsThisRun = 0;
    let lastTweetAt = 0;
    let tweetingHalted = false;
    const announce = async (item) => {
      if (!config.social.twitterPost) {
        return logger.info(`Twitter posting disabled (TWITTER_POST=false). Skipping tweet for ${item.queryName}.`);
      }
      if (stopping() || tweetingHalted) return;
      if (tweetsThisRun >= TWEETS_PER_RUN) {
        return logger.info(`Tweet cap reached (${TWEETS_PER_RUN} this run); not announcing ${item.queryName}.`);
      }
      if (Date.now() - lastTweetAt < TWEET_GAP_MS) {
        return logger.info(`Not announcing ${item.queryName}: the last tweet went out under ${TWEET_GAP_MS / 60000} min ago.`);
      }
      const text = ANNOUNCEMENTS[Math.floor(Math.random() * ANNOUNCEMENTS.length)](getTopicName(item.queryName), item.url);
      const posted = await TwitterService.postTweet(text).catch((err) => {
        logger.error(`Failed to post tweet for ${item.queryName}:`, err);
        return false;
      });
      if (posted === false) {
        // X refusing one post usually means it is throttling the account: stop for this run.
        tweetingHalted = true;
        return logger.warn("Tweet failed; no more tweets this run.");
      }
      tweetsThisRun++;
      lastTweetAt = Date.now();
    };
    let localLlmUnavailable = false;
    const folders = config.folders;
    logger.info(`Processing all ${folders.length} folders this run.`);
    // Randomize batch commit size between 1 and 8 on each run
    const nextBatchSize = () => Math.floor(Math.random() * 8) + 1;
    let COMMIT_BATCH_SIZE = nextBatchSize(); // re-rolled after every batch commit
    let pendingBatch = [];
    // Instagram content factory: digest items committed this run become reel/carousel candidates.
    const factoryInbox = [];

    // LinkedIn runs in step with the content, never ahead of it:
    //  - after every article (.md) is written: a few random likes (likeAfterArticle)
    //  - after every batch commit: 1 or 2 comments, then a few connection requests (engageAfterBatch)
    // Targeted finance/AI/founder sources; non-English posts are skipped. Never fatal.
    const likeAfterArticle = async () => {
      if (!config.social.linkedinLike || stopping()) return;
      try {
        const likeResult = await feedEngage.runLikePass({ min: 2, max: 4 });
        logger.info(`Article done: LinkedIn likes ${likeResult.liked}/${likeResult.target}.`);
      } catch (feedErr) {
        logger.error("LinkedIn likes failed (non-fatal):", feedErr.message);
      }
    };
    const engageAfterBatch = async () => {
      if (stopping()) return;
      if (config.social.linkedinFeedReply) {
        try {
          const engageResult = await feedEngage.runFeedEngagement({ max: 1 + Math.floor(Math.random() * 2) });
          logger.info(`Batch done: LinkedIn comments ${engageResult.commented} posted, ${engageResult.skipped} skipped. ${engageResult.reason || ""}`);
        } catch (feedErr) {
          logger.error("LinkedIn comment pass failed (non-fatal):", feedErr.message);
        }
      }
      if (config.social.linkedinConnect && !stopping()) {
        try {
          const conn = await feedEngage.runConnectPass({ min: 3, max: 5 });
          logger.info(`Batch done: LinkedIn connections ${conn.sent}/${conn.target} sent. ${conn.reason || ""}`);
        } catch (connErr) {
          logger.error("LinkedIn connection pass failed (non-fatal):", connErr.message);
        }
      }
    };

    // A batch whose commit failed (a GitHub blip) is retried once at the end of the run.
    const failedBatches = [];
    const flushBatch = async ({ retry = false } = {}) => {
      if (pendingBatch.length === 0) return;
      const batchToCommit = [...pendingBatch];
      pendingBatch = [];
      COMMIT_BATCH_SIZE = nextBatchSize();

      logger.info(
        `Flushing batch of ${batchToCommit.length} folder article(s) to GitHub in 1 consolidated commit...`
      );

      try {
        const results = await GithubService.uploadMarkdownBatch(
          batchToCommit,
          `${config.github.owner}/${config.github.repo}`
        );

        // Only a confirmed GitHub upload consumes the source IDs, and every committed item is marked
        // BEFORE any posting: a kill mid-tweet must never leave committed items unmarked.
        for (const item of results) TwitterService.markContentAsPublished(item.tweets);

        for (const item of results) {
          await announce(item);

          logger.info(`Pipeline succeeded for folder type ${item.queryName}: ${item.url}`);
          if (config.factory.enabled) {
            try {
              factoryInbox.push(...require("../factory/sources").fromDigest(item.content, { topic: item.queryName, url: item.url }));
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

        await engageAfterBatch();
      } catch (batchErr) {
        logger.error(`Batch GitHub commit failed for ${batchToCommit.length} folders${retry ? " (retry)" : "; will retry at the end of the run"}:`, batchErr);
        if (!retry) failedBatches.push(batchToCommit);
      }
    };

    // The X phase is isolated: a session or network failure there must not cost the run its
    // README update, blog sync and factory pass.
    let xReady = true;
    try {
      await TwitterService.init();
    } catch (xErr) {
      xReady = false;
      logger.error(`X session unavailable this run; skipping curation: ${xErr?.message ?? xErr}`);
    }
    let consecutiveFailures = 0;

    for (const folder of xReady ? folders : []) {
      if (stopping()) {
        logger.warn("Stop requested: no more folders this run.");
        break;
      }
      try {
        const prepared = await runDataPipeline(folder);
        consecutiveFailures = 0;
        if (prepared) {
          logger.info(
            `Prepared article for ${prepared.queryName}. Queued in commit batch (${pendingBatch.length + 1}/${COMMIT_BATCH_SIZE}).`
          );
          pendingBatch.push(prepared);
          await likeAfterArticle();
          if (pendingBatch.length >= COMMIT_BATCH_SIZE) {
            await flushBatch();
          }
        } else {
          logger.info(
            `Pipeline completed for folder with no article (no new threads, or generation failed gates - see warnings above).`
          );
        }
      } catch (error) {
        logger.error(`Pipeline iteration failed for folder ${folder.name}:`, error);
        if (error.code === "LOCAL_LLM_UNAVAILABLE") {
          localLlmUnavailable = true;
          logger.warn("Local Ollama service is unavailable. Stopping this run instead of retrying every folder.");
          break;
        }
        if (RUN_ENDING_CODES.has(error.code)) {
          logger.warn(`${error.code}: ending the X phase for this run (${error.message}).`);
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

    // Flush any remaining prepared articles in final batch (also when stopping: they are generated).
    if (pendingBatch.length > 0) {
      logger.info(`Flushing final remaining batch of ${pendingBatch.length} folder article(s)...`);
      await flushBatch();
    }
    for (const batch of failedBatches.splice(0)) {
      logger.info(`Retrying a failed batch of ${batch.length} folder article(s)...`);
      pendingBatch = batch;
      await flushBatch({ retry: true });
    }

    if (stopping()) {
      logger.warn("Stop requested: skipping the README update, blog sync and content factory.");
      return { ran: true, articles: successfulArticles.length, stopped: true };
    }

    await GithubService.updateReadmeWithNewFile(
      config.github.owner,
      config.github.repo
    );

    if (successfulArticles.length > 0) {
      logger.info(`Cycle End: Successfully processed and syndicated ${successfulArticles.length} curated guide(s).`);
    }
    let blogPushed = false;

    // --- End-of-Cycle Batched Synchronization ---
    // Automatically rebuilds the blog index and synchronizes all new articles in ONE single consolidated batch commit
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

    // --- Instagram content factory (FACTORY_ENABLED=true) ---
    // Last, after every commit, the LinkedIn steps and the blog sync: the editor picks this run's
    // one most viral story, researches it, makes the reel and posts within the cap. Never fatal
    // to the content pipeline.
    if (config.factory.enabled && !stopping()) {
      try {
        await require("../factory").runCycle({ extraSources: factoryInbox });
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
          if (blogPushed && !(config.factory.enabled)) await sleep(4 * 60 * 1000);
          const synd = await syndication.processQueue();
          if (synd) logger.info(`Cycle End: DEV.to queue: ${JSON.stringify(synd)}`);
        }
      } catch (syndErr) {
        logger.warn(`Cycle End: DEV.to queue failed (non-fatal): ${syndErr?.message ?? syndErr}`);
      }
    }

    // Cleanup leftover debug screenshots from root
    TwitterService.cleanupScreenshots();
    return { ran: true, articles: successfulArticles.length, xReady };
  } finally {
    // Release the browsers between runs: a driver kept for 20 hours is usually dead by the next one.
    await TwitterService.cleanup().catch(() => {});
    await feedEngage.cleanup().catch(() => {});
    releasePipelineLock();
  }
};

let scheduledJob = null;
let isJobRunning = false;
let activePipelinePromise = null;

// A run takes a few hours, so 20-24h after it ends keeps the cadence at about one run per day.
const MIN_INTERVAL_HOURS = 20;
const MAX_INTERVAL_HOURS = 24;
// The schedule lives on disk, so a restart (a crash, an update, a reboot) neither skips a day nor
// runs a second pipeline the same day; a timer would forget it and a 20 h setTimeout also drifts
// across laptop sleep. A tick checks it every few minutes instead.
const SCHEDULE_PATH = path.join(process.cwd(), ".pipeline-schedule.json");
const TICK_MS = 5 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 90 * 60 * 1000;
const RETRY_AFTER_LOCKED_MS = 30 * 60 * 1000;

const readSchedule = () => {
  try {
    return JSON.parse(fs.readFileSync(SCHEDULE_PATH, "utf8")) || {};
  } catch {
    return {};
  }
};

const writeSchedule = (schedule) => {
  try {
    replaceRuntimeFile(SCHEDULE_PATH, JSON.stringify(schedule, null, 2));
  } catch (error) {
    logger.warn(`Could not save the pipeline schedule: ${error.message}`);
  }
};

const nextGapMs = () =>
  (MIN_INTERVAL_HOURS + Math.random() * (MAX_INTERVAL_HOURS - MIN_INTERVAL_HOURS)) * 60 * 60 * 1000;

const runPipeline = async (reason) => {
  if (isJobRunning) {
    logger.warn("Previous job still running, skipping this execution");
    return;
  }
  isJobRunning = true;
  const startedAt = new Date();
  // Written before the run: a crash or a kill mid-run retries in 90 minutes, not on every restart.
  writeSchedule({ ...readSchedule(), lastStart: startedAt.toISOString(), nextRunAt: new Date(Date.now() + RETRY_AFTER_FAILURE_MS).toISOString() });
  logger.info(`Running pipeline (${reason}) at ${startedAt.toISOString()}`);
  let outcome = "failed";
  const pipelinePromise = processAllFolders();
  activePipelinePromise = pipelinePromise;
  try {
    const result = await pipelinePromise;
    outcome = result?.ran === false ? "locked" : result?.stopped ? "stopped" : "ok";
  } catch (error) {
    logger.error("Pipeline run failed:", error);
  } finally {
    isJobRunning = false;
    if (activePipelinePromise === pipelinePromise) activePipelinePromise = null;
  }
  const delay = outcome === "ok" ? nextGapMs() : outcome === "locked" ? RETRY_AFTER_LOCKED_MS : RETRY_AFTER_FAILURE_MS;
  const nextRunAt = new Date(Date.now() + delay);
  writeSchedule({ lastStart: startedAt.toISOString(), lastEnd: new Date().toISOString(), lastOutcome: outcome, nextRunAt: nextRunAt.toISOString() });
  if (!stopping()) logger.info(`Pipeline ${outcome}. Next run at ${nextRunAt.toISOString()} (in ${(delay / 3600000).toFixed(1)}h).`);
};

const tick = () => {
  if (stopping() || isJobRunning || !scheduledJob) return;
  const due = Date.parse(readSchedule().nextRunAt || "");
  if (Number.isFinite(due) && Date.now() < due) return;
  runPipeline(Number.isFinite(due) ? "scheduled" : "first run").catch((error) => logger.error("Pipeline run failed:", error));
};

/** Starts the scheduler. runNow forces a run on start; otherwise it runs when the saved schedule is due. */
const initCronJob = ({ runNow = false } = {}) => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }
    const timer = setInterval(tick, TICK_MS);
    scheduledJob = { timer, stop: () => clearInterval(timer) };

    const due = Date.parse(readSchedule().nextRunAt || "");
    if (runNow || !Number.isFinite(due) || Date.now() >= due) {
      runPipeline(runNow ? "start (--now)" : "start").catch((error) => logger.error("Initial pipeline run failed:", error));
    } else {
      logger.info(`Next pipeline run at ${new Date(due).toISOString()} (in ${((due - Date.now()) / 3600000).toFixed(1)}h). Start with --now to run immediately.`);
    }
    return scheduledJob;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

/** Asks the running cycle to stop at its next step (no new folders, posts or LinkedIn actions). */
const requestStop = () => {
  stopRequested = true;
};

const stopCronJob = async () => {
  requestStop();
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info("Cron job stopped");
  } else {
    logger.warn("No active cron job to stop");
  }

  if (activePipelinePromise) {
    // A film can take an hour: stop the factory's claude processes first, so shutdown is not
    // held hostage by it (and nothing gets posted after a stop was asked for).
    if (config.factory.enabled) {
      try { require("../factory").stop(); } catch (error) { logger.warn(`Could not stop the content factory: ${error?.message ?? error}`); }
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
    llmService.cleanup();
    logger.info("Local LLM service cleaned up");
  } catch (error) {
    logger.error("Error cleaning up local LLM service:", error);
  }
};

// A hard exit (a second Ctrl+C, a forced deadline) skips the finally blocks: never leave the lock.
process.on("exit", releasePipelineLock);

module.exports = {
  runDataPipeline,
  initCronJob,
  stopCronJob,
  requestStop,
  releasePipelineLock,
  syncBlogToGit,
  processAllFolders,
};
