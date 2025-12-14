const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const twitterService = require("./twitter");
const TwitterService = new twitterService();
const GithubService = require("./github");
const cron = require("node-cron");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (folder) => {
  for (let retryCount = 0; retryCount <= MAX_RETRIES; retryCount++) {
    try {
      const result = await TwitterService.fetchTweets({ folder });

      if (!result) {
        throw new Error("Twitter service failed to fetch tweets (returned null)");
      }

      if (result.length === 0) {
        logger.info(`No new tweets found for folder: ${folder.name}`);
        return null; 
      }

      if (result.length > 0) {
        const githubResult = await GithubService.createMarkdownFileFromTweets(
          result,
          folder.name,
          folder
        );
        if (!githubResult?.success) {
          throw new Error("Failed to create and upload markdown file");
        }

        const tweetText = `New ${getTopicName(
          folder.name
        )} resource added!\n\nMade by @DRIX_10_ via @CosLynxAI\n\nCheck out the latest resource here:\n${
          githubResult.url
        }`;
        await TwitterService.postTweet(tweetText);

        return {
          queryName: folder.name,
          githubUrl: githubResult.url,
        };
      }
      return null;
    } catch (error) {
      console.log(error);
      if (retryCount === MAX_RETRIES) {
        handleError(
          error,
          `Pipeline error for folder type (attempt ${
            retryCount + 1
          }/${MAX_RETRIES})`,
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

const processAllFolders = async () => {
  await TwitterService.init();

  for (const folder of config.folders) {
    try {
      const result = await runDataPipeline(folder);
      if (result) {
        logger.info(
          `Pipeline succeeded for folder type ${result.queryName}: ${result.githubUrl}`
        );
      } else {
        logger.info(
          `Pipeline completed for folder, but no new threads were found.`
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

  // Cleanup screenshots after successful run
  TwitterService.cleanupScreenshots();
};

let scheduledJob = null;
let isJobRunning = false;

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
        // processAllFolders handles its own TwitterService.init()
        await processAllFolders();
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      } finally {
        isJobRunning = false;
      }

      scheduleRandomJob();
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

  // Cleanup Twitter service
  try {
    await TwitterService.cleanup();
    logger.info("Twitter service cleaned up");
  } catch (error) {
    logger.error("Error cleaning up Twitter service:", error);
  }
};

const runInitialPipeline = async () => {
  if (isJobRunning) {
    logger.warn("Job already running, skipping initial pipeline");
    return;
  }

  isJobRunning = true;
  logger.info("Running initial pipeline execution...");
  try {
    await TwitterService.init();

    for (const folder of config.folders) {
      const result = await runDataPipeline(folder);
      if (result) {
        logger.info(
          `Pipeline succeeded for folder type ${result.queryName}: ${result.githubUrl}`
        );
      } else {
        logger.info(
          `Pipeline completed for folder, but no new threads were found.`
        );
      }
    }
    await GithubService.updateReadmeWithNewFile(
      config.github.owner,
      config.github.repo
    );

    // Cleanup screenshots after successful run
    TwitterService.cleanupScreenshots();
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
