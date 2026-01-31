#!/usr/bin/env node
const { spawn, exec } = require("child_process");
const path = require("path");
const { promisify } = require("util");
const execAsync = promisify(exec);

// Check if Chrome is already running with debugging
async function isChromeRunning() {
  try {
    const isWindows = process.platform === "win32";
    if (isWindows) {
      const { stdout } = await execAsync('netstat -ano | findstr ":9222"');
      return stdout.trim().length > 0;
    } else {
      const { stdout } = await execAsync("lsof -i :9222 2>/dev/null || true");
      return stdout.trim().length > 0;
    }
  } catch (error) {
    return false;
  }
}

// Start Chrome with remote debugging (cross-platform)
async function startChrome() {
  // Check if already running
  if (await isChromeRunning()) {
    console.log("Chrome is already running with remote debugging");
    return true;
  }

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  let chromeCmd, chromeArgs;

  if (isWindows) {
    const userProfile = process.env.USERPROFILE || process.env.HOME || "";
    const userDataDir = path.join(userProfile, "chrome-debug");
    chromeCmd = "cmd";
    chromeArgs = [
      "/c",
      "start",
      "chrome",
      "--remote-debugging-port=9222",
      `--user-data-dir=${userDataDir}`,
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
  } else if (isMac) {
    chromeCmd = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    chromeArgs = [
      "--remote-debugging-port=9222",
      "--user-data-dir=" + process.env.HOME + "/chrome-debug",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
  } else {
    // Linux
    chromeCmd = "google-chrome";
    chromeArgs = [
      "--remote-debugging-port=9222",
      "--user-data-dir=" + process.env.HOME + "/chrome-debug",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
  }

  try {
    const chrome = spawn(chromeCmd, chromeArgs, {
      detached: true,
      stdio: "ignore",
    });
    chrome.unref();
    console.log("Started Chrome with remote debugging");
    return true;
  } catch (error) {
    console.error("Failed to start Chrome:", error.message);
    return false;
  }
}

// Main startup
(async () => {
  try {
    const chromeStarted = await startChrome();
    if (!chromeStarted) {
      console.error("Failed to start Chrome. Exiting.");
      process.exit(1);
    }

    // Wait for Chrome to be ready (check port availability)
    let retries = 10;
    while (retries > 0 && !(await isChromeRunning())) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      retries--;
    }

    if (retries === 0) {
      console.error("Chrome failed to start within timeout. Exiting.");
      process.exit(1);
    }

    console.log("Chrome is ready. Starting main application...");
    require("./index.js");
  } catch (error) {
    console.error("Fatal error during startup:", error);
    process.exit(1);
  }
})();
