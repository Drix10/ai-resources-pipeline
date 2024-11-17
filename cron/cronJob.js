const cron = require("node-cron");
const { logger } = require("../src/utils/helpers");
const config = require("../config");
const { runDataPipeline } = require("../src/services/cron");
const dbConnection = require("../src/utils/dbConnection");

let scheduledJob = null;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runPipelineWithRetry = async (retryCount = 0) => {
  try {
    const connectionStatus = dbConnection.getConnectionStatus();
    if (!connectionStatus.isConnected) {
      await dbConnection.connect(config.mongodb.uri);
    }

    await runDataPipeline();
  } catch (error) {
    logger.error(
      `Pipeline execution failed (attempt ${retryCount + 1}/${MAX_RETRIES}):`,
      error
    );

    if (retryCount < MAX_RETRIES - 1) {
      logger.info(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await sleep(RETRY_DELAY);
      return runPipelineWithRetry(retryCount + 1);
    }

    if (!dbConnection.getConnectionStatus().isConnected) {
      try {
        await dbConnection.connect(config.mongodb.uri);
      } catch (dbError) {
        logger.error("Failed to reconnect to database:", dbError);
      }
    }

    throw error;
  }
};

const initCronJob = () => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }

    logger.info("Running initial pipeline execution...");
    runPipelineWithRetry().catch((error) => {
      logger.error(
        "Initial pipeline execution failed after all retries:",
        error
      );
    });

    scheduledJob = cron.schedule(
      config.cron.schedule || "0 * * * *",
      async () => {
        logger.info(
          `Starting hourly pipeline run at ${new Date().toISOString()}`
        );

        try {
          await runPipelineWithRetry();
          logger.info("Hourly pipeline run completed successfully");
        } catch (error) {
          logger.error("Hourly pipeline run failed after all retries:", error);
        }
      }
    );

    logger.info(
      `Cron job initialized with schedule: ${
        config.cron.schedule || "0 * * * *"
      }`
    );
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

module.exports = {
  initCronJob,
  stopCronJob,
};
