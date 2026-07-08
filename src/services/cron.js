const { logger, handleError, sleep } = require("../utils/helpers");
const fs = require("fs");
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
      )} resource added!\n\nMade by @Drix10 via @CosLynxAI\n\nCheck out the latest resource here:\n${
        githubResult.url
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
      // Step 1: Titles only to select best topics (saves tokens)
      const selectedIndices = await geminiService.selectBestArticlesForLinkedIn(successfulArticles);
      logger.info(`LinkedIn Curation: Selected article indices: ${JSON.stringify(selectedIndices)}`);
      
      const selectedArticles = selectedIndices
        .map(idx => successfulArticles[idx])
        .filter(art => !!art);
        
      if (selectedArticles.length > 0) {
        // Step 2: Curation - Generate final LinkedIn post using selected full contents
        const megaPostData = await geminiService.generateLinkedInMasterPost(selectedArticles);
        
        let slideImagePath = null;
        if (megaPostData.originalImage) {
          slideImagePath = megaPostData.originalImage;
          logger.info(`LinkedIn Curation: Using original article image: ${slideImagePath}`);
        } else {
          logger.info(`LinkedIn Curation: Generating custom HTML slide image...`);
          slideImagePath = await LinkedInService.generateSlideImage(megaPostData.title, megaPostData.slidePoints, megaPostData.slideTagline);
        }

        if (megaPostData.postText) {
          logger.info("LinkedIn Curation: Posting curated update to LinkedIn...");
          const postSuccess = await LinkedInService.postToLinkedIn(megaPostData.postText, slideImagePath).catch(err => {
            logger.error("Failed to post mega post to LinkedIn:", err);
            return false;
          });

          // Clean up the generated slide image after posting (only local generated PNGs)
          if (slideImagePath && !megaPostData.originalImage && typeof slideImagePath === "string" && slideImagePath.includes("temp")) {
            try {
              if (fs.existsSync(slideImagePath)) fs.unlinkSync(slideImagePath);
            } catch (e) {}
          }

          if (postSuccess) {
            logger.info("LinkedIn Curation: Post submitted successfully.");
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
  await LinkedInService.init();

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
  try {
    if (fs.existsSync("linkedin-post-failed.png")) {
      fs.unlinkSync("linkedin-post-failed.png");
    }
  } catch (e) {}
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
