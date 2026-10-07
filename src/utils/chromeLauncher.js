const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const { By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { logger, sleep } = require("./helpers");

const DEBUG_PORT = 9222;
const DEBUG_ADDRESS = `127.0.0.1:${DEBUG_PORT}`;

function probeHttpEndpoint(timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(`http://${DEBUG_ADDRESS}/json/version`, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// The debug endpoint is the single source of truth: a listening socket that does
// not answer /json/version is not a usable Chrome, so no netstat/lsof fallback.
const isChromeRunning = () => probeHttpEndpoint(800);

function findChromeExecutable() {
  const candidates = process.platform === "win32"
    ? [
        "C:/Program Files/Google/Chrome/Application/chrome.exe",
        "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
        path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["google-chrome", "google-chrome-stable", "chromium"];
  return candidates.find((p) => path.isAbsolute(p) && fs.existsSync(p)) || candidates[candidates.length - 1];
}

async function startChrome() {
  if (await isChromeRunning()) return true;

  const home = process.env.USERPROFILE || process.env.HOME || "";
  const userDataDir = path.join(home, "chrome-debug");
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    const proc = spawn(findChromeExecutable(), [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${userDataDir}`,
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "https://x.com",
    ], { detached: true, stdio: "ignore" });
    proc.on("error", (error) => logger.error(`Failed to launch Chrome: ${error.message}`));
    proc.unref();
    return true;
  } catch (error) {
    logger.error(`Failed to launch Chrome: ${error.message}`);
    return false;
  }
}

async function ensureChromeReady(maxWaitSec = 15) {
  if (await probeHttpEndpoint(1000)) return true;

  logger.info(`Chrome debugging port ${DEBUG_PORT} not open. Auto-starting Chrome with persistent profile...`);
  if (!(await startChrome())) return false;

  for (let waited = 0; waited < maxWaitSec; waited++) {
    await sleep(1000);
    if (await probeHttpEndpoint(1000)) {
      logger.info(`Chrome is ready on port ${DEBUG_PORT}.`);
      return true;
    }
  }
  logger.warn(`Chrome did not become responsive on port ${DEBUG_PORT} within ${maxWaitSec} seconds.`);
  return false;
}

// Select-all / submit shortcuts use Cmd on macOS and Ctrl elsewhere. On a Mac,
// Ctrl+A in a text field only moves the caret to line start.
const MOD_KEY = process.platform === "darwin" ? Key.COMMAND : Key.CONTROL;

// Each attached session owns a chromedriver process. Track it so callers can
// stop that process without quitting the user's Chrome.
const driverServices = new WeakMap();

// Attach Selenium to the persistent, already-logged-in Chrome (never quits it).
async function attachDriver() {
  await ensureChromeReady();
  const options = new chrome.Options();
  options.debuggerAddress(DEBUG_ADDRESS);
  const service = new chrome.ServiceBuilder().build();
  try {
    const driver = chrome.Driver.createSession(options, service);
    await driver.getSession();
    driverServices.set(driver, service);
    return driver;
  } catch (error) {
    try { await service.kill(); } catch (e) { }
    throw new Error(`Chrome not running with remote debugging (${error.message}). Run: chrome --remote-debugging-port=${DEBUG_PORT}`);
  }
}

// Stops the chromedriver process behind a session. Chrome itself and its tabs
// are untouched (no driver.quit()), so the logged-in browser stays as it was.
async function releaseDriver(driver) {
  const service = driver && driverServices.get(driver);
  if (!service) return;
  driverServices.delete(driver);
  try { await service.kill(); } catch (e) { logger.warn(`Could not stop chromedriver: ${e.message}`); }
}

const TRANSIENT_SESSION_ERRORS = [
  "invalid session", "no such window", "chrome not reachable", "transport", "session not created", "session deleted",
];

// Waits (up to 5 min) for the user to be logged in to X in the attached Chrome.
async function waitForXLogin(driver, label = "pipeline") {
  const homeLink = By.css('[data-testid="AppTabBar_Home_Link"]');
  await driver.get("https://x.com/home");
  await sleep(3000);
  try {
    await driver.wait(until.elementLocated(homeLink), 5000);
    logger.info("Already logged in to X (Twitter), skipping login process");
    return;
  } catch (e) {
    logger.warn("⚠️ X (Twitter) Login Required: Please log in manually in the Chrome browser window.");
  }

  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await driver.findElements(homeLink)).length > 0) {
        logger.info(`X (Twitter) login detected! Continuing ${label}...`);
        return;
      }
    } catch (pollErr) {
      const msg = String(pollErr?.message || "").toLowerCase();
      if (TRANSIENT_SESSION_ERRORS.some((m) => msg.includes(m))) throw pollErr;
    }
    await sleep(5000);
  }
  throw new Error("Twitter manual login timed out after 5 minutes.");
}

module.exports = {
  isChromeRunning,
  startChrome,
  ensureChromeReady,
  attachDriver,
  releaseDriver,
  waitForXLogin,
  MOD_KEY,
};
