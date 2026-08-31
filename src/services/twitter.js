const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");
const fs = require("fs");
const path = require("path");

const PROCESSED_IDS_PATH = path.join(process.cwd(), ".processed-tweet-ids.json");

const NON_TECH_PATTERNS = [
  /\b(nba|nfl|mlb|premier league|champions league|football|soccer|basketball|baseball|touchdown|pacers|lakers|warriors|celtics|quarterback|referee|halftime score|slam dunk|all-star voting|ipl|cricket|tennis|formula 1|f1)\b/i,
  /\b(perfume|fragrance|cologne|lipstick|makeup|eyeliner|haute couture|ootd|fashion week|runway model|dress code|wardrobe|shoes|sneakers|footwear|arch support|skincare)\b/i,
  /\b(kardashian|grammys|oscars red carpet|box office weekend|celebrity dating|paparazzi|gossip|horoscope|astrology|zodiac)\b/i,
  /\b(comment ['"]?(yes|link|send|guide|prompt)['"]?|drop a like and i['’]?ll (dm|send)|retweet for a chance|giveaway|airdrop|whitelist|presale|free tokens)\b/i,
  /\b(\d+\s+(?:morning\s+)?habits\b|morning routine\b|mindset shift\b|how to wake up at \d|financial freedom in \d|crypto signal group|passive income|billionaire(?:s)?\b|millionaire(?:s)?\b)\b/i,
];

function isOfftopicTweet(text) {
  if (!text || typeof text !== "string") return false;
  return NON_TECH_PATTERNS.some((pattern) => pattern.test(text));
}

class TwitterService {
  constructor() {
    this.driver = null;
    this.RATE_LIMIT_DELAY = 1500;
    this.lastRequestTime = 0;
    this.isInitialized = false;
    this.MAX_PROCESSED_IDS = 10000; // Prevent memory leak
    this.processedTweetIds = this.loadProcessedIds();
  }

  clearProcessedIds() {
    // Clear old IDs if set gets too large
    if (this.processedTweetIds.size > this.MAX_PROCESSED_IDS) {
      logger.info("Clearing processed tweet IDs to prevent memory leak");
      // Keep the most recent 50% of IDs to prevent immediate duplicate processing
      const idsArray = Array.from(this.processedTweetIds);
      const keptIds = idsArray.slice(Math.floor(idsArray.length / 2));
      this.processedTweetIds = new Set(keptIds);
      this.persistProcessedIds();
    }
  }

  loadProcessedIds() {
    try {
      if (!fs.existsSync(PROCESSED_IDS_PATH)) return new Set();
      const parsed = JSON.parse(fs.readFileSync(PROCESSED_IDS_PATH, "utf8"));
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.filter((id) => typeof id === "string").slice(-this.MAX_PROCESSED_IDS));
    } catch (error) {
      logger.warn(`Could not load published X IDs: ${error.message}`);
      return new Set();
    }
  }

  persistProcessedIds() {
    try {
      const tempPath = `${PROCESSED_IDS_PATH}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(Array.from(this.processedTweetIds)), "utf8");
      try {
        fs.renameSync(tempPath, PROCESSED_IDS_PATH);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        fs.rmSync(PROCESSED_IDS_PATH, { force: true });
        fs.renameSync(tempPath, PROCESSED_IDS_PATH);
      }
    } catch (error) {
      logger.warn(`Could not persist published X IDs: ${error.message}`);
    }
  }

  markContentAsPublished(collections) {
    let changed = false;
    for (const collection of collections || []) {
      for (const tweet of collection?.tweets || []) {
        const id = tweet?.id || tweet?.url?.split("/status/")[1]?.split("?")[0];
        if (id && !this.processedTweetIds.has(id)) {
          this.processedTweetIds.add(id);
          changed = true;
        }
      }
    }
    this.clearProcessedIds();
    if (changed) this.persistProcessedIds();
  }

  getSearchQuery(folder) {
    if (!folder || !folder.lists || folder.lists.length === 0) {
      throw new Error("Invalid folder provided to getSearchQuery");
    }
    const listIndex = Math.floor(Math.random() * folder.lists.length);
    return {
      listId: folder.lists[listIndex],
      name: folder.name,
    };
  }

  async checkRateLimit() {
    const now = Date.now();
    if (now - this.lastRequestTime < this.RATE_LIMIT_DELAY) {
      const waitTime = this.RATE_LIMIT_DELAY - (now - this.lastRequestTime);
      logger.info(
        `Rate limit: Waiting ${waitTime / 1000} seconds before next request`
      );
      await sleep(waitTime);
    }
    this.lastRequestTime = now;
  }

  async ensureDriverConnected() {
    if (!this.driver || !this.isInitialized) {
      await this.init();
      return;
    }
    try {
      await this.driver.getCurrentUrl();
    } catch (err) {
      logger.warn(`TwitterService: WebDriver session was lost or invalid (${err.message}). Reinitializing...`);
      this.isInitialized = false;
      await this.cleanup();
      await this.init();
    }
  }

  async ensureChromeRunning() {
    try {
      const res = await fetch("http://127.0.0.1:9222/json/version");
      if (res.ok) return true;
    } catch (e) {}

    const { spawn } = require("child_process");
    const userProfile = process.env.USERPROFILE || process.env.HOME || "";
    const userDataDir = path.join(userProfile, "chrome-debug");
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }

    const chromeCandidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
      "google-chrome",
      "chrome"
    ];

    let chromeExe = chromeCandidates.find(p => fs.existsSync(p)) || "chrome";
    try {
      const proc = spawn(chromeExe, [
        "--remote-debugging-port=9222",
        `--user-data-dir=${userDataDir}`,
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "https://x.com"
      ], { detached: true, stdio: "ignore" });
      proc.unref();

      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        try {
          const res = await fetch("http://127.0.0.1:9222/json/version");
          if (res.ok) return true;
        } catch (err) {}
      }
    } catch (launchErr) {
      logger.warn(`Could not auto-launch Chrome: ${launchErr.message}`);
    }
    return false;
  }

  async init() {
    try {
      if (!this.driver || !this.isInitialized) {
        await this.ensureChromeRunning();

        let options = new chrome.Options();
        options.options_["debuggerAddress"] = "127.0.0.1:9222";

        try {
          this.driver = await new Builder()
            .forBrowser("chrome")
            .setChromeOptions(options)
            .build();

          logger.info("Connected to existing Chrome browser");
          this.isInitialized = true;
        } catch (connectionError) {
          logger.error(
            "Failed to connect to Chrome. Make sure Chrome is running with: chrome --remote-debugging-port=9222"
          );
          throw new Error(
            "Chrome not running with remote debugging. Run: chrome --remote-debugging-port=9222"
          );
        }
      }
      await this.login();
    } catch (error) {
      logger.error("Failed to initialize:", error);
      this.isInitialized = false;
      await this.cleanup();
      throw error;
    }
  }

  async findContent() {
    try {
      const THREADS_NEEDED = 10;
      const MAX_SCROLL_ATTEMPTS = 40;
      const SCROLL_PAUSE = 700;
      const INITIAL_LOAD_TIMEOUT = 15000;
      const MIN_TOTAL_WORDS = 30;
      const MIN_WORDS_WITH_EXTERNAL_LINK = 15;

      const spamKeywords = [
        "we are hiring", "hiring for", "dm me to", "join my team", "dm for",
        "check out my course", "buy my book", "join the waitlist", "sign up now",
        "use my code", "limited spots", "giveaway", "subscribe for", "link in bio"
      ];

      let collectedContent = [];
      let scrollAttempts = 0;
      let validTweetsCount = 0;
      const seenTweetIds = new Set();
      const collectedTweetIds = new Set();
      let sameContentCount = 0;

      this.clearProcessedIds();

      try {
        await this.driver.wait(
          until.elementLocated(By.css('article[data-testid="tweet"]')),
          INITIAL_LOAD_TIMEOUT
        );
      } catch (error) {
        logger.error("Initial tweet selector not found:", error);
        throw error;
      }

      while (scrollAttempts < MAX_SCROLL_ATTEMPTS && validTweetsCount < THREADS_NEEDED) {
        let batch = [];
        try {
          batch = await this.driver.executeScript(() => {
            const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
            const list = [];
            for (const el of articles) {
              try {
                const statusA = el.querySelector('a[href*="/status/"]');
                const url = statusA ? statusA.href : "";
                const idMatch = url.match(/\/status\/(\d+)/);
                const tweetId = idMatch ? idMatch[1] : "";
                if (!tweetId) continue;

                const textEl = el.querySelector('[data-testid="tweetText"]');
                let text = textEl ? (textEl.innerText || "").trim() : "";

                const quoteTextEl = el.querySelector('[role="link"][href*="/status/"] [data-testid="tweetText"]');
                if (quoteTextEl && quoteTextEl !== textEl) {
                  text += "\n\nQuoted Tweet:\n" + (quoteTextEl.innerText || "").trim();
                }

                const timeEl = el.querySelector("time");
                const timestamp = timeEl ? timeEl.getAttribute("datetime") : "";

                const links = [];
                const anchors = Array.from(el.querySelectorAll("a[href]"));
                for (const a of anchors) {
                  const href = a.href;
                  if (!href) continue;
                  const hl = href.toLowerCase();
                  const isInternal = hl.includes("twitter.com/") || hl.includes("x.com/") || href.startsWith("/");
                  const isNav = hl.includes("/status/") || hl.includes("/hashtag/") || hl.includes("/search") || hl.includes("/i/lists") || hl.includes("/home");
                  if (hl.includes("t.co") || !isInternal || (!isNav && !href.startsWith("/"))) {
                    links.push(href);
                  }
                }

                const images = [];
                const imgEls = Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img'));
                for (const img of imgEls) {
                  if (img.src) images.push(img.src);
                }

                list.push({ tweetId, url, timestamp, text, links, images });
              } catch (e) {}
            }
            return list;
          });
        } catch (scriptErr) {
          logger.warn("Batch DOM extraction failed:", scriptErr.message);
        }

        let newInScroll = 0;

        for (const item of batch || []) {
          if (validTweetsCount >= THREADS_NEEDED) break;
          const { tweetId, url, timestamp, text, links, images } = item;
          if (!tweetId || seenTweetIds.has(tweetId)) continue;
          seenTweetIds.add(tweetId);
          newInScroll++;

          if (!text || text.length === 0) continue;

          const textLower = text.toLowerCase();
          if (spamKeywords.some(kw => textLower.includes(kw))) {
            logger.debug(`Skipping tweet ${tweetId}: Detected spam keyword`);
            continue;
          }

          if (isOfftopicTweet(text)) {
            logger.debug(`Tweet ${tweetId} is non-technical / off-topic content, skipping`);
            continue;
          }

          const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
          const hasExternalLink = (links || []).some(l => /^https?:\/\//i.test(l) && !/^(https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(l));
          const hasEnoughDetail = wordCount >= MIN_TOTAL_WORDS || (hasExternalLink && wordCount >= MIN_WORDS_WITH_EXTERNAL_LINK);

          if (!hasEnoughDetail) {
            logger.debug(`Tweet ${tweetId} lacks enough technical detail (${wordCount} words), skipping`);
            continue;
          }

          if (this.processedTweetIds.has(tweetId)) {
            logger.debug(`Tweet ${tweetId} already published previously, skipping`);
            continue;
          }

          collectedTweetIds.add(tweetId);
          collectedContent.push({
            tweets: [{ text, links, images, url, timestamp }],
            url,
            timestamp
          });
          validTweetsCount++;
        }

        if (newInScroll === 0) {
          sameContentCount++;
          if (sameContentCount >= 8) {
            logger.info("No more new tweets loading after multiple fast scrolls, finishing list.");
            break;
          }
        } else {
          sameContentCount = 0;
        }

        if (validTweetsCount >= THREADS_NEEDED) break;

        try {
          await this.driver.executeScript("window.scrollBy(0, window.innerHeight * 2);");
        } catch (e) {}

        await sleep(SCROLL_PAUSE);
        scrollAttempts++;
      }

      logger.info(`Collected ${validTweetsCount} valid high-signal content pieces`);
      return collectedContent;
    } catch (error) {
      logger.error("Error in findContent:", error);
      throw error;
    }
  }

  async switchToTab(domainKeyword) {
    let originalHandle = null;
    try {
      originalHandle = await this.driver.getWindowHandle();
    } catch (e) { }

    try {
      const handles = await this.driver.getAllWindowHandles();
      for (const handle of handles) {
        try {
          await this.driver.switchTo().window(handle);
          const url = await this.driver.getCurrentUrl();
          let hostname = "";
          try {
            hostname = new URL(url).hostname;
          } catch (urlErr) { }
          if (
            hostname.endsWith(domainKeyword) ||
            hostname === domainKeyword ||
            hostname.endsWith("twitter.com") ||
            hostname === "twitter.com" ||
            hostname.endsWith("x.com") ||
            hostname === "x.com"
          ) {
            logger.info(`TwitterService: Switched to tab matching "${domainKeyword}": ${url}`);
            try {
              await this.driver.sendDevToolsCommand("Page.bringToFront");
            } catch (cdpErr) {
              await this.driver.executeScript("window.focus();");
            }
            return true;
          }
        } catch (err) { }
      }
      logger.info(`TwitterService: No active tab matching "${domainKeyword}" found. Restoring original tab context.`);
      if (originalHandle) {
        await this.driver.switchTo().window(originalHandle);
      }
      return false;
    } catch (e) {
      logger.warn("TwitterService: Error switching tabs: " + (e.stack || e));
      if (originalHandle) {
        try {
          await this.driver.switchTo().window(originalHandle);
        } catch (restoreErr) { }
      }
      return false;
    }
  }

  async login() {
    try {
      const matched = await this.switchToTab("x.com");
      if (!matched) {
        logger.info("TwitterService: No matching tab found, opening a new tab...");
        await this.driver.switchTo().newWindow("tab");
      }
      // First check if already logged in
      await this.driver.get("https://x.com/home");
      await sleep(3000);

      try {
        // Check if we're already on the home page (logged in)
        await this.driver.wait(
          until.elementLocated(By.css('[data-testid="AppTabBar_Home_Link"]')),
          5000
        );
        logger.info("Already logged in to X (Twitter), skipping login process");
        return;
      } catch (e) {
        logger.info("Not logged in to X (Twitter), prompting for manual login...");
      }

      logger.warn("⚠️ X (Twitter) Login Required: Please log in manually in the Chrome browser window.");

      const maxLoginAttempts = 60;
      let loginAttempts = 0;
      while (loginAttempts < maxLoginAttempts) {
        try {
          const currentUrl = await this.driver.getCurrentUrl();
          if (currentUrl.includes("/home") || currentUrl.includes("/explore") || currentUrl.includes("x.com")) {
            const homeLink = await this.driver.findElements(By.css('[data-testid="AppTabBar_Home_Link"]'));
            if (homeLink.length > 0) {
              logger.info("X (Twitter) login detected! Continuing pipeline...");
              return;
            }
          }
        } catch (pollErr) {
          const msg = String(pollErr?.message || "").toLowerCase();
          if (
            msg.includes("invalid session") ||
            msg.includes("invalid session id") ||
            msg.includes("no such window") ||
            msg.includes("chrome not reachable") ||
            msg.includes("transport") ||
            msg.includes("session not created") ||
            msg.includes("session deleted")
          ) {
            throw pollErr;
          }
          // Ignore known transient polling errors and continue waiting for manual login.
        }
        loginAttempts++;
        await sleep(5000);
      }

      throw new Error("Twitter manual login timed out after 5 minutes.");
    } catch (error) {
      logger.error("Error during X (Twitter) login check:", error);
      throw error;
    }
  }

  async fetchTweets(options = {}) {
    const {
      maxRetries = 3,
      retryDelay = 10000,
      reinitializeOnFailure = true,
      folder,
    } = options;

    if (!folder) {
      throw new Error("Folder must be provided to fetchTweets");
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.ensureDriverConnected();
        const matched = await this.switchToTab("x.com");
        if (!matched) {
          logger.info("TwitterService: No matching tab found, opening a new tab...");
          await this.driver.switchTo().newWindow("tab");
        }

        await this.checkRateLimit();
        const { listId, name } = this.getSearchQuery(folder);
        logger.info(`Processing list ID: ${listId} (Type: ${name})`);
        const listUrl = `https://x.com/i/lists/${listId}`;

        let navigationSuccessful = false;
        for (let i = 0; i < 3 && !navigationSuccessful; i++) {
          try {
            await this.driver.get(listUrl);
            await this.driver.wait(until.urlContains(listUrl), 120000);
            navigationSuccessful = true;
          } catch (gotoError) {
            logger.error(
              `Error navigating to ${listUrl} (attempt ${i + 1}): ${gotoError.message
              }`
            );
            if (i < 2) {
              await sleep(5000);
            } else {
              throw gotoError;
            }
          }
        }

        if (!navigationSuccessful) {
          logger.error(
            `Failed to navigate to ${listUrl} after multiple attempts.`
          );
          throw new Error(`Failed to navigate to ${listUrl} after multiple attempts.`);
        }

        const tweets = await this.findContent();
        return tweets;
      } catch (error) {
        logger.error(
          `Attempt ${attempt} failed to fetch tweets: ${error.message}`
        );
        if (attempt < maxRetries) {
          logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
          await sleep(retryDelay);
          if (reinitializeOnFailure) {
            await this.cleanup();
            this.driver = null;
          }
        } else {
          logger.error("Max retries reached. Unable to fetch tweets.");
          throw error;
        }
      }
    }
  }

  async cleanup() {
    try {
      if (this.driver) {
        logger.info("TwitterService: Releasing WebDriver control of debugging browser session");
        // Detach connection by clearing reference without calling quit() to preserve user's browser tabs
        this.driver = null;
      }
    } catch (error) {
      logger.error("Failed to clean up:", error);
    } finally {
      this.driver = null;
      this.isInitialized = false;
    }
  }

  // Cleanup screenshots to prevent disk space issues
  cleanupScreenshots() {
    try {
      const fs = require("fs");
      const files = ["login-error.png", "tweet-failed.png"];
      files.forEach((file) => {
        if (fs.existsSync(file)) {
          fs.unlinkSync(file);
          logger.info(`Cleaned up screenshot: ${file}`);
        }
      });
    } catch (error) {
      logger.warn("Failed to cleanup screenshots:", error);
    }
  }

  async postTweet(text) {
    try {
      await this.ensureDriverConnected();
      const matched = await this.switchToTab("x.com");
      if (!matched) {
        logger.info("TwitterService: No matching tab found, opening a new tab...");
        await this.driver.switchTo().newWindow("tab");
      }

      logger.info("Posting new tweet...");
      await this.driver.get("https://x.com/compose/tweet");

      const tweetTextarea = await this.driver.wait(
        until.elementLocated(By.css('div[data-testid="tweetTextarea_0"]')),
        60000
      );
      await this.driver.wait(until.elementIsVisible(tweetTextarea), 60000);
      await this.driver.wait(until.elementIsEnabled(tweetTextarea), 60000);
      await tweetTextarea.sendKeys(text);
      await sleep(2000);

      await tweetTextarea.sendKeys(Key.chord(Key.CONTROL, Key.ENTER));
      await sleep(2000);
      logger.info("Enter key pressed (using Selenium)");
      return true;
    } catch (error) {
      logger.error("Failed to post tweet:", error);
      try {
        await this.driver.takeScreenshot().then((image) => {
          require("fs").writeFileSync("tweet-failed.png", image, "base64");
        });
      } catch (e) { }
      return false;
    }
  }
}

module.exports = TwitterService;
module.exports.isOfftopicTweet = isOfftopicTweet;
TwitterService.isOfftopicTweet = isOfftopicTweet;
