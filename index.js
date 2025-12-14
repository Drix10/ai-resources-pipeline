const { logger } = require("./src/utils/helpers");
const { initCronJob, stopCronJob } = require("./src/services/cron");

const handleShutdown = async (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  try {
    await stopCronJob();
    logger.info("Cron job stopped successfully");

    // Give time for cleanup
    await new Promise((resolve) => setTimeout(resolve, 2000));

    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
};

const startApplication = async () => {
  try {
    logger.info("Starting application...");

    initCronJob();

    logger.info("Application started successfully");

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

startApplication().catch((error) => {
  logger.error("Fatal error during startup:", error);
  process.exit(1);
});

module.exports = {
  startApplication,
  handleShutdown,
};
