const { logger } = require("./src/utils/helpers");
const config = require("./config");
const dbConnection = require("./src/utils/dbConnection");
const { initCronJob, stopCronJob, runManually } = require("./cron/cronJob");

// Graceful shutdown handler
const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    // Stop the cron job
    stopCronJob();
    logger.info("Cron job stopped successfully");

    // Disconnect from database
    await dbConnection.disconnect();
    logger.info("Database disconnected successfully");

    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
};

// Initialize application
const startApplication = async () => {
  try {
    logger.info("Starting application...");

    // Connect to MongoDB
    await dbConnection.connect(config.mongodb.uri);
    logger.info("Database connection established");

    // Initialize cron job
    initCronJob();
    logger.info("Cron job initialized");

    // If RUN_IMMEDIATELY env var is set, run the pipeline immediately
    if (process.env.RUN_IMMEDIATELY === "true") {
      logger.info("Running pipeline immediately...");
      await runManually();
    }

    logger.info("Application started successfully");

    // Register shutdown handlers
    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      handleShutdown("uncaughtException");
    });
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      handleShutdown("unhandledRejection");
    });
  } catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
  }
};

// Start the application
startApplication().catch((error) => {
  logger.error("Fatal error during startup:", error);
  process.exit(1);
});

// Export for testing purposes
module.exports = {
  startApplication,
  handleShutdown,
};
