const puppeteer = require("puppeteer");
const config = require("../../config");
const { Tweet } = require("../utils/dbConnection");
const { logger, sleep } = require("../utils/helpers");

class RateLimiter {
  constructor() {
    this.requestDelay = 2000;
    this.lastRequest = Date.now();
  }

  async waitForNext() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    if (timeSinceLastRequest < this.requestDelay) {
      await sleep(this.requestDelay - timeSinceLastRequest);
    }
    this.lastRequest = Date.now();
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
      "coding ai tips 🧵",
      "programming ai thread",
      "developer ai tools thread",
      "coding with ai 🧵",
      "ai development guide thread",
      "coding automation tips 🧵",
      "filter:links ai coding tools",
      "filter:links programming ai",
      "coding ai tutorial 1/",
      "software engineering ai (1/",
    ];

    this.searchQueriesType2 = [
      "coding tips tricks 🧵",
      "programming hacks thread",
      "developer tools thread",
      "coding resources 🧵",
      "software engineering tips thread",
      "ai coding assistant 🧵",
      "filter:links coding tutorial",
      "programming best practices thread",
      "coding productivity tips 1/",
      "developer workflow guide 🧵",
    ];

    this.searchQueriesType3 = [
      "online earning guide 🧵",
      "productivity tools thread",
      "useful websites thread",
      "productivity hacks 🧵",
      "make money online thread",
      "side hustle guide 🧵",
      "filter:links productivity tools",
      "remote work tips thread",
      "freelancing guide 1/",
      "digital tools thread 🧵",
    ];

    this.searchQueries = this.getRandomQueryType();
  }

  getRandomQueryType() {
    const types = [
      this.searchQueriesType1,
      this.searchQueriesType2,
      this.searchQueriesType3,
    ];
    const selectedType = types[Math.floor(Math.random() * types.length)];

    const typeIndex = types.indexOf(selectedType) + 1;
    logger.info(`Selected search query type: ${typeIndex}`);

    return selectedType;
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

      for (let i = 0; i < 5; i++) {
        await this.page.evaluate(() => {
          window.scrollBy(0, window.innerHeight * 2);
        });
        await sleep(2500);
      }

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

              const tweetUrl = tweet.querySelector('a[href*="/status/"]')?.href;
              if (!tweetUrl) return null;

              const isThread =
                tweetText.includes("🧵") ||
                tweetText.toLowerCase().includes("thread") ||
                /1\/|part 1|step 1|\(1\)|first part|tutorial|guide|learn/i.test(
                  tweetText
                ) ||
                tweetText.split("\n").length > 3 ||
                tweet.querySelectorAll("code, pre").length > 0 ||
                tweet.querySelectorAll('a[href*="github.com"]').length > 0;

              if (!isThread) return null;

              const getMetric = (selector) => {
                const text =
                  tweet.querySelector(`div[data-testid="${selector}"]`)
                    ?.textContent || "0";
                return text.toLowerCase().includes("k")
                  ? parseFloat(text.replace("k", "")) * 1000
                  : text.toLowerCase().includes("m")
                  ? parseFloat(text.replace("m", "")) * 1000000
                  : parseFloat(text) || 0;
              };

              const engagement = {
                likes: getMetric("like"),
                retweets: getMetric("retweet"),
                replies: getMetric("reply"),
              };

              const qualityScore =
                engagement.likes * 1 +
                engagement.retweets * 2 +
                engagement.replies * 1.5;

              return {
                url: tweetUrl,
                text: tweetText,
                engagement,
                qualityScore,
                hasCode: tweet.querySelectorAll("code, pre").length > 0,
                hasGithubLinks:
                  tweet.querySelectorAll('a[href*="github.com"]').length > 0,
              };
            } catch (error) {
              return null;
            }
          })
          .filter(Boolean)
          .sort((a, b) => b.qualityScore - a.qualityScore)
          .slice(0, 15);
      });

      const processedThreads = [];
      for (const thread of threadStarters) {
        try {
          const tweetId = thread.url.split("/status/")[1]?.split("?")[0];
          if (!tweetId) continue;

          const existingTweet = await Tweet.findOne({ id: tweetId });
          if (!existingTweet) {
            await new Tweet({
              id: tweetId,
              url: thread.url,
              text: thread.text,
              status: "pending",
            }).save();
            processedThreads.push(thread);
          }
        } catch (dbError) {
          logger.error(`Database operation failed for ${thread.url}:`, dbError);
          processedThreads.push(thread);
        }
      }

      logger.info(
        `Found ${threadStarters.length} threads, ${processedThreads.length} new`
      );
      return threadStarters;
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

      logger.info(`Collecting thread from: ${threadUrl}`);

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

      logger.info(`Original author: ${originalAuthor}`);

      let previousHeight = 0;
      let scrollAttempts = 0;
      const maxScrolls = 10;

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
                codeBlocks: Array.from(tweet.querySelectorAll("pre, code"))
                  .map((block) => block.innerText)
                  .filter(Boolean),
              };
            } catch (error) {
              return null;
            }
          })
          .filter(
            (tweet) =>
              tweet &&
              (tweet.text ||
                tweet.links.length > 0 ||
                tweet.images.length > 0 ||
                tweet.codeBlocks.length > 0)
          );
      }, originalAuthor);

      logger.info(
        `Collected ${tweets.length} tweets from original author ${originalAuthor}`
      );

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

      for (const baseQuery of this.searchQueries) {
        try {
          logger.info(`Processing search query: ${baseQuery}`);
          const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(
            baseQuery + " thread"
          )}&f=top`;

          let navigationSuccess = false;
          let retryCount = 0;
          const maxRetries = 3;
          const baseTimeout = 30000;

          while (!navigationSuccess && retryCount < maxRetries) {
            try {
              logger.info(`Attempting navigation (attempt ${retryCount + 1})`);

              await this.page.goto(searchUrl, {
                waitUntil: "domcontentloaded",
                timeout: baseTimeout * (retryCount + 1),
              });

              await this.page
                .waitForSelector('article[data-testid="tweet"]', {
                  timeout: 10000,
                })
                .catch(() => {
                  logger.warn(
                    "No tweets found immediately, will try scrolling"
                  );
                });

              await this.page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
              });

              await sleep(3000);

              const hasTweets = await this.page.evaluate(() => {
                return (
                  document.querySelectorAll('article[data-testid="tweet"]')
                    .length > 0
                );
              });

              if (hasTweets) {
                navigationSuccess = true;
                logger.info("Navigation successful, tweets found");
              } else {
                throw new Error("No tweets found after navigation");
              }
            } catch (navError) {
              retryCount++;
              logger.warn(
                `Navigation attempt ${retryCount} failed:`,
                navError.message
              );
              await sleep(5000 * retryCount);

              if (await this.isPageUnresponsive()) {
                await this.recreatePage();
              }
            }
          }

          if (!navigationSuccess) {
            throw new Error(`Failed to navigate after ${maxRetries} attempts`);
          }

          const threadStarters = await this.findThreadStarters();
          logger.info(`Found ${threadStarters.length} thread starters`);

          for (const starter of threadStarters) {
            try {
              const fullThread = await this.collectFullThread(starter.url);
              if (fullThread && fullThread.length > 0) {
                allThreads.push({
                  starter,
                  tweets: fullThread,
                  totalTweets: fullThread.length,
                  hasLinks: fullThread.some(
                    (t) => t.links && t.links.length > 0
                  ),
                  hasImages: fullThread.some(
                    (t) => t.images && t.images.length > 0
                  ),
                  hasCode: fullThread.some(
                    (t) => t.codeBlocks && t.codeBlocks.length > 0
                  ),
                });

                logger.info(
                  `Processed thread with ${fullThread.length} tweets`
                );
              }
            } catch (threadError) {
              logger.error(
                `Error processing thread ${starter.url}:`,
                threadError
              );
              continue;
            }

            if (allThreads.length >= 10) {
              logger.info("Reached desired number of threads");
              break;
            }

            await sleep(3000);
          }

          if (allThreads.length >= 10) break;
        } catch (queryError) {
          logger.error(`Error processing query "${baseQuery}":`, queryError);
          await this.takeDebugScreenshot(`query-error-${Date.now()}`);
          continue;
        }
      }

      logger.info(`Total threads collected: ${allThreads.length}`);

      const validThreads = allThreads.filter(
        (thread) =>
          thread &&
          thread.starter &&
          thread.tweets &&
          Array.isArray(thread.tweets) &&
          thread.tweets.length > 0
      );

      logger.info(`Valid threads for processing: ${validThreads.length}`);
      return validThreads;
    } catch (error) {
      logger.error("Fatal error in fetchTweets:", error);
      await this.cleanup();
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
    await this.page.close();
    this.page = await this.browser.newPage();
    await this.login();
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
    const MAX_SCROLL_ATTEMPTS = 30;
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
