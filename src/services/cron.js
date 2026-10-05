const { logger, handleError, sleep } = require("../utils/helpers");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const feedEngage = require("./feedEngage");
const GithubService = require("./github");
const llmService = require("./llm");
const cron = require("node-cron");

const BLOG_PATHS = ["blog/content", "blog/lib/articles-index.json"];
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const MIN_PUBLISHABLE_CANDIDATES = 6;
const PIPELINE_LOCK_PATH = path.join(process.cwd(), ".pipeline.lock");
const PIPELINE_STATE_PATH = path.join(process.cwd(), ".pipeline-state.json");
const PIPELINE_LOCK_STALE_AFTER_MS = 2 * 60 * 1000;
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
        fs.unlinkSync(PIPELINE_LOCK_PATH);
        return acquirePipelineLock();
      }
      // A stale lock from a terminated run must not prevent the next scheduled run.
      process.kill(lock.pid, 0);
      logger.warn(`Another pipeline process is already running (PID ${lock.pid}); skipping this run.`);
      return false;
    } catch (lockError) {
      if (lockError.code === "ESRCH" || (lockError instanceof SyntaxError && !lockFileIsFresh())) {
        fs.unlinkSync(PIPELINE_LOCK_PATH);
        return acquirePipelineLock();
      }
      if (lockError instanceof SyntaxError && lockFileIsFresh()) {
        logger.warn("Pipeline lock is being updated; skipping this run.");
        return false;
      }
      if (lockError.code === "EPERM") {
        if (!lock || !lockIsFresh(lock)) {
          fs.unlinkSync(PIPELINE_LOCK_PATH);
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
    if (lock.pid === process.pid) fs.unlinkSync(PIPELINE_LOCK_PATH);
  } catch (error) {
    logger.warn(`Could not release pipeline lock: ${error.message}`);
  }
};

const getFoldersForRun = () => {
  const allFolders = config.folders;
  logger.info(`Processing all ${allFolders.length} folders this run.`);
  return {
    folders: allFolders,
    nextFolderIndex: 0,
    batchSize: allFolders.length,
    totalFolders: allFolders.length,
  };
};

const savePipelineState = (nextFolderIndex, totalFolders) => {
  const safeIndex = ((nextFolderIndex % totalFolders) + totalFolders) % totalFolders;
  const tempPath = `${PIPELINE_STATE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ nextFolderIndex: safeIndex }), "utf8");
  try {
    fs.renameSync(tempPath, PIPELINE_STATE_PATH);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(PIPELINE_STATE_PATH, { force: true });
    fs.renameSync(tempPath, PIPELINE_STATE_PATH);
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
    const rotation = getFoldersForRun();
    // Randomize batch commit size between 1 and 8 on each run
    const COMMIT_BATCH_SIZE = Math.floor(Math.random() * 8) + 1;
    let pendingBatch = [];

    const flushBatch = async () => {
      if (pendingBatch.length === 0) return;
      const batchToCommit = [...pendingBatch];
      pendingBatch = [];

      logger.info(
        `Flushing batch of ${batchToCommit.length} folder article(s) to GitHub in 1 consolidated commit (batch size: ${COMMIT_BATCH_SIZE})...`
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

          // (Likes run per prepared file; comments stay disabled.)
          logger.info(`Pipeline succeeded for folder type ${item.queryName}: ${item.url}`);
          successfulArticles.push({
            title: item.queryName,
            githubUrl: item.url,
            fullContent: item.content
          });
        }

        // (Likes run per prepared file above; comments stay disabled.)
      } catch (batchErr) {
        logger.error(`Batch GitHub commit failed for ${batchToCommit.length} folders:`, batchErr);
      }
    };

    for (let folderOffset = 0; folderOffset < rotation.folders.length; folderOffset++) {
      const folder = rotation.folders[folderOffset];
      let advanceRotation = true;
      try {
        const prepared = await runDataPipeline(folder);
        if (prepared) {
          logger.info(
            `Prepared article for ${prepared.queryName}. Queued in commit batch (${pendingBatch.length + 1}/${COMMIT_BATCH_SIZE}).`
          );
          pendingBatch.push(prepared);
          // Like pass per prepared .md file (not per batch commit): 3-9 random
          // likes across Top + Recent. No drafting, no commenting, no LLM spend.
          if (config.social.linkedinLike) {
            try {
              const likeResult = await feedEngage.runLikePass({ min: 3, max: 9 });
              logger.info(`LinkedIn likes after ${prepared.queryName}: ${likeResult.liked}/${likeResult.picked} liked (target ${likeResult.target}).`);
            } catch (feedErr) {
              logger.error("LinkedIn likes failed (non-fatal):", feedErr.message);
            }
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
        logger.error(`Pipeline iteration failed for folder ${folder.name}:`, error);
        advanceRotation = false;
        if (error.code === "LOCAL_LLM_UNAVAILABLE") {
          localLlmUnavailable = true;
          logger.warn("Local Ollama service is unavailable. Stopping this run instead of retrying every folder.");
          break;
        }
        // Continue to next folder despite error
      }

      if (advanceRotation) {
        savePipelineState(
          rotation.nextFolderIndex + folderOffset + 1,
          rotation.totalFolders,
        );
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

    // Feed engagement: comment pass after each successful pipeline run.
    if (config.social.linkedinFeedReply && successfulArticles.length > 0) {
      try {
        logger.info("Cycle End: Running LinkedIn feed comment engagement pass...");
        const engageResult = await feedEngage.runFeedEngagement({ max: 2 });
        logger.info(`LinkedIn feed engagement: ${engageResult.commented} commented, ${engageResult.liked} liked, ${engageResult.skipped} skipped. ${engageResult.reason || ""}`);
      } catch (feedErr) {
        logger.error("LinkedIn feed engagement failed (non-fatal):", feedErr.message);
      }
    }

    // --- End-of-Cycle Batched Synchronization ---
    // Automatically rebuilds the blog index and synchronizes all new articles in ONE single consolidated batch commit
    try {
      const { rebuildBlogIndex } = require("../utils/helpers");
      if (typeof rebuildBlogIndex === "function") {
        rebuildBlogIndex();
        logger.info("Cycle End: Rebuilt local Knowledge Hub search index.");
      }

      // Automatically git commit & push newly synced articles ONLY if automated build verification passes
      if (successfulArticles.length > 0) {
        try {
          const { execSync, spawnSync } = require("child_process");
          logger.info("Cycle End: Running automated build verification before git push...");
          execSync("npm --prefix blog run build", {
            stdio: "pipe",
            timeout: 180000
          });
          logger.info("Cycle End: Automated build verification passed (100% clean). Proceeding to push...");

          spawnSync("git", ["add", "--", ...BLOG_PATHS], { stdio: "ignore", timeout: 15000 });
          // Only staged blog files count: unrelated working-tree edits must not trigger an empty commit.
          const hasChanges = spawnSync("git", ["diff", "--cached", "--quiet", "--", ...BLOG_PATHS], { timeout: 10000 }).status === 1;
          if (hasChanges) {
            const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf8", timeout: 5000 }).trim() || "main";
            // Commit only the blog paths so unrelated local edits never ride along.
            execSync(`git commit -m "feat(blog): sync new curated AI resource guides" -- ${BLOG_PATHS.join(" ")} && git push origin ${currentBranch}`, {
              stdio: "ignore",
              timeout: 30000
            });
            logger.info("Cycle End: Pushed updated Knowledge Hub articles to origin main (Triggered automated Vercel deploy).");
          } else {
            logger.info("Cycle End: Working tree clean, no new blog files to commit.");
          }
        } catch (gitErr) {
          logger.warn(`Cycle End: Git sync status: ${gitErr.message}`);
        }
      }
    } catch (indexErr) {
      logger.warn("Cycle End: Index rebuild skipped:", indexErr.message);
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

/**
 * Schedules a single cron job with a random interval (1–16 hours).
 * Replaces (stops) the previous task each time it is called, so tasks never accumulate.
 * The run callback calls it again after every execution to re-roll the interval.
 */
const scheduleRandomJob = () => {
  const RandNum = Math.floor(Math.random() * 16) + 1;
  const schedule = `0 */${RandNum} * * *`;

  if (!cron.validate(schedule)) {
    throw new Error(`Invalid cron schedule: ${schedule}`);
  }

  logger.info(`Scheduling job to run every ${RandNum} hours`);

  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
  }

  scheduledJob = cron.schedule(
    schedule,
    async () => {
      // Prevent concurrent runs
      if (isJobRunning) {
        logger.warn("Previous job still running, skipping this execution");
        return;
      }

      isJobRunning = true;
      const timestamp = new Date().toISOString();
      logger.info(`Running scheduled pipeline at ${timestamp}`);

      const scheduledPipelinePromise = processAllFolders();
      activePipelinePromise = scheduledPipelinePromise;
      try {
        await scheduledPipelinePromise;
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      } finally {
        isJobRunning = false;
        if (activePipelinePromise === scheduledPipelinePromise) activePipelinePromise = null;
        // Re-roll the 1-16h interval after every run instead of freezing the first
        // roll for the process lifetime. Deferred so the task is not stopped from
        // inside its own callback; scheduleRandomJob stops the old task first.
        if (scheduledJob) setImmediate(() => { try { scheduleRandomJob(); } catch (e) { logger.error("Failed to reschedule pipeline:", e); } });
      }
    },
    { timezone: "UTC" }
  );

  logger.info(`Cron job initialized with schedule: ${schedule}`);
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
};
