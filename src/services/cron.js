const { logger, handleError, sleep } = require("../utils/helpers");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const linkedinService = require("./linkedin");
const LinkedInService = new linkedinService();
const GithubService = require("./github");
const llmService = require("./llm");
const cron = require("node-cron");

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
      // LinkedIn scraping disabled at user request
      const linkedinPosts = [];

      logger.info(`Fetching tweets for folder: ${folder.name}...`);
      // Let failures reach the retry loop. Converting a browser/network failure
      // into an empty array makes the pipeline falsely report "no new content".
      const tweets = await TwitterService.fetchTweets({ folder });
       if (!Array.isArray(tweets)) {
         throw new Error(`X fetch returned an invalid result for folder ${folder.name}`);
       }

      if (tweets.length === 0 && linkedinPosts.length === 0) {
        logger.info(`No new content found on X for folder: ${folder.name}`);
        return null;
      }

      const sourceCount = tweets.length + linkedinPosts.length;
      if (sourceCount < MIN_PUBLISHABLE_CANDIDATES) {
        logger.info(
          `Skipping ${folder.name}: only ${sourceCount}/${MIN_PUBLISHABLE_CANDIDATES} pre-vetted sources were collected; preserving the quality bar.`
        );
        return null;
      }

      const markdownContent = await llmService.generateMarkdownFromCombined(
        tweets,
        linkedinPosts,
        2,
        false,
        [],
        folder?.name
      );
      const expectedArticleCount = llmService.normalizeCollectedThreads(tweets).length + linkedinPosts.filter(Boolean).length;
      llmService.assertPublishableMarkdown(markdownContent, expectedArticleCount);

      return {
        folder,
        queryName: folder.name,
        tweets,
        linkedinPosts,
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

const runEndofRunCuration = async (successfulArticles) => {
  if (successfulArticles.length > 0) {
    try {
      logger.info(`Starting LinkedIn Agentic Curation Flow for ${successfulArticles.length} raw files (flattening sub-articles)...`);
      const flattenedArticles = llmService.splitArticlesIntoSubArticles(successfulArticles);
      let selectedIndices = [0];
      try {
        selectedIndices = await llmService.selectBestArticlesForLinkedIn(flattenedArticles);
      } catch (selectErr) {
        logger.warn("LinkedIn Curation: LLM article selection failed, safely falling back to top article:", selectErr.message);
        selectedIndices = [0];
      }
      logger.info(`LinkedIn Curation: Selected article indices: ${JSON.stringify(selectedIndices)}`);

      const uniqueIndices = [...new Set(selectedIndices)];
      const selectedArticles = uniqueIndices
        .map(idx => flattenedArticles[idx])
        .filter(art => !!art);

      if (selectedArticles.length === 0) {
        logger.warn("LinkedIn Curation: No articles were selected by the local LLM. Defaulting to the first available article.");
        selectedArticles.push(flattenedArticles[0]);
      }

      if (selectedArticles.length > 0) {
        let slideImagePath = null;
        try {
          logger.info("LinkedIn Curation: Initializing LinkedIn service...");
          await LinkedInService.init();
        } catch (initErr) {
          logger.error("LinkedIn Curation: Failed to initialize LinkedIn service:", initErr);
          return;
        }

        try {
          const maxGenerationAttempts = 2;
          let megaPostData = null;
          let validation = null;
          let validationFeedback = [];

          for (let attempt = 1; attempt <= maxGenerationAttempts; attempt++) {
            logger.info(`LinkedIn Curation: Generating mega post draft (attempt ${attempt}/${maxGenerationAttempts})...`);
            try {
              megaPostData = await llmService.generateLinkedInMasterPost(selectedArticles, 3, validationFeedback);
            } catch (generationError) {
              if (generationError.code !== "LOCAL_LLM_QUALITY_REJECTED" || attempt === maxGenerationAttempts) {
                throw generationError;
              }
              validationFeedback = [generationError.message];
              logger.warn(`LinkedIn Curation: Draft rejected; retrying with feedback: ${generationError.message}`);
              continue;
            }
            const githubUrl = selectedArticles[0].githubUrl || "";
            const sourceBulletCount = llmService.countSourceBullets(selectedArticles[0].fullContent || "");

            // Prefer the validation that ran inside generateLinkedInMasterPost (with hook-filtered manual points).
            const internalValidation = megaPostData && megaPostData.isValid !== undefined;
            validation = internalValidation
              ? {
                  isValid: megaPostData.isValid,
                  qualityScore: megaPostData.qualityScore,
                  errors: megaPostData.validationErrors || []
                }
              : llmService.validatePostText(megaPostData, githubUrl, sourceBulletCount);

            if (validation.isValid) {
              logger.info(`LinkedIn Curation: Mega post passed quality validation (score: ${validation.qualityScore}/100)`);
              break;
            }

            logger.warn(`LinkedIn Curation: Mega post failed quality validation (score: ${validation.qualityScore}/100):`);
            validation.errors.forEach(err => logger.warn(`  - ${err}`));

            if (attempt === maxGenerationAttempts) {
              logger.warn("LinkedIn Curation: Aborting publish due to repeated quality validation failures.");
              return;
            }

            validationFeedback = validation.errors;
            logger.info("LinkedIn Curation: Retrying mega post generation with validation feedback...");
          }

          try {
            slideImagePath = await LinkedInService.generateSlideImage(
              megaPostData.title,
              megaPostData.slidePoints,
              megaPostData.slideTagline,
              "github.com/Drix10/ai-resources",
              {
                structureName: megaPostData.chosenStructure,
                diagramSteps: megaPostData.diagramSteps,
                coreInsight: megaPostData.coreInsight,
                category: megaPostData.category
              }
            );
          } catch (imageErr) {
            logger.error("LinkedIn Curation: Failed to generate slide image, continuing without image:", imageErr);
            slideImagePath = null;
          }

          if (megaPostData.postText) {
            logger.info("LinkedIn Curation: Posting curated update to LinkedIn...");
            const postSuccess = await LinkedInService.postToLinkedIn(megaPostData.postText, slideImagePath, megaPostData.commentText).catch(err => {
              logger.error("Failed to post mega post to LinkedIn:", err);
              return false;
            });

            if (postSuccess) {
              logger.info("LinkedIn Curation: Post submitted successfully.");
              const recentTopic = megaPostData.sourceTitle || selectedArticles[0].title;
              llmService.saveRecentTopic(recentTopic);
            } else {
              logger.warn("LinkedIn Curation: Post submission returned failure status.");
            }
          }
        } catch (postErr) {
          logger.error("LinkedIn Curation: Post generation or submission failed:", postErr);
        } finally {
          LinkedInService.cleanupDebugScreenshots();
          if (slideImagePath && typeof slideImagePath === "string") {
            const tempDir = path.join(process.cwd(), "temp");
            const normalizedPath = path.resolve(slideImagePath).replace(/\\/g, "/");
            const normalizedTemp = path.resolve(tempDir).replace(/\\/g, "/");
            const isTemporary = normalizedPath === normalizedTemp || normalizedPath.startsWith(`${normalizedTemp}/`);
            if (isTemporary) {
              try {
                if (fs.existsSync(slideImagePath)) fs.unlinkSync(slideImagePath);
              } catch (e) { }
            }
          }
        }
      } else {
        logger.warn("LinkedIn Curation: No valid articles matched the selected indices.");
      }
    } catch (curationErr) {
      logger.error("LinkedIn Curation: Curation pipeline failed:", curationErr);
    }
  } else {
    logger.info("LinkedIn Curation: No successful articles generated, skipping curation.");
  }
};

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
    const COMMIT_BATCH_SIZE = config.github.batchCommitSize || 5;
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
          const tweetText = `New ${getTopicName(
            item.queryName
          )} resource added!\n\nMade by @Drix10 via @CosLynxAI\n\nCheck out the latest resource here:\n${item.url}`;
          await TwitterService.postTweet(tweetText).catch(err => {
            logger.error(`Failed to post tweet for ${item.queryName}:`, err);
          });
          await sleep(2000);

          logger.info(`Pipeline succeeded for folder type ${item.queryName}: ${item.url}`);
          successfulArticles.push({
            title: item.queryName,
            githubUrl: item.url,
            fullContent: item.content
          });
        }
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
          if (pendingBatch.length >= COMMIT_BATCH_SIZE) {
            await flushBatch();
          }
        } else {
          logger.info(
            `Pipeline completed for folder, but no new threads/posts were found.`
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

    if (!localLlmUnavailable && config.social.linkedinPost) {
      await runEndofRunCuration(successfulArticles);
    } else if (!config.social.linkedinPost) {
      logger.info("LinkedIn posting is disabled (set LINKEDIN_POST=true to enable it). Skipping curation.");
    }

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

      // Automatically git commit & push newly synced articles so Vercel deploys the updated Knowledge Hub
      if (successfulArticles.length > 0) {
        try {
          const { execSync } = require("child_process");
          execSync('git add blog/content blog/lib/articles-index.json && git commit -m "feat(blog): sync new curated AI resource guides" && git push origin main', {
            stdio: "ignore",
            timeout: 30000
          });
          logger.info("Cycle End: Pushed updated Knowledge Hub articles to origin main (Triggered automated Vercel deploy).");
        } catch (gitErr) {
          logger.warn(`Cycle End: Automated git push skipped: ${gitErr.message}`);
        }
      }
    } catch (indexErr) {
      logger.warn("Cycle End: Index rebuild skipped:", indexErr.message);
    }

    // Cleanup leftover debug screenshots from root
    TwitterService.cleanupScreenshots();
    LinkedInService.cleanupDebugScreenshots();
    try {
      if (fs.existsSync("linkedin-post-failed.png")) {
        fs.unlinkSync("linkedin-post-failed.png");
      }
    } catch (e) { }
  } finally {
    releasePipelineLock();
  }
};

let scheduledJob = null;
let isJobRunning = false;
let activePipelinePromise = null;

/**
 * Schedules a single cron job with a random interval (1–16 hours).
 * NOTE: Does NOT recursively reschedule itself — reschedule is done once on init only.
 * This prevents cron instance accumulation over time.
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
      }
    },
    {
      scheduled: true,
      timezone: "UTC",
      runOnInit: false,
    }
  );

  logger.info(`Cron job initialized with schedule: ${schedule}`);
};

const initCronJob = () => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }

    runInitialPipeline();
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
    await LinkedInService.cleanup();
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
