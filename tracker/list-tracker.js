const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const axios = require("axios");
const config = require("../config");
const { logger, sleep } = require("../src/utils/helpers");

// Validate required configuration
if (!config.twitter.username) {
  throw new Error("TWITTER_USERNAME must be configured in .env");
}
if (!config.twitter.password) {
  throw new Error("TWITTER_PASSWORD must be configured in .env");
}
if (!config.monitoring.targetListId) {
  throw new Error("MONITOR_LIST_ID must be configured in .env");
}
if (!config.discord.webhookUrl) {
  throw new Error("DISCORD_WEBHOOK_URL must be configured");
}

const LIST_ID = config.monitoring.targetListId;
const LIST_URL = `https://x.com/i/lists/${LIST_ID}`;
const DISCORD_WEBHOOK_URL = config.discord.webhookUrl;
const CHECK_INTERVAL = config.monitoring.checkInterval; // Use config system, not process.env directly

class TwitterListTracker {
  constructor() {
    this.driver = null;
    this.lastRequestTime = 0;
    this.isInitialized = false;
    this.processedTweetIds = new Set();
    this.MAX_PROCESSED_IDS = 10000;
    this.lastSuccessfulCheck = Date.now();
    this.browserStartTime = null;
    this.consecutiveFailures = 0;
    this.initRetries = 0;
    this.MAX_INIT_RETRIES = 3;
  }

  clearProcessedIds() {
    if (this.processedTweetIds.size > this.MAX_PROCESSED_IDS) {
      logger.info("Clearing processed tweet IDs to prevent memory leak");
      const idsArray = Array.from(this.processedTweetIds);
      const keptIds = idsArray.slice(Math.floor(idsArray.length / 2));
      this.processedTweetIds = new Set(keptIds);
    }
  }

  async init() {
    try {
      if (!this.driver || !this.isInitialized) {
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
            "Failed to connect to Chrome. Make sure Chrome is running with: chrome --remote-debugging-port=9222",
          );
          throw new Error(
            "Chrome not running with remote debugging. Run start.ps1 first",
          );
        }

        this.browserStartTime = Date.now();
      }

      // Verify driver is still connected
      try {
        await this.driver.getTitle();
        this.initRetries = 0; // Reset on success
      } catch (driverError) {
        logger.warn("Driver disconnected, reinitializing...");
        this.isInitialized = false;
        this.driver = null;

        // Prevent infinite recursion
        if (this.initRetries >= this.MAX_INIT_RETRIES) {
          throw new Error(
            `Failed to initialize driver after ${this.MAX_INIT_RETRIES} attempts`,
          );
        }
        this.initRetries++;
        await sleep(2000);
        return this.init();
      }

      await this.login();
    } catch (error) {
      logger.error("Failed to initialize:", error);
      this.isInitialized = false;
      await this.cleanup();
      throw error;
    }
  }

  async shouldRefreshBrowser() {
    const browserAge = Date.now() - this.browserStartTime;
    const timeSinceLastSuccess = Date.now() - this.lastSuccessfulCheck;

    return (
      browserAge > 2 * 60 * 60 * 1000 ||
      this.consecutiveFailures >= 5 ||
      timeSinceLastSuccess > 30 * 60 * 1000
    );
  }

  async refreshBrowser() {
    logger.info("Refreshing browser session to prevent issues...");
    try {
      if (this.driver) {
        await this.driver.quit();
      }
    } catch (error) {
      logger.warn("Error quitting driver during refresh:", error);
    }
    this.isInitialized = false;
    this.driver = null;
    await sleep(5000);
    await this.init();
    this.consecutiveFailures = 0;
  }

  async login() {
    try {
      await this.driver.get("https://x.com/home");
      await sleep(3000);

      try {
        await this.driver.wait(
          until.elementLocated(By.css('[data-testid="AppTabBar_Home_Link"]')),
          5000,
        );
        logger.info("Already logged in, skipping login process");
        return;
      } catch (e) {
        logger.info("Not logged in, proceeding with login...");
      }

      await this.driver.get("https://x.com/login");
      await sleep(5000);

      logger.info("Looking for username field...");
      const usernameInput = await this.driver.wait(
        until.elementLocated(By.css('input[autocomplete="username"]')),
        60000,
      );
      await this.driver.wait(until.elementIsVisible(usernameInput), 60000);
      await this.driver.wait(until.elementIsEnabled(usernameInput), 60000);

      for (const char of config.twitter.username) {
        await usernameInput.sendKeys(char);
        await sleep(100 + Math.random() * 100);
      }
      await sleep(1000);
      await usernameInput.sendKeys(Key.RETURN);
      logger.info("Username entered");
      await sleep(5000);

      logger.info("Checking for email verification...");
      try {
        const emailInput = await this.driver.wait(
          until.elementLocated(
            By.css('input[type="text"], input[type="email"]'),
          ),
          10000,
        );
        await this.driver.wait(until.elementIsVisible(emailInput), 10000);
        await this.driver.wait(until.elementIsEnabled(emailInput), 10000);

        if (!config.twitter.email) {
          throw new Error("Email verification required but not configured");
        }

        for (const char of config.twitter.email) {
          await emailInput.sendKeys(char);
          await sleep(100 + Math.random() * 100);
        }
        await sleep(1000);
        await emailInput.sendKeys(Key.RETURN);
        logger.info("Email entered");
        await sleep(5000);
      } catch (emailError) {
        if (emailError.name === "TimeoutError") {
          logger.info("Email verification not required.");
        } else {
          throw emailError;
        }
      }

      logger.info("Looking for password field...");
      const passwordInput = await this.driver.wait(
        until.elementLocated(By.css('input[type="password"]')),
        60000,
      );
      await this.driver.wait(until.elementIsVisible(passwordInput), 60000);
      await this.driver.wait(until.elementIsEnabled(passwordInput), 60000);

      for (const char of config.twitter.password) {
        await passwordInput.sendKeys(char);
        await sleep(100 + Math.random() * 100);
      }
      await sleep(1000);
      await passwordInput.sendKeys(Key.RETURN);
      logger.info("Password entered");
      await sleep(8000);

      try {
        await this.driver.wait(async () => {
          try {
            const urlMatches = await until
              .urlMatches(/x\.com\/(home|explore)/)
              .fn(this.driver);
            if (urlMatches) return true;

            const elementLocated = await until
              .elementLocated(By.css('[data-testid="AppTabBar_Home_Link"]'))
              .fn(this.driver);
            if (elementLocated) return true;

            return false;
          } catch (e) {
            if (
              e.name === "StaleElementReferenceError" ||
              e.name === "NoSuchElementError"
            ) {
              return false;
            }
            throw e;
          }
        }, 60000);
        logger.info("Login successful");
      } catch (loginCheckError) {
        logger.error("Login verification failed:", loginCheckError);
        await this.driver.takeScreenshot().then((image) => {
          require("fs").writeFileSync("login-error.png", image, "base64");
        });
        throw new Error("Login failed - could not verify successful login");
      }

      logger.info("Rechecking for email verification...");
      try {
        const emailInput = await this.driver.wait(
          until.elementLocated(
            By.css('input[type="text"], input[type="email"]'),
          ),
          10000,
        );
        await this.driver.wait(until.elementIsVisible(emailInput), 10000);
        await this.driver.wait(until.elementIsEnabled(emailInput), 10000);

        if (!config.twitter.email) {
          throw new Error("Email verification required but not configured");
        }

        for (const char of config.twitter.email) {
          await emailInput.sendKeys(char);
          await sleep(100 + Math.random() * 100);
        }
        await sleep(1000);
        await emailInput.sendKeys(Key.RETURN);
        logger.info("Email entered (second check)");
        await sleep(3000);
      } catch (emailError) {
        if (emailError.name === "TimeoutError") {
          logger.info("Email verification not required (second check).");
        } else {
          throw emailError;
        }
      }
    } catch (error) {
      logger.error("Login failed:", error);
      await this.driver.takeScreenshot().then((image) => {
        require("fs").writeFileSync("login-error.png", image, "base64");
      });
      throw error;
    }
  }

  async getLatestTweets(retryCount = 0) {
    const maxRetries = 3;
    try {
      // No rate limit check - we control timing with CHECK_INTERVAL

      // Navigate to list
      let navigationSuccessful = false;
      for (let i = 0; i < 3 && !navigationSuccessful; i++) {
        try {
          await this.driver.get(LIST_URL);
          await this.driver.wait(until.urlContains(LIST_URL), 120000);
          navigationSuccessful = true;
        } catch (gotoError) {
          logger.error(
            `Error navigating to ${LIST_URL} (attempt ${i + 1}): ${gotoError.message}`,
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
          `Failed to navigate to ${LIST_URL} after multiple attempts.`,
        );
        return [];
      }

      await sleep(3000);

      // Wait for tweets to load
      try {
        await this.driver.wait(
          until.elementLocated(
            By.css(
              '[data-testid="cellInnerDiv"] > div > div > article[data-testid="tweet"]',
            ),
          ),
          30000,
        );
      } catch (error) {
        logger.error("Initial tweet selector not found:", error);
        if (retryCount < maxRetries) {
          await sleep(5000);
          return this.getLatestTweets(retryCount + 1);
        }
        return [];
      }

      // Get all visible tweets
      const allTweetElements = await this.driver.findElements(
        By.css('article[data-testid="tweet"]'),
      );

      const newTweets = [];

      for (const tweetElement of allTweetElements) {
        try {
          const isDisplayed = await tweetElement.isDisplayed();
          if (!isDisplayed) continue;

          const tweetData = await this.extractTweetData(tweetElement);
          if (!tweetData) continue;

          if (!tweetData.url || tweetData.url.trim() === "") {
            continue;
          }

          const tweetId = tweetData.url.split("/status/")[1]?.split("?")[0];
          if (!tweetId) {
            continue;
          }

          // Skip if already processed
          if (this.processedTweetIds.has(tweetId)) {
            continue;
          }

          // Validate has content
          const hasContent =
            (tweetData.text && tweetData.text.trim() !== "") ||
            (tweetData.images && tweetData.images.length > 0) ||
            (tweetData.videos && tweetData.videos.length > 0);

          if (!hasContent) {
            continue;
          }

          // Mark as processed
          this.processedTweetIds.add(tweetId);
          newTweets.push(tweetData);

          logger.info(`Found new tweet: ${tweetId}`);
        } catch (processingError) {
          logger.error("Error processing tweet:", processingError);
          continue;
        }
      }

      return newTweets;
    } catch (error) {
      logger.error(
        `Error in getLatestTweets (attempt ${retryCount + 1}/${maxRetries + 1}):`,
        error.message,
      );
      if (retryCount < maxRetries) {
        await sleep(30000);
        return this.getLatestTweets(retryCount + 1);
      }
      logger.error("Max retries reached in getLatestTweets");
      return [];
    }
  }

  async extractTweetData(tweetElement, retries = 2) {
    try {
      let quotedTweetText = "";
      try {
        const quoteTweet = await tweetElement.findElement(
          By.xpath('.//*[contains(@href, "/status/")]/ancestor::div[4]'),
        );
        quotedTweetText = await quoteTweet
          .findElement(By.css('[data-testid="tweetText"]'))
          .getText();
      } catch (quoteError) {}

      let tweetText = "";
      try {
        tweetText = await tweetElement
          .findElement(By.css('[data-testid="tweetText"]'))
          .getText();
      } catch (textError) {}

      if (quotedTweetText) {
        tweetText = `${tweetText}\n\nQuoted Tweet:\n${quotedTweetText}`;
      }

      let links = [];
      try {
        const linkElements = await tweetElement.findElements(By.tagName("a"));
        for (const linkElement of linkElements) {
          try {
            const href = await linkElement.getAttribute("href");
            if (href) links.push(href);
          } catch (e) {
            continue;
          }
        }
      } catch (e) {}

      let images = [];
      try {
        const imageElements = await tweetElement.findElements(
          By.css('[data-testid="tweetPhoto"] img'),
        );
        for (const img of imageElements) {
          try {
            const src = await img.getAttribute("src");
            if (src) images.push(src);
          } catch (e) {
            continue;
          }
        }
      } catch (imageError) {}

      let videos = [];
      try {
        const videoElements = await tweetElement.findElements(By.css("video"));
        for (const video of videoElements) {
          try {
            const src = await video.getAttribute("src");
            if (src) videos.push(src);
          } catch (e) {
            continue;
          }
        }
      } catch (videoError) {}

      let url = "";
      try {
        url = await tweetElement
          .findElement(By.xpath('.//a[contains(@href, "/status/")]'))
          .getAttribute("href");
      } catch (urlError) {}

      let timestamp = "";
      try {
        timestamp = await tweetElement
          .findElement(By.tagName("time"))
          .getAttribute("datetime");
      } catch (timeError) {}

      let author = "";
      try {
        const authorElement = await tweetElement.findElement(
          By.css('[data-testid="User-Name"] a'),
        );
        const authorHref = await authorElement.getAttribute("href");
        if (authorHref) {
          const parts = authorHref.split("/").filter(Boolean);
          author = parts.length > 0 ? parts[parts.length - 1] : "";
        }
      } catch (authorError) {}

      const tweetId = url ? url.split("/status/")[1]?.split("?")[0] : "";

      if (!tweetId) {
        return null;
      }

      return {
        id: tweetId,
        text: tweetText,
        url: url,
        links: links,
        images: images,
        videos: videos,
        timestamp: timestamp,
        author: author,
      };
    } catch (error) {
      if (error.name === "StaleElementReferenceError" && retries > 0) {
        await sleep(500);
        return this.extractTweetData(tweetElement, retries - 1);
      }
      logger.error("Error extracting tweet data:", error);
      return null;
    }
  }

  shouldSendTweet(tweetText) {
    if (config.monitoring.sendAllTweets) {
      return { send: true, reason: "sendAllTweets enabled" };
    }

    if (
      !config.monitoring.keywords ||
      config.monitoring.keywords.length === 0
    ) {
      return { send: true, reason: "no keywords configured, sending all" };
    }

    const tweetTextLower = tweetText.toLowerCase();
    const matchedKeywords = config.monitoring.keywords.filter((keyword) =>
      tweetTextLower.includes(keyword.toLowerCase()),
    );

    if (matchedKeywords.length > 0) {
      return {
        send: true,
        reason: `contains keywords: ${matchedKeywords.join(", ")}`,
      };
    }

    return {
      send: false,
      reason: `no matching keywords (looking for: ${config.monitoring.keywords.join(", ")})`,
    };
  }

  async sendToDiscord(tweet) {
    try {
      // Truncate description to Discord's 4096 char limit
      const maxDescLength = 4000; // Leave room for "... (truncated)"
      let description = tweet.text || "No text content";
      if (description.length > maxDescLength) {
        description =
          description.substring(0, maxDescLength) + "... (truncated)";
      }

      const embed = {
        title: `🐦 New tweet from @${tweet.author || "unknown"}`,
        url: tweet.url,
        description: description,
        color: 0x1da1f2,
        footer: {
          text: "List Tracker • " + new Date().toLocaleString(),
        },
      };

      if (tweet.images && tweet.images.length > 0) {
        embed.image = { url: tweet.images[0] };
        if (tweet.images.length > 1) {
          embed.footer.text += ` • ${tweet.images.length} images`;
        }
      }

      if (tweet.videos && tweet.videos.length > 0) {
        embed.footer.text += ` • ${tweet.videos.length} videos`;
      }

      if (tweet.timestamp) {
        embed.timestamp = tweet.timestamp;
      }

      const payload = {
        embeds: [embed],
      };

      const response = await axios.post(DISCORD_WEBHOOK_URL, payload, {
        timeout: 10000,
      });

      if (response.status === 204) {
        logger.info("Discord webhook sent successfully!");
        return true;
      } else {
        logger.warn(`Failed to send webhook: ${response.status}`);
        return false;
      }
    } catch (error) {
      logger.error("Error sending to Discord:", error.message);
      return false;
    }
  }

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

  async startTracking() {
    logger.info(`Starting Twitter List Tracker`);
    logger.info(`List ID: ${LIST_ID}`);
    logger.info(`List URL: ${LIST_URL}`);
    logger.info(`Check interval: ${CHECK_INTERVAL / 1000} seconds`);
    logger.info(
      `Discord webhook configured: ${DISCORD_WEBHOOK_URL ? "Yes" : "No"}`,
    );

    if (config.monitoring.sendAllTweets) {
      logger.info(`Notification mode: ALL TWEETS`);
    } else if (
      config.monitoring.keywords &&
      config.monitoring.keywords.length > 0
    ) {
      logger.info(
        `Keywords to monitor: ${config.monitoring.keywords.join(", ")}`,
      );
    } else {
      logger.info(`Notification mode: ALL TWEETS (no keywords configured)`);
    }

    try {
      await this.init();
      await sleep(2000);

      logger.info("Getting initial tweets for baseline...");
      const initialTweets = await this.getLatestTweets();
      logger.info(`Baseline set with ${initialTweets.length} tweets`);

      logger.info(
        `\nStarting tracking loop (checking every ${CHECK_INTERVAL / 1000}s)...\n`,
      );

      let checkCount = 0;
      while (true) {
        try {
          checkCount++;
          logger.info(
            `\nCheck #${checkCount} - ${new Date().toLocaleTimeString()}`,
          );

          // Periodic cleanup
          if (checkCount % 100 === 0) {
            this.clearProcessedIds();
            this.cleanupScreenshots();
          }

          if (await this.shouldRefreshBrowser()) {
            await this.refreshBrowser();
          }

          const tweets = await this.getLatestTweets();

          if (tweets.length === 0) {
            logger.info("No new tweets found");
            this.consecutiveFailures = 0;
            this.lastSuccessfulCheck = Date.now();
          } else {
            logger.info(`\n🆕 Found ${tweets.length} new tweet(s)!`);

            for (const tweet of tweets) {
              logger.info(`\nTweet ID: ${tweet.id}`);
              logger.info(`Author: @${tweet.author || "unknown"}`);
              logger.info(`Content: ${tweet.text || "(media only)"}`);
              logger.info(`URL: ${tweet.url}`);
              logger.info(
                `Media: ${tweet.images.length} images, ${tweet.videos.length} videos`,
              );

              const shouldSendTweet = this.shouldSendTweet(tweet.text || "");

              if (shouldSendTweet.send) {
                logger.info(
                  `Tweet matches criteria (${shouldSendTweet.reason}) - sending notification!`,
                );
                const sent = await this.sendToDiscord(tweet);
                if (sent) {
                  logger.info("✅ Notification sent to Discord successfully");
                } else {
                  logger.warn("❌ Failed to send notification to Discord");
                }
              } else {
                logger.info(
                  `Tweet does not match criteria (${shouldSendTweet.reason}) - skipping notification`,
                );
              }
            }

            this.consecutiveFailures = 0;
            this.lastSuccessfulCheck = Date.now();
          }
        } catch (error) {
          logger.error(`Error during check #${checkCount}:`, error.message);
          this.consecutiveFailures++;

          if (this.consecutiveFailures >= 10) {
            logger.error(
              "Too many consecutive failures, attempting full recovery...",
            );
            try {
              await this.refreshBrowser();
              this.consecutiveFailures = 0;
            } catch (recoveryError) {
              logger.error("Recovery failed:", recoveryError);
            }
          }
        }

        logger.info(
          `Waiting ${CHECK_INTERVAL / 1000} seconds until next check...`,
        );
        await sleep(CHECK_INTERVAL);
      }
    } catch (error) {
      logger.error("Fatal error in tracking:", error);
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.driver) {
        await this.driver.quit();
        logger.info("WebDriver session closed");
      }
    } catch (error) {
      logger.error("Failed to clean up:", error);
    } finally {
      this.cleanupScreenshots();
      this.driver = null;
      this.isInitialized = false;
      logger.info("Cleanup completed");
    }
  }
}

// Global error handlers
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`\nReceived ${signal}. Shutting down gracefully...`);

  // Set a forced exit timeout
  const forceExitTimeout = setTimeout(() => {
    logger.error("Forced exit after timeout");
    process.exit(1);
  }, 10000); // 10 second timeout

  try {
    if (tracker) {
      await tracker.cleanup();
    }
    clearTimeout(forceExitTimeout);
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (error) {
    logger.error("Error during shutdown:", error);
    clearTimeout(forceExitTimeout);
    process.exit(1);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  // Start graceful shutdown without awaiting to avoid blocking
  gracefulShutdown("uncaughtException").catch(() => {});
  // Ensure forced exit as fallback
  setTimeout(() => process.exit(1), 10000);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Start graceful shutdown without awaiting to avoid blocking
  gracefulShutdown("unhandledRejection").catch(() => {});
  // Ensure forced exit as fallback
  setTimeout(() => process.exit(1), 10000);
});

// Start the tracker
const tracker = new TwitterListTracker();
tracker.startTracking().catch(async (error) => {
  logger.error("Fatal error:", error);
  await tracker.cleanup();
  process.exit(1);
});
