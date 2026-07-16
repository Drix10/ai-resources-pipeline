const { logger, handleError, sleep } = require("../utils/helpers");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const linkedinService = require("./linkedin");
const LinkedInService = new linkedinService();
const GithubService = require("./github");
const geminiService = require("./gemini");
const cron = require("node-cron");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const runDataPipeline = async (folder) => {
  for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
    try {
      // LinkedIn scraping disabled at user request
      const linkedinPosts = [];

      logger.info(`Fetching tweets for folder: ${folder.name}...`);
      const tweets = await TwitterService.fetchTweets({ folder }).catch(err => {
        logger.error(`Error fetching tweets for ${folder.name}:`, err);
        return [];
      }) || [];

      if (tweets.length === 0 && linkedinPosts.length === 0) {
        logger.info(`No new content found on X for folder: ${folder.name}`);
        return null;
      }

      const githubResult = await GithubService.createMarkdownFileFromCombined(
        tweets,
        linkedinPosts,
        folder.name,
        folder
      );

      if (!githubResult?.success) {
        throw new Error("Failed to create and upload combined markdown file");
      }

      // Post to Twitter/X
      const tweetText = `New ${getTopicName(
        folder.name
      )} resource added!\n\nMade by @Drix10 via @CosLynxAI\n\nCheck out the latest resource here:\n${githubResult.url
        }`;
      await TwitterService.postTweet(tweetText).catch(err => {
        logger.error("Failed to post tweet:", err);
      });

      return {
        queryName: folder.name,
        githubUrl: githubResult.url,
        markdownContent: githubResult.content
      };
    } catch (error) {
      logger.error(`Pipeline error for folder ${folder.name} (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error);
      if (retryCount === MAX_RETRIES) {
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
    logger.info(`Starting LinkedIn Agentic Curation Flow for ${successfulArticles.length} articles...`);
    try {
      const selectedIndices = await geminiService.selectBestArticlesForLinkedIn(successfulArticles);
      logger.info(`LinkedIn Curation: Selected article indices: ${JSON.stringify(selectedIndices)}`);

      const uniqueIndices = [...new Set(selectedIndices)];
      const selectedArticles = uniqueIndices
        .map(idx => successfulArticles[idx])
        .filter(art => !!art);

      if (selectedArticles.length === 0) {
        logger.warn("LinkedIn Curation: No articles were selected by Gemini. Defaulting to the first available article.");
        selectedArticles.push(successfulArticles[0]);
      }

      if (selectedArticles.length > 0) {
        let initialized = false;
        let slideImagePath = null;
        try {
          logger.info("LinkedIn Curation: Initializing LinkedIn service...");
          await LinkedInService.init();
          initialized = true;
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
            megaPostData = await geminiService.generateLinkedInMasterPost(selectedArticles, 3, validationFeedback);
            const githubUrl = selectedArticles[0].githubUrl || "";
            const sourceBulletCount = geminiService.countSourceBullets(selectedArticles[0].fullContent || "");
            validation = geminiService.validatePostText(megaPostData, githubUrl, sourceBulletCount);

            if (validation.isValid) {
              logger.info(`LinkedIn Curation: Mega post passed quality validation (score: ${validation.qualityScore})`);
              break;
            }

            logger.warn(`LinkedIn Curation: Mega post failed quality validation (score: ${validation.qualityScore}):`);
            validation.errors.forEach(err => logger.warn(`  - ${err}`));

            if (attempt === maxGenerationAttempts) {
              logger.warn("LinkedIn Curation: Aborting publish due to repeated quality validation failures.");
              return;
            }

            validationFeedback = validation.errors;
            logger.info("LinkedIn Curation: Retrying mega post generation with validation feedback...");
          }

          try {
            logger.info(`LinkedIn Curation: Generating custom HTML slide image...`);
            slideImagePath = await LinkedInService.generateSlideImage(megaPostData.title, megaPostData.slidePoints, megaPostData.slideTagline);
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
              geminiService.saveRecentTopic(recentTopic);
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
  await TwitterService.init();

  const successfulArticles = [];
  for (const folder of config.folders) {
    try {
      const result = await runDataPipeline(folder);
      if (result) {
        logger.info(
          `Pipeline succeeded for folder type ${result.queryName}: ${result.githubUrl}`
        );
        successfulArticles.push({
          title: result.queryName,
          githubUrl: result.githubUrl,
          fullContent: result.markdownContent
        });
      } else {
        logger.info(
          `Pipeline completed for folder, but no new threads/posts were found.`
        );
      }
    } catch (error) {
      logger.error(`Pipeline iteration failed for folder ${folder.name}:`, error);
      // Continue to next folder despite error
    }
  }

  await GithubService.updateReadmeWithNewFile(
    config.github.owner,
    config.github.repo
  );

  // Run the end-of-run LinkedIn curation flow
  await runEndofRunCuration(successfulArticles);

  // Cleanup leftover debug screenshots from root
  TwitterService.cleanupScreenshots();
  LinkedInService.cleanupDebugScreenshots();
  try {
    if (fs.existsSync("linkedin-post-failed.png")) {
      fs.unlinkSync("linkedin-post-failed.png");
    }
  } catch (e) { }
};

let scheduledJob = null;
let isJobRunning = false;

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

      try {
        await processAllFolders();
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      } finally {
        isJobRunning = false;
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
    geminiService.cleanup();
    logger.info("Gemini service cleaned up");
  } catch (error) {
    logger.error("Error cleaning up Gemini service:", error);
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
  try {
    await processAllFolders();
  } catch (error) {
    logger.error("Initial pipeline execution failed:", error);
  } finally {
    isJobRunning = false;
  }
};

module.exports = {
  runDataPipeline,
  initCronJob,
  stopCronJob,
};
