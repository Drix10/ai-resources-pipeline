const puppeteer = require("puppeteer");
const config = require("../../config");
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
          headless: false,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--window-size=1920,1080",
            "--disable-notifications",
          ],
          defaultViewport: {
            width: 1920,
            height: 1080,
          },
        });
      }

      if (!this.page) {
        this.page = await this.browser.newPage();
        await this.page.setDefaultNavigationTimeout(60000);
        await this.page.setDefaultTimeout(60000);
      }
    } catch (error) {
      logger.error("Failed to initialize:", error);
      throw error;
    }
  }

  async login() {
    try {
      logger.info("Starting login process...");

      await this.page.goto("https://twitter.com/i/flow/login", {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      // Type username
      logger.info("Entering username...");
      await this.page.waitForSelector('input[autocomplete="username"]', {
        visible: true,
      });
      await sleep(2000);
      await this.page.type(
        'input[autocomplete="username"]',
        config.twitter.username,
        { delay: 100 }
      );
      await sleep(2000);

      // Click Next
      logger.info("Clicking Next...");
      const clicked = await this.page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('div[role="button"]')
        );
        const nextButton = buttons.find((button) =>
          button.textContent.toLowerCase().includes("next")
        );
        if (nextButton) {
          nextButton.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        throw new Error("Could not find or click Next button");
      }

      // Wait for password field to appear
      logger.info("Waiting for password field...");
      await sleep(3000);

      const passwordFieldAppeared = await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        return inputs.some(
          (input) =>
            input.type === "password" ||
            input.name === "password" ||
            input.autocomplete === "current-password"
        );
      });

      if (!passwordFieldAppeared) {
        logger.error("Password field did not appear");
        await this.page.screenshot({ path: "password-field-missing.png" });
        throw new Error("Password field not found after clicking Next");
      }

      // Type password
      logger.info("Entering password...");
      await this.page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll("input"));
        const passwordInput = inputs.find(
          (input) =>
            input.type === "password" ||
            input.name === "password" ||
            input.autocomplete === "current-password"
        );
        if (passwordInput) {
          passwordInput.focus();
        }
      });

      await sleep(1000);
      await this.page.keyboard.type(config.twitter.password, { delay: 100 });
      await sleep(2000);

      // Click Login
      logger.info("Clicking Login...");
      const loginClicked = await this.page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('div[role="button"]')
        );
        const loginButton = buttons.find((button) =>
          button.textContent.toLowerCase().includes("log in")
        );
        if (loginButton) {
          loginButton.click();
          return true;
        }
        return false;
      });

      if (!loginClicked) {
        throw new Error("Could not find or click Login button");
      }

      // Wait for navigation
      await sleep(5000);

      // Verify login success
      const isLoggedIn = await this.page.evaluate(() => {
        return !!(
          document.querySelector('[data-testid="AppTabBar_Home_Link"]') ||
          document.querySelector('[aria-label="Home"]') ||
          document.querySelector('[data-testid="primaryColumn"]')
        );
      });

      if (!isLoggedIn) {
        throw new Error("Login verification failed");
      }

      logger.info("Login successful");
      return true;
    } catch (error) {
      logger.error("Login failed:", error);
      await this.page.screenshot({ path: "login-error.png" });
      throw error;
    }
  }

  async handlePostLoginScreens() {
    logger.info("Handling post-login screens...");
    await sleep(5000);

    try {
      // Handle any verification or security prompts
      await this.page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll('div[role="button"]')
        );

        // Check for "Yes, it's me" button
        const verifyButton = buttons.find((button) =>
          button.textContent.toLowerCase().includes("yes, it's me")
        );
        if (verifyButton) verifyButton.click();

        // Check for "Skip for now" button
        const skipButton = buttons.find((button) =>
          button.textContent.toLowerCase().includes("skip for now")
        );
        if (skipButton) skipButton.click();
      });

      await sleep(3000);

      // Wait for home timeline
      logger.info("Waiting for home timeline...");
      await this.page.waitForSelector('[data-testid="primaryColumn"]', {
        timeout: 30000,
      });

      // Verify we're properly logged in
      const isLoggedIn = await this.page.evaluate(() => {
        return !!document.querySelector('[data-testid="primaryColumn"]');
      });

      if (!isLoggedIn) {
        throw new Error("Login verification failed");
      }

      logger.info("Successfully verified login");
      return true;
    } catch (error) {
      logger.error("Error during post-login handling:", error);
      await this.page.screenshot({ path: "post-login-error.png" });
      throw error;
    }
  }

  async fetchTweets(keywords = [], hashtags = []) {
    try {
      if (!this.page) {
        await this.init();
        await this.login();
      }

      const searchTerms = [
        ...keywords,
        ...hashtags.map((tag) => `#${tag}`),
      ].join(" OR ");
      logger.info(`Searching for: ${searchTerms}`);

      const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(
        searchTerms
      )}&f=live`;
      await this.page.goto(searchUrl, {
        waitUntil: "networkidle0",
        timeout: 60000,
      });

      logger.info("Waiting for tweets to load...");
      await sleep(5000);

      // Scroll a few times to load more tweets
      for (let i = 0; i < 3; i++) {
        await this.page.evaluate(() => {
          window.scrollBy(0, 1000);
        });
        await sleep(2000);
      }

      const tweets = await this.page.evaluate(() => {
        const tweetElements = document.querySelectorAll(
          'article[data-testid="tweet"]'
        );
        return Array.from(tweetElements, (tweet) => {
          const tweetText =
            tweet.querySelector('[data-testid="tweetText"]')?.innerText || "";
          const links = Array.from(tweet.querySelectorAll("a[href]"))
            .map((a) => a.href)
            .filter((href) => !href.includes("twitter.com"));

          const tweetLink =
            tweet.querySelector('a[href*="/status/"]')?.href || "";
          const tweetId = tweetLink.split("/status/")[1]?.split("?")[0];

          // Get username and timestamp
          const userElement = tweet.querySelector(
            'div[data-testid="User-Name"]'
          );
          const username = userElement
            ? userElement.textContent.split("@")[1]
            : "";
          const timeElement = tweet.querySelector("time");
          const timestamp = timeElement
            ? timeElement.getAttribute("datetime")
            : new Date().toISOString();

          return {
            id: tweetId,
            username,
            text: tweetText,
            links,
            url: tweetLink,
            timestamp,
            collected_at: new Date().toISOString(),
          };
        });
      });

      logger.info(`Successfully fetched ${tweets.length} tweets`);
      return tweets;
    } catch (error) {
      logger.error("Error fetching tweets:", error);
      await this.page.screenshot({ path: "fetch-error.png" });
      throw error;
    }
  }

  async cleanup() {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
        this.page = null;
        logger.info("Browser cleanup completed");
      }
    } catch (error) {
      logger.error("Cleanup failed:", error);
    }
  }
}

module.exports = new TwitterService();
