#!/usr/bin/env node
const path = require("path");
// The repo's .env before anything else: helpers.js (loaded by chromeLauncher) picks the log level
// from NODE_ENV as it loads.
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { ensureChromeReady } = require("./src/utils/chromeLauncher");

(async () => {
  try {
    if (!(await ensureChromeReady(15))) {
      console.error("Chrome failed to start with remote debugging within the timeout. Exiting.");
      process.exit(1);
    }
    console.log("Chrome is ready. Starting main application...");
    require("./index.js");
  } catch (error) {
    console.error("Fatal error during startup:", error);
    process.exit(1);
  }
})();
