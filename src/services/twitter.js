const puppeteer = require("puppeteer");
const config = require("../../config");
const { Tweet } = require("../utils/dbConnection");
const { logger, sleep } = require("../utils/helpers");

class TwitterService {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async init() {
    try {
      if (!this.browser) {
        this.browser = await puppeteer.launch({
          headless: "new",
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
      throw error;
    }
  }

  async scrollForContent() {
    const SCROLL_INTERVAL = 4000;
    const MAX_SCROLL_ATTEMPTS = 30;
    const MIN_TWEETS_PER_SCROLL = 5;
    const MIN_REQUIRED_TWEETS = config.minRequiredTweets;

    let lastTweetCount = 0;
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

            if (!tweetUrl || !text || text.length < 100 || links.length === 0)
              return null;

            return { url: tweetUrl, text, links };
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

  async login() {
    try {
      logger.info("Starting login process...");
      await this.page.goto("https://twitter.com/i/flow/login", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      await this.page.waitForSelector('input[autocomplete="username"]', {
        visible: true,
      });
      await sleep(2000);
      await this.page.type(
        'input[autocomplete="username"]',
        config.twitter.username,
        {
          delay: 100,
        }
      );
      await sleep(2000);
      await this.page.keyboard.press("Enter");
      await sleep(3000);

      const emailRequired = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const emailInput = inputs.find(
          (input) =>
            input.type === "email" ||
            input.name === "email" ||
            (input.autocomplete && input.autocomplete.includes("email"))
        );
        return !!emailInput;
      });
      if (emailRequired) {
        logger.info("Email verification required");

        if (!config.twitter.email) {
          throw new Error(
            "Email verification required but email not configured"
          );
        }
        await this.page.type('input[type="email"]', config.twitter.email, {
          delay: 100,
        });
        await sleep(2000);
        await this.page.keyboard.press("Enter");
        await sleep(3000);
      }

      const passwordFieldFound = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const passwordInput = inputs.find(
          (input) =>
            input.type === "password" ||
            input.name === "password" ||
            input.autocomplete === "current-password"
        );
        if (passwordInput) {
          passwordInput.focus();
          return true;
        }
        return false;
      });
      if (!passwordFieldFound) {
        throw new Error("Could not find password field");
      }
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
      throw error;
    }
  }

  async fetchTweets() {
    try {
      if (!this.page) {
        await this.init();
        await this.login();
      }

      const keywords = config.search.keywords || [];
      const hashtags = config.search.hashtags || [];
      const searchTerms = [
        ...keywords,
        ...hashtags.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)),
      ].join(" OR ");

      if (!searchTerms.trim()) {
        throw new Error("Search terms cannot be empty");
      }

      const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(
        searchTerms
      )}&f=top`;
      await this.page.goto(searchUrl, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });

      let retryCount = 0;
      while (retryCount < 3) {
        try {
          await this.page.waitForSelector('article[data-testid="tweet"]', {
            timeout: 20000,
          });
          break;
        } catch (error) {
          retryCount++;
          logger.warn(`Tweet load retry ${retryCount}/3`);
          await sleep(2000);
        }
      }

      const validTweets = await this.scrollForContent();

      if (validTweets.length > 0) {
        const tweetsToSave = validTweets.map((tweet) => ({
          url: tweet.url,
          text: tweet.text,
          links: tweet.links,
          status: "pending",
        }));

        await Tweet.insertMany(tweetsToSave, {
          ordered: false,
          lean: true,
        }).catch((err) => {
          if (err.code === 11000) {
            logger.warn(
              `Skipped ${err.writeErrors?.length || 0} duplicate tweets`
            );
            return err.insertedDocs || [];
          }
          throw err;
        });

        logger.info(`Saved ${tweetsToSave.length} new tweets to database`);
        return tweetsToSave;
      }

      return validTweets;
    } catch (error) {
      logger.error("Error fetching tweets:", error);
      throw error;
    }
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
