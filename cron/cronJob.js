const cron = require("node-cron");
const { logger } = require("../src/utils/helpers");
const config = require("../config");
const { runDataPipeline } = require("../src/services/cron");
const dbConnection = require("../src/utils/dbConnection");

let scheduledJob = null;

const initCronJob = () => {
  try {
    if (scheduledJob) {
      logger.warn("Cron job already initialized");
      return scheduledJob;
    }

    // Run immediately when started
    logger.info("Running initial pipeline execution...");
    runDataPipeline().catch((error) => {
      logger.error("Initial pipeline execution failed:", error);
    });

    // Schedule to run every hour
    scheduledJob = cron.schedule("0 * * * *", async () => {
      logger.info(
        `Starting hourly pipeline run at ${new Date().toISOString()}`
      );

      try {
        // Ensure database connection
        const connectionStatus = dbConnection.getConnectionStatus();
        if (!connectionStatus.isConnected) {
          await dbConnection.connect(config.mongodb.uri);
        }

        // Run the pipeline
        await runDataPipeline();
      } catch (error) {
        logger.error("Scheduled pipeline run failed:", error);

        // Attempt to reconnect database if that was the issue
        if (!dbConnection.getConnectionStatus().isConnected) {
          try {
            await dbConnection.connect(config.mongodb.uri);
          } catch (dbError) {
            logger.error("Failed to reconnect to database:", dbError);
          }
        }
      }
    });

    logger.info("Cron job initialized with hourly schedule");
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
  }
};

// Function to run the pipeline manually
const runManually = async () => {
  logger.info("Starting manual pipeline execution...");
  try {
    // Ensure database connection
    const connectionStatus = dbConnection.getConnectionStatus();
    if (!connectionStatus.isConnected) {
      await dbConnection.connect(config.mongodb.uri);
    }

    await runDataPipeline();
    logger.info("Manual pipeline execution completed successfully");
  } catch (error) {
    logger.error("Manual pipeline execution failed:", error);
    throw error;
  }
};

module.exports = {
  initCronJob,
  stopCronJob,
  runManually,
};
