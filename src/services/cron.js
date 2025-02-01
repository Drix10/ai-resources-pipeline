const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const TwitterService = require("./twitter");
const GithubService = require("./github");
const cron = require("node-cron");
const mongoose = require("mongoose");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (retryCount = 0) => {
  try {
    const result = await TwitterService.fetchTweets();
    if (!result || !Array.isArray(result.threads)) {
      throw new Error("No valid tweets returned from Twitter service");
    }

    if (result.threads.length > 0) {
      const githubResult = await GithubService.createMarkdownFileFromTweets(
        result.threads,
        result.queryType
      );
      if (!githubResult?.success) {
        throw new Error("Failed to create and upload markdown file");
      }

      const tweetText = `New ${getTopicName(
        result.queryType
      )} resource added!\n\nMade by @DRIX_10_ via @CosLynxAI\n\nCheck out the latest resource here:\n${
        githubResult.url
      }`;
      await TwitterService.postTweet(tweetText);

      return {
        queryType: result.queryType,
        githubUrl: githubResult.url,
      };
    }
  } catch (error) {
    handleError(
      error,
      `Pipeline error (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      {
        retryCount,
        stats,
      }
    );

    if (retryCount < MAX_RETRIES) {
      logger.info(`Retrying in ${RETRY_DELAY}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
      return runDataPipeline(retryCount + 1);
    }

    throw error;
  }
};

function getTopicName(queryType) {
  switch (queryType) {
    case 1:
      return "AI & Machine Learning";
    case 2:
      return "Programming & Development";
    case 3:
      return "Productivity & Business";
    default:
      return "AI Scrapped";
  }
}

let scheduledJob = null;

const scheduleRandomJob = () => {
  const RandNum = Math.floor(Math.random() * 7) + 1;
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
      const timestamp = new Date().toISOString();
      logger.info(`Running scheduled pipeline at ${timestamp}`);

      try {
        if (mongoose.connection.readyState !== 1) {
          throw new Error("Database connection not established");
        }
        runInitialPipeline();
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);

        if (mongoose.connection.readyState !== 1) {
          try {
            await mongoose.connect(config.mongodb.uri);
          } catch (dbError) {
            logger.error("Failed to reconnect to database:", dbError);
          }
        }
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

    logger.info("Running initial pipeline execution...");
    runInitialPipeline();
    scheduleRandomJob();

    return scheduledJob;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

const stopCronJob = () => {
  if (scheduledJob) {
    scheduledJob.stop();
    scheduledJob = null;
    logger.info("Cron job stopped");
  } else {
    logger.warn("No active cron job to stop");
  }
};

const runInitialPipeline = () => {
  runDataPipeline().catch((error) => {
    logger.error("Initial pipeline execution failed:", error);
  });
};

module.exports = {
  runDataPipeline,
  initCronJob,
  stopCronJob,
};
