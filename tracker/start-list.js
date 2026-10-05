#!/usr/bin/env node
const { ensureChromeReady } = require("../src/utils/chromeLauncher");

(async () => {
  try {
    if (!(await ensureChromeReady(15))) {
      console.error("Chrome failed to start with remote debugging within the timeout. Exiting.");
      process.exit(1);
    }
    console.log("Chrome is ready. Starting list tracker...");
    require("./list-tracker.js");
  } catch (error) {
    console.error("Fatal error during startup:", error);
    process.exit(1);
  }
})();
