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
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const MIN_PUBLISHABLE_CANDIDATES = 8;
const PIPELINE_LOCK_PATH = path.join(process.cwd(), ".pipeline.lock");
const PIPELINE_LOCK_STALE_AFTER_MS = 10 * 60 * 1000;
let lockHeartbeatTimer = null;

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
    const { spawn } = require("child_process");
    let out = "";
    let err = "";
    let timedOut = false;
    const child = spawn(command, args, { shell, windowsHide: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeout);
    child.stdout.on("data", (d) => { out = (out + d).slice(-4000); });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ status: -1, out, err: err || e.message, timedOut });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status: timedOut ? -1 : status, out, err, timedOut });
    });
  });

// Publishes blog/content and the search index to the repo that Vercel deploys. The pipeline's own
// GitHub API commits advance origin first, so a plain push would be rejected as non-fast-forward:
// rebase onto origin before pushing, and say exactly which step failed.
const syncBlogToGit = async () => {
  const fail = (step, result) => {
    const detail = (result.err || result.out || "").trim().split("\n").slice(-3).join(" | ");
    logger.error(`Cycle End: blog sync stopped at "${step}"${result.timedOut ? " (timed out)" : ""}: ${detail}`);
  };
  try {
    const added = await run("git", ["add", "--", ...BLOG_PATHS], { timeout: 30000 });
    if (added.status !== 0) return fail("git add", added);

    const branchResult = await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { timeout: 10000 });
    const branch = branchResult.out.trim();
    if (branchResult.status !== 0 || !branch || branch === "HEAD") {
      return logger.error("Cycle End: blog sync skipped: not on a branch (detached HEAD).");
    }

    // Staged blog files only: unrelated working-tree edits must never trigger or ride along.
    const hasStaged = (await run("git", ["diff", "--cached", "--quiet", "--", ...BLOG_PATHS], { timeout: 30000 })).status === 1;
    const unpushed = await run("git", ["log", `origin/${branch}..HEAD`, "--oneline", "--", ...BLOG_PATHS], { timeout: 30000 });
    const hasUnpushed = unpushed.status === 0 && unpushed.out.trim().length > 0; // a previous cycle's push that failed
    if (!hasStaged && !hasUnpushed) return logger.info("Cycle End: no new blog files to publish.");

    if (hasStaged) {
      logger.info("Cycle End: running the blog build before publishing...");
      const build = await run("npm", ["--prefix", "blog", "run", "build"], { timeout: 15 * 60 * 1000, shell: true });
      if (build.status !== 0) return fail("blog build", build);
      logger.info("Cycle End: blog build passed.");

      const commit = await run("git", ["commit", "-m", "feat(blog): sync new curated AI resource guides", "--", ...BLOG_PATHS], { timeout: 60000 });
      if (commit.status !== 0) return fail("git commit", commit);
    }

    const pulled = await run("git", ["pull", "--rebase", "--autostash", "origin", branch], { timeout: 120000 });
    if (pulled.status !== 0) {
      await run("git", ["rebase", "--abort"], { timeout: 30000 });
      return fail("git pull --rebase", pulled);
    }
    const pushed = await run("git", ["push", "origin", branch], { timeout: 120000 });
    if (pushed.status !== 0) return fail("git push", pushed);
    logger.info(`Cycle End: pushed the blog to origin/${branch} (triggers the Vercel deploy).`);
  } catch (error) {
    logger.error(`Cycle End: blog sync failed unexpectedly: ${error.message}`);
  }
};

const runDataPipeline = async (folder) => {
  for (let retryCount = 0; retryCount < MAX_RETRIES; retryCount++) {
    try {
      logger.info(`Fetching tweets for folder: ${folder.name}...`);
      // Let failures reach the retry loop. Converting a browser/network failure
      // into an empty array makes the pipeline falsely report "no new content".
      const tweets = await TwitterService.fetchTweets({ folder });
       if (!Array.isArray(tweets)) {
         throw new Error(`X fetch returned an invalid result for folder ${folder.name}`);
       }

      if (tweets.length === 0) {
        logger.info(`No new content found on X for folder: ${folder.name}`);
        return null;
      }

      const sourceCount = tweets.length;
      if (sourceCount < MIN_PUBLISHABLE_CANDIDATES) {
        logger.info(
          `Skipping ${folder.name}: only ${sourceCount}/${MIN_PUBLISHABLE_CANDIDATES} pre-vetted sources were collected; preserving the quality bar.`
        );
        return null;
      }

      const { markdown: markdownContent } = await llmService.generateMarkdownBatched(tweets, folder?.name);

      return {
        folder,
        queryName: folder.name,
        tweets,
        markdownContent,
        fileBuffer: Buffer.from(markdownContent)
      };
    } catch (error) {
      logger.error(`Pipeline error for folder ${folder.name} (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
      if (error.code === "LOCAL_LLM_UNAVAILABLE") {
        throw error;
      }
      if (error.code === "MARKDOWN_QUALITY_REJECTED") {
        logger.warn(`Generated content for ${folder.name} still failed the publication standard after feedback-guided local LLM retries; skipping it safely.`);
        return null;
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

/**
 * Single canonical pipeline runner: initialises services, processes all folders,
 * updates README, runs end-of-run LinkedIn curation, and cleans up temp files.
 */
const processAllFolders = async () => {
  if (!acquirePipelineLock()) return;

  try {
    await TwitterService.init();

    const successfulArticles = [];
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
      if (!config.social.linkedinLike) return;
      try {
        const likeResult = await feedEngage.runLikePass({ min: 2, max: 4 });
        logger.info(`Article done: LinkedIn likes ${likeResult.liked}/${likeResult.target}.`);
      } catch (feedErr) {
        logger.error("LinkedIn likes failed (non-fatal):", feedErr.message);
      }
    };
    const engageAfterBatch = async () => {
      if (config.social.linkedinFeedReply) {
        try {
          const engageResult = await feedEngage.runFeedEngagement({ max: 1 + Math.floor(Math.random() * 2) });
          logger.info(`Batch done: LinkedIn comments ${engageResult.commented} posted, ${engageResult.skipped} skipped. ${engageResult.reason || ""}`);
        } catch (feedErr) {
          logger.error("LinkedIn comment pass failed (non-fatal):", feedErr.message);
        }
      }
      if (config.social.linkedinConnect) {
        try {
          const conn = await feedEngage.runConnectPass({ min: 3, max: 5 });
          logger.info(`Batch done: LinkedIn connections ${conn.sent}/${conn.target} sent. ${conn.reason || ""}`);
        } catch (connErr) {
          logger.error("LinkedIn connection pass failed (non-fatal):", connErr.message);
        }
      }
    };

    const flushBatch = async () => {
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

        for (const item of results) {
          // Only a confirmed GitHub upload consumes the source IDs.
          TwitterService.markContentAsPublished(item.tweets);

          // Post to Twitter/X
          if (config.social.twitterPost) {
            const tweetText = `New ${getTopicName(
              item.queryName
            )} resource added!\n\nMade by @Drix10 via @CosLynxAI\n\nCheck out the latest resource here:\n${item.url}`;
            await TwitterService.postTweet(tweetText).catch(err => {
              logger.error(`Failed to post tweet for ${item.queryName}:`, err);
            });
            await sleep(2000);
          } else {
            logger.info(`Twitter posting disabled (TWITTER_POST=false). Skipping tweet for ${item.queryName}.`);
          }

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
        logger.error(`Batch GitHub commit failed for ${batchToCommit.length} folders:`, batchErr);
      }
    };

    for (const folder of folders) {
      try {
        const prepared = await runDataPipeline(folder);
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
        // Continue to next folder despite error
      }
    }

    // Flush any remaining prepared articles in final batch
    if (pendingBatch.length > 0) {
      logger.info(`Flushing final remaining batch of ${pendingBatch.length} folder article(s)...`);
      await flushBatch();
    }

    await GithubService.updateReadmeWithNewFile(
      config.github.owner,
      config.github.repo
    );

    if (successfulArticles.length > 0) {
      logger.info(`Cycle End: Successfully processed and syndicated ${successfulArticles.length} curated guide(s).`);
    }

    // --- End-of-Cycle Batched Synchronization ---
    // Automatically rebuilds the blog index and synchronizes all new articles in ONE single consolidated batch commit
    try {
      const { rebuildBlogIndex } = require("../utils/helpers");
      if (typeof rebuildBlogIndex === "function") {
        rebuildBlogIndex();
        logger.info("Cycle End: Rebuilt local Knowledge Hub search index.");
      }

      // Commit and push the blog content, but only after the blog still builds with it.
      await syncBlogToGit();
    } catch (indexErr) {
      logger.warn("Cycle End: Index rebuild skipped:", indexErr.message);
    }

    // --- Instagram content factory (FACTORY_ENABLED=true) ---
    // Storyboard -> plates -> render -> QA -> queue -> post, after the blog is synced so the
    // caption can point at live articles. Never fatal to the content pipeline.
    if (config.factory.enabled) {
      try {
        await require("../factory").runCycle({ extraSources: factoryInbox });
      } catch (factoryErr) {
        logger.error("Content factory pass failed (non-fatal):", factoryErr.message);
      }
    }

    // Cleanup leftover debug screenshots from root
    TwitterService.cleanupScreenshots();
    feedEngage.cleanup().catch(() => {});
  } finally {
    releasePipelineLock();
  }
};

let scheduledJob = null;
let isJobRunning = false;
let activePipelinePromise = null;

// A run takes a few hours, so 20-24h after it ends keeps the cadence at about one run per day.
const MIN_INTERVAL_HOURS = 20;
const MAX_INTERVAL_HOURS = 24;

/**
 * Schedules the next run 20-24 hours from now (re-rolled after every run).
 * A cron expression like "0 *\/N * * *" does not mean "every N hours": it
 * fires on clock hours divisible by N, so N=13..16 only ran at 00:00 and N:00
 * UTC. A plain timer gives the intended random gap.
 */
const scheduleRandomJob = () => {
  const hours = MIN_INTERVAL_HOURS + Math.floor(Math.random() * (MAX_INTERVAL_HOURS - MIN_INTERVAL_HOURS + 1));
  const delayMs = hours * 60 * 60 * 1000;

  if (scheduledJob) scheduledJob.stop();

  const timer = setTimeout(async () => {
    if (scheduledJob?.timer !== timer) return; // superseded or stopped
    if (isJobRunning) {
      logger.warn("Previous job still running, skipping this execution");
    } else {
      isJobRunning = true;
      logger.info(`Running scheduled pipeline at ${new Date().toISOString()}`);
      const scheduledPipelinePromise = processAllFolders();
      activePipelinePromise = scheduledPipelinePromise;
      try {
        await scheduledPipelinePromise;
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      } finally {
        isJobRunning = false;
        if (activePipelinePromise === scheduledPipelinePromise) activePipelinePromise = null;
      }
    }
    // Re-roll only if nobody stopped the scheduler while the run was in flight.
    if (scheduledJob?.timer === timer) {
      try { scheduleRandomJob(); } catch (e) { logger.error("Failed to reschedule pipeline:", e); }
    }
  }, delayMs);

  scheduledJob = {
    timer,
    nextRunAt: new Date(Date.now() + delayMs),
    stop: () => clearTimeout(timer),
  };
  logger.info(`Next pipeline run in ${hours}h (at ${scheduledJob.nextRunAt.toISOString()}).`);
};

const initCronJob = () => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }

    runInitialPipeline().catch(err => logger.error("Initial pipeline run failed:", err.message));
    scheduleRandomJob();

    return scheduledJob;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

const stopCronJob = async () => {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info("Cron job stopped");
  } else {
    logger.warn("No active cron job to stop");
  }

  if (activePipelinePromise) {
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

/**
 * Runs the pipeline immediately on startup.
 * Delegates entirely to processAllFolders() to avoid code duplication.
 */
const runInitialPipeline = async () => {
  if (isJobRunning) {
    logger.warn("Job already running, skipping initial pipeline");
    return;
  }

  isJobRunning = true;
  logger.info("Running initial pipeline execution...");
  const pipelinePromise = processAllFolders();
  activePipelinePromise = pipelinePromise;
  try {
    await pipelinePromise;
  } catch (error) {
    logger.error("Initial pipeline execution failed:", error);
  } finally {
    isJobRunning = false;
    if (activePipelinePromise === pipelinePromise) activePipelinePromise = null;
  }
};

module.exports = {
  runDataPipeline,
  initCronJob,
  stopCronJob,
  syncBlogToGit,
};
