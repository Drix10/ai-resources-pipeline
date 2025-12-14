const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");

class TwitterService {
  constructor() {
    this.driver = null;
    this.RATE_LIMIT_DELAY = 60000;
    this.lastRequestTime = 0;
    this.isInitialized = false;
    this.processedTweetIds = new Set();
    this.MAX_PROCESSED_IDS = 10000; // Prevent memory leak
  }

  clearProcessedIds() {
    // Clear old IDs if set gets too large
    if (this.processedTweetIds.size > this.MAX_PROCESSED_IDS) {
      logger.info("Clearing processed tweet IDs to prevent memory leak");
      // Keep the most recent 50% of IDs to prevent immediate duplicate processing
      const idsArray = Array.from(this.processedTweetIds);
      const keptIds = idsArray.slice(Math.floor(idsArray.length / 2));
      this.processedTweetIds = new Set(keptIds);
    }
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
      if (!this.driver || !this.isInitialized) {
        let options = new chrome.Options();

        // Connect to existing Chrome instance with remote debugging
        // This allows controlling your normal browser
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
      const MAX_SCROLL_ATTEMPTS = 100;
      const SCROLL_PAUSE = 3000; // Increased for Twitter to load content
      const MAX_NO_NEW_TWEETS = 5; // Exit faster if stuck
      const INITIAL_LOAD_TIMEOUT = 30000;
      const MIN_TOTAL_WORDS = 15; // Lowered from 40 to capture link-heavy tweets

      const extractTweetData = async (tweetElement, retries = 2) => {
        if (!tweetElement) return null;

        try {
          let quotedTweetText = "";
          try {
            const quoteTweet = await tweetElement.findElement(
              By.xpath('.//*[contains(@href, "/status/")]/ancestor::div[4]')
            );
            quotedTweetText = await quoteTweet
              .findElement(By.css('[data-testid="tweetText"]'))
              .getText();
          } catch (quoteError) {
            // Quote extraction is optional
          }

          let tweetText = "";
          try {
            tweetText = await tweetElement
              .findElement(By.css('[data-testid="tweetText"]'))
              .getText();
          } catch (textError) {
             // Tweet text might be missing (e.g. only image)
          }

          // Validate tweet has actual content
          if (!tweetText && !quotedTweetText) {
            logger.debug("Skipping tweet: No text found");
            return null;
          }

          if (quotedTweetText) {
            tweetText = `${tweetText}\n\nQuoted Tweet:\n${quotedTweetText}`;
          }

          let links = [];
          try {
            const linkElements = await tweetElement.findElements(
              By.tagName("a")
            );
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
        } catch (staleError) {
          // Retry on stale element reference
          if (staleError.name === "StaleElementReferenceError" && retries > 0) {
            await sleep(500);
            return extractTweetData(tweetElement, retries - 1);
          }
          return null;
        }
      };

      let collectedContent = [];
      let scrollAttempts = 0;
      let lastHeight = 0;
      let noNewTweetsCount = 0;
      let validTweetsCount = 0;
      let lastSeenTweetIds = new Set();
      let sameContentCount = 0;
      const MAX_SEEN_TWEETS = 1000; // Prevent memory leak

      // Clear old processed IDs to prevent memory leak
      this.clearProcessedIds();

      // Bring window to front and keep it active
      try {
        await this.driver.executeScript(`
          window.focus();
          // Prevent tab from being throttled
          if (document.hidden) {
            console.log('Tab is hidden, bringing to front');
          }
        `);
      } catch (e) {
        logger.warn("Could not focus window:", e);
      }

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

        const previousValidCount = validTweetsCount;

        try {
          // Keep tab active to prevent Chrome throttling
          await this.driver.executeScript(`
            // Trigger a small interaction to keep tab "active"
            document.body.click();
          `);

          // Anti-throttling: Trick browser into thinking it's active
          await this.driver.executeScript(`
             Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
             Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
          `);

          // Node-driven scroll to avoid background tab throttling
          // Chrome throttles JS in background tabs, but Node.js sleep is safe
          try {
            const viewportHeight = await this.driver.executeScript("return window.innerHeight;");
            const scrollTarget = viewportHeight * 2.5;
            const steps = 15;
            const stepSize = scrollTarget / steps;
            
            for(let i=0; i<steps; i++) {
               await this.driver.executeScript(`window.scrollBy(0, ${stepSize})`);
               await sleep(50); // Safe timing
            }
            await this.driver.executeScript("window.scrollTo(0, document.body.scrollHeight)");
          } catch (e) {
            logger.warn("Scroll interaction failed:", e);
          }
          
          await sleep(3000);
        } catch (scrollError) {
          logger.warn("Scrolling failed:", scrollError);
          break;
        }

        const currentHeight = await this.driver.executeScript(
          "return document.body.scrollHeight;"
        );

        // Get FRESH tweet elements after scrolling
        let tweetElements = [];
        try {
          // Wait for Twitter to render new content after scroll
          await sleep(2000);

          // Get FRESH tweet elements directly from the current DOM state
          // Using a fresh query every time is crucial because scrolling changes the DOM
          const allTweetElements = await this.driver.findElements(
            By.css('article[data-testid="tweet"]')
          );

          // Filter to only visible/displayed elements within the viewport
          for (const el of allTweetElements) {
            try {
              if (await el.isDisplayed()) {
                // relaxed viewport check to ensure we capture elements that are at least partially visible
                const isInViewport = await this.driver.executeScript(`
                  const rect = arguments[0].getBoundingClientRect();
                  return (
                    rect.top < (window.innerHeight || document.documentElement.clientHeight) &&
                    rect.bottom > 0 &&
                    rect.left < (window.innerWidth || document.documentElement.clientWidth) &&
                    rect.right > 0
                  );
                `, el);
                
                if (isInViewport) {
                  tweetElements.push(el);
                }
              }
            } catch (e) {
              // Skip stale elements
            }
          }

          logger.info(
            `Found ${tweetElements.length} visible tweet elements (${allTweetElements.length} total on page)`
          );
        } catch (findError) {
          logger.warn("Failed to find tweet elements:", findError);
          scrollAttempts++;
          continue;
        }

        // Track which tweets we see in this scroll
        const currentTweetIds = new Set();
        let newTweetsFound = 0;

        for (const tweetElement of tweetElements) {
          if (validTweetsCount >= THREADS_NEEDED) break;

          try {
            // Check if element is still attached to DOM
            let isDisplayed = false;
            try {
              isDisplayed = await tweetElement.isDisplayed();
            } catch (staleError) {
              // Element is stale, skip it
              continue;
            }

            if (!isDisplayed) continue;

            const initialTweetData = await extractTweetData(tweetElement);
            if (!initialTweetData) continue;

            // Validate tweet has URL before processing
            if (!initialTweetData.url || initialTweetData.url.trim() === "") {
              logger.warn("Tweet missing URL, skipping");
              continue;
            }

            // Check if we've already processed this tweet
            const tweetId = initialTweetData.url
              .split("/status/")[1]
              ?.split("?")[0];
            if (!tweetId) {
              logger.warn(
                "Could not extract tweet ID from URL:",
                initialTweetData.url
              );
              continue;
            }

            // Track this tweet ID
            currentTweetIds.add(tweetId);

            // Check if we've seen this tweet in a previous scroll
            if (!lastSeenTweetIds.has(tweetId)) {
              newTweetsFound++;
            }

            if (this.processedTweetIds.has(tweetId)) {
              continue;
            }

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
                const originalHref = await tweetElement
                  .findElement(By.xpath('.//a[contains(@href, "/status/")]'))
                  .getAttribute("href");

                const nextHref = await nextTweet
                  .findElement(By.xpath('.//a[contains(@href, "/status/")]'))
                  .getAttribute("href");

                if (!originalHref || !nextHref) {
                  break;
                }

                const originalParts = originalHref.split("/");
                const nextParts = nextHref.split("/");

                if (originalParts.length < 4 || nextParts.length < 4) {
                  break;
                }

                originalAuthor = originalParts[3];
                nextAuthor = nextParts[3];
              } catch (authorError) {
                break;
              }

              if (
                !originalAuthor ||
                !nextAuthor ||
                originalAuthor !== nextAuthor
              )
                break;

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

            // Validate combined text is not empty
            if (!combinedText || combinedText.trim().length === 0) {
              continue;
            }

            let wordCount = combinedText
              .split(/\s+/)
              .filter((word) => word.length > 0).length;

            const hasMediaOrLinks = threadTweets.some(
              (t) =>
                (t.links && t.links.length > 0) ||
                (t.images && t.images.length > 0) ||
                (t.videos && t.videos.length > 0)
            );

            if (wordCount >= MIN_TOTAL_WORDS || hasMediaOrLinks) {
              // Mark as processed only if it meets criteria
              this.processedTweetIds.add(tweetId);

              collectedContent.push({
                tweets: threadTweets,
                url: initialTweetData.url,
                timestamp: initialTweetData.timestamp,
              });
              validTweetsCount++;
            } else {
              // Don't mark as processed if it doesn't meet word count
              // It might be part of a longer thread we haven't seen yet
              logger.debug(
                `Tweet ${tweetId} only has ${wordCount} words, skipping for now`
              );
            }
          } catch (processingError) {
            logger.error("Error processing tweet:", processingError);
            continue;
          }
        }

        // Check if we found ANY new tweets (not just valid ones)
        if (newTweetsFound > 0) {
          logger.info(`Found ${newTweetsFound} NEW tweets in this scroll`);
          sameContentCount = 0;

          // Add new IDs but prevent unbounded growth
          currentTweetIds.forEach((id) => lastSeenTweetIds.add(id));

          // Clear old IDs if set gets too large
          if (lastSeenTweetIds.size > MAX_SEEN_TWEETS) {
            logger.warn(
              `lastSeenTweetIds exceeded ${MAX_SEEN_TWEETS}, clearing old entries`
            );
            // Keep only the most recent IDs
            const recentIds = Array.from(lastSeenTweetIds).slice(-500);
            lastSeenTweetIds = new Set(recentIds);
          }
        } else {
          sameContentCount++;
          logger.warn(
            `No new tweets found (${sameContentCount} times in a row)`
          );
          if (sameContentCount >= 10) {
            logger.info(
              "Page not loading new content after 10 scrolls, stopping..."
            );
            break;
          }
        }

        // Check if we found new valid tweets in this scroll
        if (validTweetsCount > previousValidCount) {
          noNewTweetsCount = 0; // Reset counter when we find new valid content
        } else if (currentHeight === lastHeight) {
          noNewTweetsCount++;
          if (noNewTweetsCount >= MAX_NO_NEW_TWEETS) {
            logger.info(
              "No new valid content found after multiple scrolls, stopping..."
            );
            break;
          }
        } else {
          lastHeight = currentHeight;
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
      // First check if already logged in
      await this.driver.get("https://x.com/home");
      await sleep(3000);

      try {
        // Check if we're already on the home page (logged in)
        await this.driver.wait(
          until.elementLocated(By.css('[data-testid="AppTabBar_Home_Link"]')),
          5000
        );
        logger.info("Already logged in, skipping login process");
        return;
      } catch (e) {
        logger.info("Not logged in, proceeding with login...");
      }

      await this.driver.get("https://x.com/login");
      await sleep(5000); // Wait for page to fully load

      logger.info("Looking for username field...");
      const usernameInput = await this.driver.wait(
        until.elementLocated(By.css('input[autocomplete="username"]')),
        60000
      );
      await this.driver.wait(until.elementIsVisible(usernameInput), 60000);
      await this.driver.wait(until.elementIsEnabled(usernameInput), 60000);

      // Type slowly to avoid bot detection
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
            By.css('input[type="text"], input[type="email"]')
          ),
          10000
        );
        await this.driver.wait(until.elementIsVisible(emailInput), 10000);
        await this.driver.wait(until.elementIsEnabled(emailInput), 10000);

        if (!config.twitter.email) {
          throw new Error("Email verification required but not configured");
        }

        // Type slowly to avoid bot detection
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
        60000
      );
      await this.driver.wait(until.elementIsVisible(passwordInput), 60000);
      await this.driver.wait(until.elementIsEnabled(passwordInput), 60000);

      // Type slowly to avoid bot detection
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

      logger.info("Rechecking for email verification...");
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
        if (!this.driver || !this.isInitialized) {
          await this.init();
        }

        // Verify driver is still connected
        try {
          await this.driver.getTitle();
        } catch (driverError) {
          logger.warn("Driver disconnected, reinitializing...");
          this.isInitialized = false;
          await this.cleanup();
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
            await this.driver.wait(until.urlContains(listUrl), 120000);
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
          return null;
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
