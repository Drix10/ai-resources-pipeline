const { logger } = require("./src/utils/helpers");
const { initCronJob, stopCronJob, releasePipelineLock } = require("./src/services/cron");

// Graceful stop waits for the current step (an article, a comment) to finish; past this deadline
// the process exits anyway. Closing the console window gives Windows only seconds.
const SHUTDOWN_DEADLINE_MS = 90 * 1000;
const HANGUP_DEADLINE_MS = 8 * 1000;

let shuttingDown = false;

const forceExit = (code) => {
  try { require("./src/factory/opus").abortAll(); } catch { /* factory not loaded */ }
  releasePipelineLock();
  process.exit(code);
};

const handleShutdown = async (signal, { code = 0, deadlineMs = SHUTDOWN_DEADLINE_MS } = {}) => {
  if (shuttingDown) {
    // A second Ctrl+C means "now".
    logger.warn(`Received ${signal} again: exiting immediately.`);
    return forceExit(1);
  }
  shuttingDown = true;
  logger.info(`Received ${signal}. Starting graceful shutdown (press Ctrl+C again to force)...`);
  const deadline = setTimeout(() => {
    logger.error(`Shutdown did not finish within ${Math.round(deadlineMs / 1000)}s; exiting.`);
    forceExit(1);
  }, deadlineMs);
  deadline.unref();

  try {
    await stopCronJob();
    logger.info("Graceful shutdown completed");
    process.exit(code);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
};

const startApplication = async () => {
  try {
    logger.info("Starting application...");

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
    process.on("SIGBREAK", () => handleShutdown("SIGBREAK"));
    process.on("SIGHUP", () => handleShutdown("SIGHUP", { deadlineMs: HANGUP_DEADLINE_MS }));
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      handleShutdown("uncaughtException", { code: 1, deadlineMs: 20 * 1000 });
    });
    // A stray rejection from one scraper/LLM call must not kill the long-running
    // scheduler; log it and keep going. Truly uncaught exceptions still shut down.
    process.on("unhandledRejection", (reason) => {
      logger.error("Unhandled Rejection (non-fatal):", reason);
    });

    // --now (or RUN_NOW=true) runs the pipeline right away; otherwise it runs when it is due.
    const runNow = process.argv.includes("--now") || process.env.RUN_NOW === "true";
    initCronJob({ runNow });

    logger.info("Application started successfully");
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
