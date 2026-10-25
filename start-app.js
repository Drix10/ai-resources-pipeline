#!/usr/bin/env node
const path = require("path");
// The repo's .env before anything else: helpers.js (loaded by chromeLauncher) picks the log level
// from NODE_ENV as it loads.
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ensureChromeReady } = require("./src/utils/chromeLauncher");

(async () => {
  try {
    // Without Chrome the run still writes its README update, blog sync and factory pass: X and LinkedIn try
    // Chrome again themselves (attachDriver) and skip their phase when it is not there.
    if (await ensureChromeReady(15)) console.log("Chrome is ready. Starting main application...");
    else console.warn("Chrome did not start with remote debugging in time: X and LinkedIn will retry it or be skipped this run.");
    require("./index.js");
  } catch (error) {
    console.error("Fatal error during startup:", error);
    process.exit(1);
  }
})();
