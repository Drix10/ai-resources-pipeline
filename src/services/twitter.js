const puppeteer = require("puppeteer");
const config = require("../../config");
const { Tweet } = require("../utils/dbConnection");
const { logger, sleep } = require("../utils/helpers");

class RateLimiter {
  constructor() {
    this.requestDelay = 2000;
    this.lastRequest = Date.now();
    this.consecutiveErrors = 0;
    this.baseDelay = 2000;
  }

  async waitForNext() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;

    if (this.consecutiveErrors > 0) {
      this.requestDelay = this.baseDelay * Math.pow(2, this.consecutiveErrors);
      this.requestDelay = Math.min(this.requestDelay, 30000);
    } else {
      this.requestDelay = this.baseDelay;
    }

    if (timeSinceLastRequest < this.requestDelay) {
      await sleep(this.requestDelay - timeSinceLastRequest);
    }

    this.lastRequest = Date.now();
  }

  handleError() {
    this.consecutiveErrors++;
  }

  handleSuccess() {
    this.consecutiveErrors = 0;
  }
}

class TwitterService {
  constructor() {
    this.browser = null;
    this.page = null;
    this.rateLimiter = new RateLimiter();

    this.threadIndicators = [
      "🧵",
      "Thread",
      "1/",
      "1:",
      "1)",
      "(1/",
      "A thread on",
      "Starting a thread",
      "Here's a list",
      "Top resources",
      "Resources for",
      "Collection of",
      "Comprehensive guide",
      "Ultimate guide",
      "Best resources",
      "Must-have resources",
      "Quick thread",
      "Thread:",
      "🔥 Thread",
      "New thread",
      "Important thread",
      "Mini thread",
      "Tips thread",
      "Tutorial thread",
      "Hilo",
      "thread",
      "スレッド",
    ];

    this.searchQueriesType1 = [
      "ai tools thread 🧵",
      "artificial intelligence news thread",
      "chatgpt tips thread",
      "ai automation guide 🧵",
      "machine learning tools thread",
      "ai productivity tools 🧵",
      "filter:links new ai tools",
      "ai developments thread",
      "generative ai guide 1/",
      "ai models comparison (1/",
      "ai research findings thread",
      "llm developments 🧵",
      "ai tools comparison thread",
      "future of ai thread",
    ];

    this.searchQueriesType2 = [
      "coding best practices 🧵",
      "software architecture thread",
      "developer tools guide",
      "programming tips 🧵",
      "backend development thread",
      "frontend frameworks 🧵",
      "filter:links coding resources",
      "system design tips thread",
      "database optimization 1/",
      "clean code guide 🧵",
      "web development tools thread",
      "devops practices 🧵",
      "coding patterns thread",
      "microservices guide thread",
    ];

    this.searchQueriesType3 = [
      "passive income guide 🧵",
      "productivity system thread",
      "digital tools thread",
      "work optimization 🧵",
      "side business guide thread",
      "freelancing success 🧵",
      "filter:links productivity stack",
      "remote work tools thread",
      "business automation 1/",
      "digital nomad guide 🧵",
      "online business thread",
      "time management system 🧵",
      "wealth building guide thread",
      "personal finance tips 🧵",
    ];

    this.currentQueryIndex = 0;
    this.currentTypeIndex = 0;

    this.searchParams = {
      latest: "&f=live",
      top: "&f=top",
      media: "&f=image",
    };
  }

  getNextSearchQuery() {
    const types = [
      this.searchQueriesType1,
      this.searchQueriesType2,
      this.searchQueriesType3,
    ];

    if (this.currentQueryIndex >= types[this.currentTypeIndex].length) {
      this.currentQueryIndex = 0;
      this.currentTypeIndex = (this.currentTypeIndex + 1) % types.length;
    }

    const selectedType = types[this.currentTypeIndex];
    const selectedQuery = selectedType[this.currentQueryIndex];

    this.currentQueryIndex++;

    const searchFilter =
      Date.now() % 2 === 0 ? this.searchParams.latest : this.searchParams.top;

    return selectedQuery + searchFilter;
  }

  async init() {
    try {
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          headless: "new", //false,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--window-size=1920,1080",
            "--disable-notifications",
            "--disable-gpu",
            "--disable-dev-shm-usage",
          ],
          defaultViewport: {
            width: 1920,
            height: 1080,
          },
        });
      }

      if (!this.page) {
        this.page = await this.browser.newPage();
        this.page.setDefaultNavigationTimeout(60000);
        this.page.setDefaultTimeout(60000);
      }
    } catch (error) {
      logger.error("Failed to initialize:", error);
      await this.cleanup();
      throw error;
    }
  }

  async findThreadStarters() {
    try {
      await this.page.waitForFunction(
        () =>
          document.querySelectorAll('article[data-testid="tweet"]').length > 0,
        { timeout: 15000 }
      );

      const THREADS_NEEDED = 10;
      const MAX_SCROLL_ATTEMPTS = 1500;
      const SCROLL_PAUSE = 3000;
      let processedThreads = [];
      let seenUrls = new Set();
      let scrollAttempts = 0;
      let consecutiveEmptyScrolls = 0;

      while (
        scrollAttempts < MAX_SCROLL_ATTEMPTS &&
        processedThreads.length < THREADS_NEEDED
      ) {
        logger.info(
          `Scroll attempt ${scrollAttempts + 1}/${MAX_SCROLL_ATTEMPTS}, found ${
            processedThreads.length
          }/${THREADS_NEEDED} threads`
        );

        await this.page.evaluate(() => {
          window.scrollBy(0, window.innerHeight * 2);
        });
        await sleep(SCROLL_PAUSE);

        const threadStarters = await this.page.evaluate(() => {
          const tweets = Array.from(
            document.querySelectorAll('article[data-testid="tweet"]')
          );

          return tweets
            .map((tweet) => {
              try {
                const tweetText = tweet
                  .querySelector('[data-testid="tweetText"]')
                  ?.innerText?.trim();
                if (!tweetText) return null;

                const tweetUrl = tweet.querySelector(
                  'a[href*="/status/"]'
                )?.href;
                if (!tweetUrl) return null;

                const timestamp = tweet
                  .querySelector("time")
                  ?.getAttribute("datetime");
                if (!timestamp) return null;

                const isThread =
                  tweetText.includes("🧵") ||
                  tweetText.toLowerCase().includes("thread") ||
                  /1\/|part 1|step 1|\(1\)/.test(tweetText) ||
                  tweetText.split("\n").length > 3;

                if (!isThread) return null;

                const getMetric = (selector) => {
                  const text =
                    tweet.querySelector(`div[data-testid="${selector}"]`)
                      ?.textContent || "0";
                  return parseInt(text.replace(/[k,m]/gi, "")) || 0;
                };

                const engagement = {
                  likes: getMetric("like"),
                  retweets: getMetric("retweet"),
                  replies: getMetric("reply"),
                };

                const qualityScore =
                  engagement.likes +
                  engagement.retweets * 2 +
                  engagement.replies * 1.5;

                return {
                  url: tweetUrl,
                  text: tweetText,
                  timestamp,
                  engagement,
                  qualityScore,
                };
              } catch (error) {
                return null;
              }
            })
            .filter(Boolean);
        });

        if (threadStarters.length === 0) {
          consecutiveEmptyScrolls++;
          logger.info(
            `No new tweets found in scroll attempt ${
              scrollAttempts + 1
            }, consecutive empty scrolls: ${consecutiveEmptyScrolls}`
          );

          if (consecutiveEmptyScrolls >= 3) {
            logger.info(
              "Three consecutive empty scrolls, moving to next query"
            );
            break;
          }
        } else {
          consecutiveEmptyScrolls = 0;
        }

        for (const thread of threadStarters) {
          if (processedThreads.length >= THREADS_NEEDED) break;

          try {
            if (seenUrls.has(thread.url)) {
              logger.debug(`Skipping duplicate URL: ${thread.url}`);
              continue;
            }
            seenUrls.add(thread.url);

            const tweetId = thread.url.split("/status/")[1]?.split("?")[0];
            if (!tweetId) continue;

            const existingTweet = await Tweet.findOne({ id: tweetId });

            if (!existingTweet) {
              const fullThread = await this.collectFullThread(thread.url);

              if (fullThread && fullThread.length > 0) {
                try {
                  await Tweet.findOneAndUpdate(
                    { id: tweetId },
                    {
                      $setOnInsert: {
                        id: tweetId,
                        url: thread.url,
                        text: thread.text,
                        timestamp: new Date(thread.timestamp),
                        status: "processed",
                        query: this.currentQuery,
                        processed_at: new Date(),
                        tweets: fullThread,
                      },
                    },
                    { upsert: true, new: true }
                  );

                  processedThreads.push({
                    ...thread,
                    tweets: fullThread,
                  });

                  logger.info(
                    `Found: ${thread.url} (${processedThreads.length}/${THREADS_NEEDED})`
                  );
                } catch (dbError) {
                  if (dbError.code !== 11000) {
                    logger.error(
                      `Database operation failed for ${thread.url}:`,
                      dbError
                    );
                  }
                }
              } else {
                logger.debug(
                  `Thread ${thread.url} had no content or failed to collect`
                );
              }
            } else {
              logger.debug(`Skipping already processed tweet: ${thread.url}`);
            }
          } catch (error) {
            logger.error(`Error processing thread ${thread.url}:`, error);
          }
        }

        scrollAttempts++;
      }

      if (processedThreads.length < THREADS_NEEDED) {
        logger.info(
          `Finished with ${processedThreads.length} threads after ${scrollAttempts} scrolls`
        );
      }

      return processedThreads;
    } catch (error) {
      logger.error("Error in findThreadStarters:", error);
      await this.takeDebugScreenshot("thread-finder-error");
      return [];
    }
  }

  async collectFullThread(threadUrl) {
    const tweetId = threadUrl.split("/status/")[1]?.split("?")[0];
    if (!tweetId) {
      logger.error(`Could not extract tweet ID from URL: ${threadUrl}`);
      return null;
    }

    try {
      try {
        const existingTweet = await Tweet.findOne({ id: tweetId });
        if (existingTweet?.status === "processed") {
          logger.info(`Thread already processed: ${threadUrl}`);
        }
      } catch (dbError) {
        logger.error(`Database check failed for ${threadUrl}:`, dbError);
      }

      let navigationSuccess = false;
      let retryCount = 0;
      const maxRetries = 3;
      const baseTimeout = 30000;

      while (!navigationSuccess && retryCount < maxRetries) {
        try {
          await this.page.goto(threadUrl, {
            waitUntil: "domcontentloaded",
            timeout: baseTimeout * (retryCount + 1),
          });

          await this.page.waitForSelector('article[data-testid="tweet"]', {
            timeout: 10000,
          });

          navigationSuccess = true;
        } catch (navError) {
          retryCount++;
          logger.warn(
            `Navigation attempt ${retryCount} failed:`,
            navError.message
          );
          if (retryCount < maxRetries) {
            await sleep(3000 * retryCount);
          } else {
            throw new Error(`Failed to navigate after ${maxRetries} attempts`);
          }
        }
      }

      const originalAuthor = await this.page.evaluate(() => {
        const firstTweet = document.querySelector(
          'article[data-testid="tweet"]'
        );
        return firstTweet
          ?.querySelector('div[data-testid="User-Name"] a')
          ?.textContent?.trim();
      });

      if (!originalAuthor) {
        throw new Error("Could not identify original author");
      }

      let previousHeight = 0;
      let scrollAttempts = 0;
      const maxScrolls = 1500;

      while (scrollAttempts < maxScrolls) {
        await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
        await sleep(1500);

        const currentHeight = await this.page.evaluate(
          "document.body.scrollHeight"
        );
        if (currentHeight === previousHeight) {
          break;
        }
        previousHeight = currentHeight;
        scrollAttempts++;
      }

      const tweets = await this.page.evaluate((authorHandle) => {
        return Array.from(
          document.querySelectorAll('article[data-testid="tweet"]')
        )
          .map((tweet) => {
            try {
              const tweetAuthor = tweet
                .querySelector('div[data-testid="User-Name"] a')
                ?.textContent?.trim();
              if (tweetAuthor !== authorHandle) return null;

              const text = tweet
                .querySelector('[data-testid="tweetText"]')
                ?.innerText?.trim();
              if (!text) return null;

              const images = Array.from(
                tweet.querySelectorAll('img[src*="media"]')
              )
                .map((img) => {
                  const src = img.src;

                  return src.replace(/\&name=.+$/, "&name=large");
                })
                .filter(Boolean);

              const codeBlocks = Array.from(tweet.querySelectorAll("pre, code"))
                .map((block) => block.innerText)
                .filter(Boolean);

              return {
                text,
                links: Array.from(tweet.querySelectorAll("a[href]"))
                  .map((a) => a.href)
                  .filter((href) => {
                    if (!href) return false;
                    try {
                      const url = new URL(href);
                      return !["twitter.com", "x.com", "t.co"].includes(
                        url.hostname
                      );
                    } catch {
                      return false;
                    }
                  }),
                images,
                codeBlocks,
                timestamp: tweet
                  .querySelector("time")
                  ?.getAttribute("datetime"),
                isEdited: tweet.textContent.includes("Edited"),
                mediaType: tweet.querySelector("video")
                  ? "video"
                  : tweet.querySelector('img[src*="media"]')
                  ? "image"
                  : "text",
                mentions: Array.from(tweet.querySelectorAll('a[href*="/"]'))
                  .map((a) => a.href)
                  .filter((href) => href.match(/twitter\.com\/[^/]+$/)),
                hashtags: Array.from(
                  tweet.querySelectorAll('a[href*="/hashtag/"]')
                ).map((a) => a.textContent),
              };
            } catch (error) {
              return null;
            }
          })
          .filter(
            (tweet) =>
              tweet &&
              (tweet.text?.length > 50 ||
                tweet.links?.length > 0 ||
                tweet.images?.length > 0 ||
                tweet.codeBlocks?.length > 0)
          );
      }, originalAuthor);

      if (tweets && tweets.length > 0) {
        try {
          await Tweet.findOneAndUpdate(
            { id: tweetId },
            {
              id: tweetId,
              url: threadUrl,
              status: "processed",
              processed_at: new Date(),
              links: tweets.flatMap((t) => t.links || []),
            },
            { upsert: true }
          );
        } catch (dbError) {
          logger.error(`Failed to update thread status: ${threadUrl}`, dbError);
        }
      }

      return tweets;
    } catch (error) {
      logger.error(`Error collecting thread from ${threadUrl}:`, error);
      await this.takeDebugScreenshot(`thread-collection-error-${Date.now()}`);

      await Tweet.findOneAndUpdate(
        { id: tweetId },
        {
          id: tweetId,
          status: "failed",
        },
        { upsert: true }
      );

      return null;
    }
  }

  async login() {
    try {
      logger.info("Starting login process...");
      await this.page.goto("https://twitter.com/i/flow/login", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      logger.info("Waiting for username field...");
      await this.page.waitForSelector('input[autocomplete="username"]', {
        visible: true,
        timeout: 10000,
      });
      await sleep(2000);
      await this.page.type(
        'input[autocomplete="username"]',
        config.twitter.username,
        {
          delay: 100,
        }
      );
      logger.info("Username entered");
      await sleep(2000);
      await this.page.keyboard.press("Enter");
      await sleep(3000);

      logger.info("Checking for email verification...");
      const emailRequired = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const emailInput = inputs.find(
          (input) =>
            input.type === "text" ||
            input.type === "email" ||
            input.name === "text" ||
            input.name === "email" ||
            (input.placeholder &&
              input.placeholder.toLowerCase().includes("email"))
        );
        return {
          required: !!emailInput,
          type: emailInput?.type || "",
          placeholder: emailInput?.placeholder || "",
        };
      });

      if (emailRequired.required) {
        logger.info("Email verification required");

        if (!config.twitter.email) {
          throw new Error("Email verification required but not configured");
        }

        const emailSelectors = [
          'input[type="text"]',
          'input[type="email"]',
          'input[name="text"]',
          'input[name="email"]',
        ];

        let inputFound = false;
        for (const selector of emailSelectors) {
          try {
            const input = await this.page.$(selector);
            if (input) {
              await input.type(config.twitter.email, { delay: 100 });
              inputFound = true;
              logger.info(`Email entered using selector: ${selector}`);
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!inputFound) {
          throw new Error("Could not find email input field");
        }

        await sleep(2000);

        await this.page.keyboard.press("Enter");

        await sleep(5000);
      }

      logger.info("Looking for password field...");

      const passwordFieldFound = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const passwordInput = inputs.find(
          (input) =>
            input.type === "password" ||
            input.name === "password" ||
            input.autocomplete === "current-password" ||
            input.placeholder?.toLowerCase().includes("password")
        );
        if (passwordInput) {
          passwordInput.focus();
          return true;
        }
        return false;
      });

      if (!passwordFieldFound) {
        await this.page.screenshot({
          path: "debug-password-not-found.png",
          fullPage: true,
        });
        throw new Error("Could not find password field");
      }

      logger.info("Password field found, entering password");
      await sleep(1000);
      await this.page.keyboard.type(config.twitter.password, { delay: 100 });
      await sleep(2000);
      await this.page.keyboard.press("Enter");
      await sleep(5000);

      const loginSuccess = await this.page.evaluate(() => {
        return !document.querySelector('input[name="password"]');
      });

      if (!loginSuccess) {
        throw new Error("Login failed - password field still present");
      }

      logger.info("Login successful");
    } catch (error) {
      logger.error("Login failed:", error);

      await this.page.screenshot({ path: "login-error.png", fullPage: true });
      throw error;
    }
  }

  async fetchTweets() {
    try {
      if (!this.page) {
        await this.init();
        await this.login();
      }

      let allThreads = [];
      let consecutiveEmptySearches = 0;
      const MAX_EMPTY_SEARCHES = 15;

      while (allThreads.length < 10) {
        try {
          const currentQueryType = this.currentTypeIndex + 1;
          const searchQuery = this.getNextSearchQuery();
          logger.info(
            `Processing search query: ${searchQuery} (Type: ${currentQueryType})`
          );

          const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(
            searchQuery
          )}`;
          await this.page.goto(searchUrl, { waitUntil: "domcontentloaded" });

          const threads = await this.findThreadStarters();

          const validThreads = threads.filter(
            (t) => t.tweets && t.tweets.length > 0
          );

          if (validThreads.length === 0) {
            consecutiveEmptySearches++;
            if (consecutiveEmptySearches >= MAX_EMPTY_SEARCHES) {
              logger.info("Multiple empty searches, rotating to next type");
              this.currentQueryIndex = 999;
              consecutiveEmptySearches = 0;
              continue;
            }
          } else {
            consecutiveEmptySearches = 0;
            allThreads.push(...validThreads);
          }

          if (allThreads.length >= 10) {
            logger.info(`Found ${allThreads.length} complete threads`);
            return {
              threads: allThreads.slice(0, 10),
              queryType: currentQueryType,
            };
          }

          await sleep(3000);
        } catch (queryError) {
          logger.error(`Error processing query:`, queryError);
          await sleep(5000);
        }
      }
    } catch (error) {
      logger.error("Fatal error in fetchTweets:", error);
      throw error;
    }
  }

  async isPageUnresponsive() {
    try {
      await this.page.evaluate(() => document.title);
      return false;
    } catch {
      return true;
    }
  }

  async recreatePage() {
    logger.info("Recreating page due to unresponsiveness");
    try {
      if (this.page) {
        await this.page.close().catch(() => {});
      }

      const client = await this.browser.target().createCDPSession();
      await client.send("Network.clearBrowserCookies");
      await client.send("Network.clearBrowserCache");

      this.page = await this.browser.newPage();

      await this.page.setRequestInterception(true);
      this.page.on("request", (request) => {
        if (["image", "stylesheet", "font"].includes(request.resourceType())) {
          request.abort();
        } else {
          request.continue();
        }
      });

      await this.login();
      logger.info("Page successfully recreated");
    } catch (error) {
      logger.error("Error recreating page:", error);
      throw error;
    }
  }

  async takeDebugScreenshot(name) {
    try {
      const filename = `debug-${name}.png`;
      await this.page.screenshot({
        path: filename,
        fullPage: true,
      });
      logger.info(`Took debug screenshot: ${filename}`);
    } catch (error) {
      logger.error(`Failed to take screenshot:`, error);
    }
  }

  async scrollForContent() {
    const SCROLL_INTERVAL = 4000;
    const MAX_SCROLL_ATTEMPTS = 100;
    const MIN_TWEETS_PER_SCROLL = 5;
    const MIN_REQUIRED_TWEETS = 10;

    let noNewContentCount = 0;
    let scrollAttempts = 0;
    let validTweets = [];

    while (scrollAttempts < MAX_SCROLL_ATTEMPTS) {
      const beforeScroll = await this.page.evaluate(
        () => document.querySelectorAll('article[data-testid="tweet"]').length
      );

      await this.page.evaluate(() => {
        window.scrollBy({
          top: window.innerHeight * 1.5,
          behavior: "smooth",
        });
      });

      await this.page
        .waitForNetworkIdle({
          idleTime: 1000,
          timeout: 5000,
        })
        .catch(() => {});

      await sleep(SCROLL_INTERVAL);

      const tweets = await this.page.evaluate(() => {
        return Array.from(
          document.querySelectorAll('article[data-testid="tweet"]')
        )
          .map((tweet) => {
            const tweetUrl = tweet.querySelector('a[href*="/status/"]')?.href;
            const text = tweet
              .querySelector('[data-testid="tweetText"]')
              ?.innerText?.trim();
            const links = Array.from(tweet.querySelectorAll("a[href]"))
              .map((a) => a.href)
              .filter((href) => {
                if (!href) return false;
                try {
                  const url = new URL(href);
                  return (
                    !url.hostname.includes("twitter.com") &&
                    !url.hostname.includes("t.co") &&
                    !url.hostname.includes("instagram.com") &&
                    !url.hostname.includes("facebook.com")
                  );
                } catch {
                  return false;
                }
              });

            const isThread =
              text?.includes("🧵") ||
              text?.includes("thread") ||
              text?.includes("1/") ||
              /\(1\)|\bpart 1\b|\bstep 1\b/i.test(text);

            if (!tweetUrl || !text || text.length < 100 || links.length === 0)
              return null;

            return {
              url: tweetUrl,
              text,
              links,
              isThread,
            };
          })
          .filter((tweet) => tweet !== null);
      });

      let validCount = 0;
      for (const tweet of tweets) {
        const exists = await Tweet.countDocuments(
          { url: tweet.url },
          { limit: 1 }
        );
        if (exists === 0) {
          validCount++;
          validTweets.push(tweet);
        }
      }

      const newTweets = tweets.length - beforeScroll;
      logger.info(
        `Scroll ${
          scrollAttempts + 1
        }: Found ${newTweets} new tweets (${validCount} valid)`
      );

      if (validCount >= MIN_REQUIRED_TWEETS) {
        logger.info("Found enough valid tweets, stopping scroll");
        break;
      }

      if (newTweets < MIN_TWEETS_PER_SCROLL) {
        noNewContentCount++;
        if (noNewContentCount >= 10) {
          logger.info("No significant new content found in last 10 scrolls");
          break;
        }
      } else {
        noNewContentCount = 0;
      }

      lastTweetCount = tweets.length;
      scrollAttempts++;
      await sleep(2000);
    }

    return validTweets;
  }

  async cleanup() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
      }
    } catch (error) {
      logger.error("Cleanup failed:", error);
    }
  }
}

module.exports = new TwitterService();
