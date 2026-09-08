const { spawn, exec } = require("child_process");
const path = require("path");
const http = require("http");
const { promisify } = require("util");
const execAsync = promisify(exec);
const { logger } = require("./helpers");

function probeHttpEndpoint(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get("http://127.0.0.1:9222/json/version", { timeout: timeoutMs }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function isChromeRunning() {
  if (await probeHttpEndpoint(800)) return true;

  try {
    const isWindows = process.platform === "win32";
    if (isWindows) {
      // Filter strictly for sockets in LISTENING state (excluding TIME_WAIT, CLOSE_WAIT)
      const { stdout } = await execAsync('netstat -ano -p tcp | findstr /R /C:":9222 .*LISTENING"');
      return stdout.trim().length > 0;
    } else {
      const { stdout } = await execAsync("lsof -i :9222 -sTCP:LISTEN 2>/dev/null || true");
      return stdout.trim().length > 0;
    }
  } catch {
    return false;
  }
}

async function startChrome() {
  if (await isChromeRunning()) {
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
      "--user-data-dir=" + (process.env.HOME || "") + "/chrome-debug",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
  } else {
    chromeCmd = "google-chrome";
    chromeArgs = [
      "--remote-debugging-port=9222",
      "--user-data-dir=" + (process.env.HOME || "") + "/chrome-debug",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ];
  }

  try {
    const chromeProc = spawn(chromeCmd, chromeArgs, {
      detached: true,
      stdio: "ignore",
    });
    chromeProc.unref();
    return true;
  } catch (error) {
    if (logger) logger.error("Failed to launch Chrome:", error.message);
    return false;
  }
}

async function ensureChromeReady(maxWaitSec = 15) {
  if (await probeHttpEndpoint(1000)) {
    return true;
  }

  if (logger) logger.info("Chrome debugging port 9222 not open. Auto-starting Chrome with persistent profile (same as npm start)...");
  const started = await startChrome();
  if (!started) return false;

  let retries = maxWaitSec;
  while (retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (await probeHttpEndpoint(1000)) {
      if (logger) logger.info("Chrome is ready on port 9222.");
      return true;
    }
    retries--;
  }

  if (logger) logger.warn(`Chrome did not become responsive on port 9222 within ${maxWaitSec} seconds.`);
  return false;
}

module.exports = {
  isChromeRunning,
  startChrome,
  ensureChromeReady
};
