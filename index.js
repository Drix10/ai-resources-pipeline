const path = require("path");
// The repo's .env before anything else: helpers.js picks the log level from NODE_ENV as it loads.
require("dotenv").config({ path: path.join(__dirname, ".env") });
// Work from the repo root whatever directory the run was started in: code that resolves paths
// against process.cwd() then uses the same files as everything anchored to the repo.
process.chdir(__dirname);
const { logger } = require("./src/utils/helpers");
const { runPipeline, stopPipeline, releasePipelineLock } = require("./src/services/cron");

// `npm start` = one full run (articles and batch commits, LinkedIn, the blog push), then exit.
// With the optional content factory add-on (src/utils/factory.js) the run also ends with one reel.
// No scheduler: start it again for the next run.

// Graceful stop waits for the current step (an article, a comment) to finish; past this deadline
// the process exits anyway. Closing the console window gives Windows only seconds.
const SHUTDOWN_DEADLINE_MS = 90 * 1000;
const HANGUP_DEADLINE_MS = 8 * 1000;
// After the run, anything still holding the event loop open (a browser socket, a timer) gets
// this long before the process exits anyway.
const EXIT_GRACE_MS = 10 * 1000;

let shuttingDown = false;

// Claude calls (LLM provider "claude") are child processes, which outlive this one on Windows.
const killClaude = () => { try { require("./src/services/claude").killAll(); } catch { /* nothing running */ } };

const forceExit = (code) => {
  killClaude();
  try { require("./src/utils/factory").factoryModule("opus")?.abortAll(); } catch { /* the factory is optional */ }
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
  // A stop ends the run's writing at once: a Claude call in flight is killed, not waited for.
  killClaude();
  const deadline = setTimeout(() => {
    logger.error(`Shutdown did not finish within ${Math.round(deadlineMs / 1000)}s; exiting.`);
    forceExit(1);
  }, deadlineMs);
  deadline.unref();

  try {
    await stopPipeline();
    logger.info("Graceful shutdown completed");
    process.exit(code);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    process.exit(1);
  }
};

const startApplication = async () => {
  process.on("SIGTERM", () => handleShutdown("SIGTERM"));
  process.on("SIGINT", () => handleShutdown("SIGINT"));
  process.on("SIGBREAK", () => handleShutdown("SIGBREAK"));
  process.on("SIGHUP", () => handleShutdown("SIGHUP", { deadlineMs: HANGUP_DEADLINE_MS }));
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error);
    handleShutdown("uncaughtException", { code: 1, deadlineMs: 20 * 1000 });
  });
  // A stray rejection from one scraper/LLM call must not kill the run; log it and keep going.
  // Truly uncaught exceptions still shut down.
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled Rejection (non-fatal):", reason);
  });

  logger.info("Starting the pipeline: one full run, then exit.");
  const outcome = await runPipeline();
  // A signal arrived mid-run: handleShutdown owns the exit.
  if (shuttingDown) return;
  shuttingDown = true;
  await stopPipeline();
  logger.info(`Run finished (${outcome}). Exiting.`);
  // Exit on its own so the log files flush; the timer only covers a handle left open.
  process.exitCode = outcome === "ok" ? 0 : 1;
  setTimeout(() => forceExit(process.exitCode), EXIT_GRACE_MS).unref();
};

startApplication().catch((error) => {
  logger.error("Fatal error during startup:", error);
  forceExit(1);
});

module.exports = {
  startApplication,
  handleShutdown,
};
