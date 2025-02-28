const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");

class TwitterService {
  constructor() {
    this.driver = null;
    this.RATE_LIMIT_DELAY = 60000;
    this.lastRequestTime = 0;
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

  async init() {
    try {
      if (!this.driver) {
        let options = new chrome.Options();
        options.addArguments(
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--window-size=1920,1080",
          "--disable-notifications",
          "--disable-gpu",
          "--disable-dev-shm-usage"
        );

        this.driver = await new Builder()
          .forBrowser("chrome")
          .setChromeOptions(options)
          .build();
      }
      await this.login();
    } catch (error) {
      logger.error("Failed to initialize:", error);
      await this.cleanup();
      throw error;
    }
  }

  async findContent() {
    try {
      const THREADS_NEEDED = 10;
      const MAX_SCROLL_ATTEMPTS = 100;
      const SCROLL_PAUSE = 3000;
      const MAX_NO_NEW_TWEETS = 15;
      const INITIAL_LOAD_TIMEOUT = 30000;
      const MIN_TOTAL_WORDS = 40;

      const extractTweetData = async (tweetElement) => {
        if (!tweetElement) return null;

        let quotedTweetText = "";
        try {
          const quoteTweet = await tweetElement.findElement(
            By.xpath('.//*[contains(@href, "/status/")]/ancestor::div[4]')
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
            const href = await linkElement.getAttribute("href");

            links.push(href);
          }
        } catch (e) {}

        let images = [];
        try {
          const imageElements = await tweetElement.findElements(
            By.css('[data-testid="tweetPhoto"] img')
          );
          for (const img of imageElements) {
            images.push(await img.getAttribute("src"));
          }
        } catch (imageError) {}

        let videos = [];
        try {
          const videoElements = await tweetElement.findElements(
            By.css("video")
          );
          for (const video of videoElements) {
            videos.push(await video.getAttribute("src"));
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

        return { text: tweetText, links, images, videos, url, timestamp };
      };

      let collectedContent = [];
      let scrollAttempts = 0;
      let processedTweetIds = new Set();
      let lastHeight = 0;
      let noNewTweetsCount = 0;
      let validTweetsCount = 0;

      try {
        await this.driver.wait(
          until.elementLocated(
            By.css(
              '[data-testid="cellInnerDiv"] > div > div > article[data-testid="tweet"]'
            )
          ),
          INITIAL_LOAD_TIMEOUT
        );
      } catch (error) {
        logger.error("Initial tweet selector not found:", error);
        throw error;
      }

      while (
        scrollAttempts < MAX_SCROLL_ATTEMPTS &&
        validTweetsCount < THREADS_NEEDED
      ) {
        logger.info(
          `Scroll attempt ${
            scrollAttempts + 1
          }/${MAX_SCROLL_ATTEMPTS}, found ${validTweetsCount}/${THREADS_NEEDED} valid content pieces`
        );

        try {
          await this.driver.executeScript(
            "window.scrollTo(0, document.body.scrollHeight);"
          );
        } catch (scrollError) {
          logger.warn("Scrolling failed:", scrollError);
          break;
        }

        await sleep(SCROLL_PAUSE);

        const currentHeight = await this.driver.executeScript(
          "return document.body.scrollHeight;"
        );

        const tweetElements = await this.driver.findElements(
          By.css(
            '[data-testid="cellInnerDiv"] > div > div > article[data-testid="tweet"]'
          )
        );

        if (tweetElements.length > 0) {
          noNewTweetsCount = 0;
        } else {
          noNewTweetsCount++;
          if (noNewTweetsCount >= MAX_NO_NEW_TWEETS) {
            logger.info(
              "No new tweets found after multiple attempts, skipping..."
            );
            break;
          }
        }

        for (const tweetElement of tweetElements) {
          if (validTweetsCount >= THREADS_NEEDED) break;

          try {
            const initialTweetData = await extractTweetData(tweetElement);
            if (!initialTweetData) continue;

            const threadTweets = [initialTweetData];
            let nextContainer = null;

            try {
              nextContainer = await tweetElement.findElement(
                By.xpath("./following-sibling::div")
              );
            } catch (nextError) {}

            while (nextContainer) {
              let nextTweet = null;
              try {
                nextTweet = await nextContainer.findElement(
                  By.css('article[data-testid="tweet"]')
                );
              } catch (findTweetError) {
                break;
              }

              if (!nextTweet) break;

              let originalAuthor = "";
              let nextAuthor = "";

              try {
                originalAuthor = await tweetElement
                  .findElement(By.xpath('.//a[contains(@href, "/status/")]'))
                  .getAttribute("href");
                originalAuthor = originalAuthor.split("/")[3];

                nextAuthor = await nextTweet
                  .findElement(By.xpath('.//a[contains(@href, "/status/")]'))
                  .getAttribute("href");
                nextAuthor = nextAuthor.split("/")[3];
              } catch (authorError) {
                break;
              }

              if (originalAuthor !== nextAuthor) break;

              const nextTweetData = await extractTweetData(nextTweet);
              if (!nextTweetData?.text) break;

              threadTweets.push(nextTweetData);

              try {
                nextContainer = await nextContainer.findElement(
                  By.xpath("./following-sibling::div")
                );
              } catch (nextNextError) {
                nextContainer = null;
              }
            }

            let combinedText = threadTweets.reduce(
              (acc, curr) => acc + (curr.text || ""),
              ""
            );
            let wordCount = combinedText
              .split(/\s+/)
              .filter((word) => word.length > 0).length;

            if (wordCount >= MIN_TOTAL_WORDS) {
              const tweetId = initialTweetData.url
                .split("/status/")[1]
                ?.split("?")[0];
              if (!tweetId || processedTweetIds.has(tweetId)) continue;
              processedTweetIds.add(tweetId);

              collectedContent.push({
                tweets: threadTweets,
                url: initialTweetData.url,
                timestamp: initialTweetData.timestamp,
              });
              validTweetsCount++;
            }
          } catch (processingError) {
            logger.error("Error processing tweet:", processingError);
            continue;
          }
        }

        if (currentHeight === lastHeight) {
          noNewTweetsCount++;
        } else {
          lastHeight = currentHeight;
          noNewTweetsCount = 0;
        }
        scrollAttempts++;
      }

      logger.info(`Collected ${validTweetsCount} valid content pieces`);
      return collectedContent;
    } catch (error) {
      logger.error("Error in findContent:", error);
      throw error;
    }
  }

  async login() {
    try {
      await this.driver.get("https://x.com/login");

      logger.info("Looking for username field...");
      const usernameInput = await this.driver.wait(
        until.elementLocated(By.css('input[autocomplete="username"]')),
        60000
      );
      await this.driver.wait(until.elementIsVisible(usernameInput), 60000);
      await this.driver.wait(until.elementIsEnabled(usernameInput), 60000);
      await usernameInput.sendKeys(config.twitter.username, Key.RETURN);
      logger.info("Username entered");
      await sleep(3000);

      logger.info("Checking for email verification...");
      try {
        const emailInput = await this.driver.wait(
          until.elementLocated(
            By.css('input[type="text"], input[type="email"]')
          ),
          10000
        );
        await this.driver.wait(until.elementIsVisible(emailInput), 10000);
        await this.driver.wait(until.elementIsEnabled(emailInput), 10000);

        if (!config.twitter.email) {
          throw new Error("Email verification required but not configured");
        }
        await emailInput.sendKeys(config.twitter.email, Key.RETURN);
        logger.info("Email entered");
        await sleep(3000);
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
        60000
      );
      await this.driver.wait(until.elementIsVisible(passwordInput), 60000);
      await this.driver.wait(until.elementIsEnabled(passwordInput), 60000);
      await passwordInput.sendKeys(config.twitter.password, Key.RETURN);
      logger.info("Password entered");
      await sleep(5000);

      try {
        await this.driver.wait(async () => {
          try {
            const urlMatches = await until
              .urlMatches(/twitter\.com\/(home|explore)/)
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
    } catch (error) {
      logger.error("Login failed:", error);
      await this.driver.takeScreenshot().then((image) => {
        require("fs").writeFileSync("login-error.png", image, "base64");
      });
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
        if (!this.driver) {
          await this.init();
        }
        await this.checkRateLimit();
        const { listId, name } = this.getSearchQuery(folder);
        logger.info(`Processing list ID: ${listId} (Type: ${name})`);
        const listUrl = `https://x.com/i/lists/${listId}`;

        let navigationSuccessful = false;
        for (let i = 0; i < 3 && !navigationSuccessful; i++) {
          try {
            await this.driver.get(listUrl);
            await this.driver.wait(until.urlIs(listUrl), 120000);
            navigationSuccessful = true;
          } catch (gotoError) {
            logger.error(
              `Error navigating to ${listUrl} (attempt ${i + 1}): ${
                gotoError.message
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
          return;
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
        await this.driver.quit();
      }
    } catch (error) {
      logger.error("Failed to clean up:", error);
    } finally {
      this.driver = null;
    }
  }

  async postTweet(text) {
    try {
      if (!this.driver) {
        logger.info("No active driver, initializing Twitter service...");
        await this.init();
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
    } catch (error) {
      logger.error("Failed to post tweet:", error);
      await this.driver.takeScreenshot().then((image) => {
        require("fs").writeFileSync("tweet-failed.png", image, "base64");
      });
      return false;
    }
  }
}

module.exports = TwitterService;
