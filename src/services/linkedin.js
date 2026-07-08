const { Builder, By, Key, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

class LinkedInService {
  constructor() {
    this.driver = null;
    this.isInitialized = false;
    this.RATE_LIMIT_DELAY = 60000;
    this.lastRequestTime = 0;
    this.processedPostUrns = new Set();
  }

  async checkRateLimit() {
    const now = Date.now();
    if (now - this.lastRequestTime < this.RATE_LIMIT_DELAY) {
      const waitTime = this.RATE_LIMIT_DELAY - (now - this.lastRequestTime);
      logger.info(`LinkedIn Rate limit: Waiting ${waitTime / 1000} seconds before next request`);
      await sleep(waitTime);
    }
    this.lastRequestTime = now;
  }

  clearProcessedUrns() {
    // Prevent memory leaks by bounding the processed URN list
    if (this.processedPostUrns.size > 5000) {
      logger.info("LinkedInService: Clearing processed post URNs to prevent memory leak");
      const urnsArray = Array.from(this.processedPostUrns);
      const keptUrns = urnsArray.slice(Math.floor(urnsArray.length / 2));
      this.processedPostUrns = new Set(keptUrns);
    }
  }

  async ensureDriverConnected() {
    if (!this.driver || !this.isInitialized) {
      await this.init();
      return;
    }
    try {
      await this.driver.getCurrentUrl();
    } catch (err) {
      logger.warn(`LinkedInService: WebDriver session was lost or invalid (${err.message}). Reinitializing...`);
      this.isInitialized = false;
      await this.cleanup();
      await this.init();
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

          logger.info("LinkedInService: Connected to existing Chrome browser");
          this.isInitialized = true;
        } catch (connectionError) {
          logger.error("LinkedInService: Failed to connect to Chrome. Make sure Chrome is running with: chrome --remote-debugging-port=9222");
          throw new Error("Chrome not running with remote debugging. Run: chrome --remote-debugging-port=9222");
        }
      }
      await this.checkLogin();
    } catch (error) {
      logger.error("LinkedInService: Failed to initialize:", error);
      this.isInitialized = false;
      await this.cleanup();
      throw error;
    }
  }

  async switchToTab(domainKeyword, pathKeyword = null) {
    let originalHandle = null;
    try {
      originalHandle = await this.driver.getWindowHandle();
    } catch (e) {}

    try {
      const handles = await this.driver.getAllWindowHandles();
      let bestMatchHandle = null;
      let domainMatchHandle = null;

      for (const handle of handles) {
        try {
          await this.driver.switchTo().window(handle);
          const url = await this.driver.getCurrentUrl();
          let hostname = "";
          try {
            hostname = new URL(url).hostname;
          } catch (urlErr) {}

          if (hostname.endsWith(domainKeyword) || hostname === domainKeyword) {
            if (!domainMatchHandle) {
              domainMatchHandle = handle;
            }
            if (pathKeyword && url.includes(pathKeyword)) {
              bestMatchHandle = handle;
              break;
            }
          }
        } catch (err) {}
      }

      const targetHandle = bestMatchHandle || domainMatchHandle;
      if (targetHandle) {
        await this.driver.switchTo().window(targetHandle);
        const activeUrl = await this.driver.getCurrentUrl();
        logger.info(`LinkedInService: Switched to tab matching "${domainKeyword}" (pathKeyword: ${pathKeyword}): ${activeUrl}`);
        try {
          await this.driver.sendDevToolsCommand("Page.bringToFront");
        } catch (cdpErr) {
          await this.driver.executeScript("window.focus();");
        }
        return true;
      }

      logger.info(`LinkedInService: No active tab matching "${domainKeyword}" found. Restoring original tab context.`);
      if (originalHandle) {
        await this.driver.switchTo().window(originalHandle);
      }
      return false;
    } catch (e) {
      logger.warn("LinkedInService: Error switching tabs: " + (e.stack || e));
      if (originalHandle) {
        try {
          await this.driver.switchTo().window(originalHandle);
        } catch (restoreErr) {}
      }
      return false;
    }
  }

  async checkLogin() {
    try {
      const matched = await this.switchToTab("linkedin.com");
      if (!matched) {
        logger.info("LinkedInService: No matching tab found, opening a new tab...");
        await this.driver.switchTo().newWindow("tab");
      }
      await this.driver.get("https://www.linkedin.com/feed/");
      
      // Wait up to 10 seconds for any logged-in elements to appear
      let isLoggedIn = false;
      const startTime = Date.now();
      while (Date.now() - startTime < 10000) {
        const loggedInElements = await this.driver.findElements(
          By.css("a[href*='/feed'], a[href*='/mynetwork'], a[href*='/messaging'], a[href*='/notifications'], nav.global-nav, .global-nav")
        );
        if (loggedInElements.length > 0) {
          isLoggedIn = true;
          break;
        }
        await sleep(1000);
      }

      if (!isLoggedIn) {
        logger.info("LinkedInService: Not logged in to LinkedIn. Prompting for manual login...");
        await this.login();
      } else {
        logger.info("LinkedInService: Already logged into LinkedIn");
      }
    } catch (error) {
      logger.error("LinkedInService: Error checking login state:", error);
      throw error;
    }
  }

  async login() {
    const maxAttempts = 60; // 5 minutes total wait time (60 * 5 seconds)
    let attempts = 0;

    try {
      logger.warn("⚠️ LinkedIn Login Required: Please log in manually in the Chrome browser window.");

      // Poll until the login is completed by the user or we timeout
      while (attempts < maxAttempts) {
        try {
          const loggedInElements = await this.driver.findElements(
            By.css("a[href*='/feed'], a[href*='/mynetwork'], a[href*='/messaging'], a[href*='/notifications'], nav.global-nav, .global-nav")
          );
          if (loggedInElements.length > 0) {
            logger.info("LinkedInService: Login detected! Continuing pipeline...");
            return;
          }
        } catch (pollErr) {
          // Ignore transient errors
        }
        attempts++;
        await sleep(5000);
      }

      throw new Error("LinkedIn manual login check timed out after 5 minutes.");
    } catch (error) {
      logger.error("LinkedInService: Error during manual login check:", error);
      throw error;
    }
  }

  async fetchPostsByKeyword(keyword) {
    try {
      await this.ensureDriverConnected();
      const matched = await this.switchToTab("linkedin.com");
      if (!matched) {
        logger.info("LinkedInService: No matching tab found, opening a new tab...");
        await this.driver.switchTo().newWindow("tab");
      }

      await this.checkRateLimit();
      this.clearProcessedUrns();

      logger.info(`LinkedInService: Searching for keyword: "${keyword}"`);
      const searchUrl = `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(keyword)}&origin=GLOBAL_SEARCH_HEADER`;
      
      await this.driver.get(searchUrl);
      await sleep(3000);

      // Dismiss any open filter modals/drawers that block screen scrolling
      try {
        const dismissButtons = await this.driver.findElements(
          By.css("button[aria-label*='Dismiss'], button[class*='dismiss'], button[class*='cancel'], button[class*='close']")
        );
        for (const btn of dismissButtons) {
          if (await btn.isDisplayed()) {
            await btn.click();
            await sleep(500);
          }
        }
      } catch (dismissErr) {}
      
      // Wait for page results to load (Wait for elements containing activity, share, update, or card styles)
      try {
        await this.driver.wait(
          until.elementLocated(By.css("[data-urn*='activity'], [data-urn*='update'], [data-urn*='share'], [data-activity-id], .artdeco-card")),
          15000
        );
      } catch (waitErr) {
        logger.warn("LinkedInService: Timeout waiting for search results elements, proceeding anyway...");
        try {
          const bodyText = await this.driver.executeScript("return document.body.innerText;");
          logger.info("LinkedIn Body text length: " + bodyText.length);
          logger.info("LinkedIn Body preview: " + bodyText.substring(0, 400).replace(/\n/g, " "));
          logger.info("LinkedIn Body contains 'CS Academics'?: " + bodyText.includes("CS Academics"));
          logger.info("LinkedIn Body contains 'Pragati'?: " + bodyText.includes("Pragati"));
        } catch (bodyErr) {
          logger.error("Failed to read body text:", bodyErr);
        }
        try {
          await this.driver.takeScreenshot().then((image) => {
            require("fs").writeFileSync("linkedin-search-failed.png", image, "base64");
          });
          logger.info("LinkedInService: Saved search failure screenshot to linkedin-search-failed.png");
        } catch (screenshotErr) {}
      }

      const SCROLL_ATTEMPTS = 5;
      const POSTS_NEEDED = 10;
      
      for (let attempt = 1; attempt <= SCROLL_ATTEMPTS; attempt++) {
        logger.info(`LinkedInService: Scroll attempt ${attempt}/${SCROLL_ATTEMPTS}`);
        
        // Scroll the last post card element into view using the "feed post" prefix label
        try {
          await this.driver.executeScript(`
            const cards = Array.from(document.querySelectorAll("div, li, article")).filter(el => {
              const text = (el.textContent || el.innerText || "").trim().toLowerCase();
              if (!text.startsWith("feed post") && !text.startsWith("feed update")) return false;
              if (text.length < 100) return false;
              const childMatches = Array.from(el.querySelectorAll("div, li, article")).some(child => {
                if (child === el) return false;
                const cText = (child.textContent || child.innerText || "").trim().toLowerCase();
                return cText.startsWith("feed post") || cText.startsWith("feed update");
              });
              return !childMatches;
            });
            if (cards.length > 0) {
              const lastCard = cards[cards.length - 1];
              lastCard.scrollIntoView({ behavior: 'auto', block: 'end' });
            } else {
              window.scrollBy(0, 500);
            }
          `);
        } catch (scrollErr) {
          logger.warn("LinkedIn gradual scroll failed:", scrollErr);
        }
        await sleep(3000); // Allow sufficient time for lazy-loaded posts to render
      }

      logger.info("LinkedInService: Performing browser-side batch DOM extraction...");
      
      // Extract all posts in a single JS execution context in the browser to minimize Selenium round-trips
      const scrapedData = await this.driver.executeScript(`
        // 1. Expand all "... see more" text buttons
        const seeMoreButtons = document.querySelectorAll("button, span, a");
        for (const btn of seeMoreButtons) {
          try {
            const text = (btn.textContent || btn.innerText || "").trim().toLowerCase();
            if (text === "... more" || text === "more" || btn.className.includes("see-more")) {
              btn.click();
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            }
          } catch(e) {}
        }

        const posts = [];
        const seenUrns = new Set();
        
        // 2. Locate all card containers by identifying elements starting with "feed post" or "feed update"
        const cardCandidates = Array.from(document.querySelectorAll("div, li, article")).filter(el => {
          const text = (el.textContent || el.innerText || "").trim().toLowerCase();
          if (!text.startsWith("feed post") && !text.startsWith("feed update")) return false;
          if (text.length < 100) return false;
          
          // Exclude parent wrappers
          const childMatches = Array.from(el.querySelectorAll("div, li, article")).some(child => {
            if (child === el) return false;
            const cText = (child.textContent || child.innerText || "").trim().toLowerCase();
            return cText.startsWith("feed post") || cText.startsWith("feed update");
          });
          return !childMatches;
        });
        
        for (const container of cardCandidates) {
          // Extract URN/Link if present
          let urn = "";
          let postUrl = "";
          const links = container.querySelectorAll("a");
          for (const l of links) {
            const href = l.getAttribute("href") || "";
            if (href.includes("/feed/update/") || href.includes("/posts/")) {
              postUrl = href.startsWith("http") ? href : "https://www.linkedin.com" + href;
              const urnMatch = href.match(/urn:li:[^/?&#]+/);
              if (urnMatch) urn = urnMatch[0];
              break;
            }
          }
          
          // Fallback unique ID if no URN was found
          if (!urn) {
            // Generate a simple hash from content
            let hash = 0;
            const contentString = (container.textContent || "").substring(0, 100);
            for (let i = 0; i < contentString.length; i++) {
              hash = (hash << 5) - hash + contentString.charCodeAt(i);
              hash |= 0;
            }
            urn = "urn:li:local:" + Math.abs(hash);
          }
          
          if (seenUrns.has(urn)) continue;
          seenUrns.add(urn);
          
          // Extract Author (clean feed post label and split at bullet marker)
          let author = "LinkedIn Contributor";
          const rawText = container.textContent || "";
          const cleaned = rawText.replace(/^(feed post|feed update)/i, "").trim();
          const parts = cleaned.split("•");
          if (parts.length > 0) {
            author = parts[0].trim().replace(/\\s+/g, " ");
          }
          if (author.length > 50) author = author.substring(0, 50);

          // Extract Text (find the longest commentary text block)
          let text = "";
          const textEls = container.querySelectorAll("span, p, div");
          let maxLen = 0;
          for (const tel of textEls) {
            const tVal = tel.textContent.trim();
            if (tVal.length > maxLen && tVal.length < 5000 && !tVal.includes("Like") && !tVal.includes("Comment") && !tVal.includes("Follow") && !tVal.toLowerCase().startsWith("feed post")) {
              maxLen = tVal.length;
              text = tel.innerText || tel.textContent;
            }
          }
          if (!text || text.length < 15) continue;
          
          // Extract out-links
          const extLinks = [];
          for (const l of links) {
            const lHref = l.getAttribute("href");
            if (lHref && lHref.startsWith("http") && !lHref.includes("linkedin.com/feed") && !lHref.includes("linkedin.com/in/") && !lHref.includes("linkedin.com/company/")) {
              if (!extLinks.includes(lHref)) extLinks.push(lHref);
            }
          }
          
          // Extract images
          const images = [];
          const imgEls = container.querySelectorAll("img");
          for (const img of imgEls) {
            const src = img.getAttribute("src");
            const className = img.getAttribute("class") || "";
            if (src && src.startsWith("http") && !src.includes("profile-displayphoto") && !className.includes("avatar")) {
              if (!images.includes(src)) images.push(src);
            }
          }
          
          posts.push({
            id: urn,
            text,
            author,
            links: extLinks,
            images,
            url: postUrl
          });
        }
        return posts;
      `);

      if (scrapedData.length === 0) {
        logger.warn("LinkedInService: No posts found by batch parser. Running DOM diagnostics...");
        try {
          const diag = await this.driver.executeScript(`
            const allElements = Array.from(document.querySelectorAll("button, span, a, p, div, li, article"));
            const res = [];
            for (const el of allElements) {
              const text = (el.textContent || el.innerText || "").trim().toLowerCase();
              if (text.includes("like") || text.includes("comment") || text.includes("pragati") || text.includes("career")) {
                res.push({
                  tagName: el.tagName,
                  className: el.className.substring(0, 50),
                  text: text.substring(0, 50),
                  parentTag: el.parentElement ? el.parentElement.tagName : "NONE",
                  parentClass: el.parentElement ? el.parentElement.className.substring(0, 50) : "NONE"
                });
              }
            }
            return res.slice(0, 30);
          `);
          logger.info("LinkedIn Diagnostic DOM dump: " + JSON.stringify(diag));
        } catch (diagErr) {
          logger.error("LinkedIn Diagnostic failed:", diagErr);
        }
      }

      logger.info(`LinkedInService: Browser-side extraction found ${scrapedData.length} total posts. Filtering duplicates and spam...`);

      let collectedPosts = [];
      const noiseWords = ["poll", "vote", "hiring", "job opening", "recruiting", "open role", "internship", "admission", "resume", "cv", "recruiter", "hiring manager"];
      
      for (const post of scrapedData) {
        if (collectedPosts.length >= POSTS_NEEDED) break;

        if (this.processedPostUrns.has(post.id)) {
          continue;
        }

        // Filter out low-quality spam or polls
        const lowerText = post.text.toLowerCase();
        const containsNoise = noiseWords.some(word => lowerText.includes(word));
        if (containsNoise) {
          logger.info(`LinkedInService: Filtered out noise/poll post from ${post.author}`);
          continue;
        }

        // Mark URN as processed for this run
        this.processedPostUrns.add(post.id);

        const postUrl = post.url || `https://www.linkedin.com/feed/update/${post.id}`;
        collectedPosts.push({
          id: post.id,
          text: post.text,
          author: post.author,
          links: post.links,
          images: post.images,
          url: postUrl,
          source: "LinkedIn",
          timestamp: new Date().toISOString()
        });
      }

      logger.info(`LinkedInService: Successfully collected ${collectedPosts.length} posts for "${keyword}"`);
      return collectedPosts;
    } catch (error) {
      logger.error(`LinkedInService: Failed to fetch posts for "${keyword}":`, error);
      return [];
    }
  }

  /**
   * Query an element inside #interop-outlet's Shadow DOM.
   * The LinkedIn share modal (and all its child elements) live inside this shadow root
   * and are invisible to standard Selenium By.css / By.xpath locators.
   * @param {string} selector - CSS selector to query inside the shadow root
   * @param {number} timeoutMs - Maximum ms to wait before throwing
   * @returns {Promise<WebElement>}
   */
  async _getShadowEl(selector, timeoutMs = 25000) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      try {
        const el = await this.driver.executeScript(`
          const outlet = document.getElementById("interop-outlet");
          if (outlet && outlet.shadowRoot) {
            return outlet.shadowRoot.querySelector(arguments[0]);
          }
          return null;
        `, selector);
        if (el) return el;
      } catch (scriptErr) {
        // If the WebDriver session is gone, rethrow immediately
        const msg = (scriptErr.message || "").toLowerCase();
        if (msg.includes("session") || msg.includes("connection") || msg.includes("no such window")) {
          throw scriptErr;
        }
        // Otherwise (e.g., transient JS error) just wait and retry
        logger.warn(`LinkedInService: _getShadowEl transient error: ${scriptErr.message}`);
      }
      await sleep(500);
    }
    throw new Error(`LinkedInService: Timeout waiting for shadow element: ${selector}`);
  }

  async postToLinkedIn(text, imageUrl = null) {
    let originalHandle = null;
    let localImagePath = null;
    let isRemote = false;
    try {
      await this.ensureDriverConnected();

      try {
        originalHandle = await this.driver.getWindowHandle();
      } catch (e) {}

      // Switch to existing LinkedIn feed tab instead of opening a fresh one (avoids
      // hitting Chrome's popup-blocker and is cleaner for debugging sessions).
      logger.info("Switching to existing LinkedIn tab...");
      const matched = await this.switchToTab("linkedin.com", "/feed");
      if (!matched) {
        logger.info("LinkedInService: No existing feed tab found, navigating current tab to feed...");
        await this.driver.get("https://www.linkedin.com/feed/");
      }
      await sleep(4000);

      // ── Step 1: Open the share modal ──────────────────────────────────────
      // When posting with an image we click the "Photo" shortcut on the feed
      // page so the media uploader opens immediately (avoids an extra click
      // to switch from text-only to media mode inside the modal).
      if (imageUrl) {
        logger.info("Locating 'Photo' link trigger on feed page...");
        const photoTrigger = await this.driver.executeScript(`
          const all = Array.from(document.querySelectorAll("a, button, span, div"));
          return all.find(el => {
            const text = (el.textContent || "").trim().toLowerCase();
            const aria  = (el.getAttribute("aria-label") || "").toLowerCase();
            return (text === "photo" || aria.includes("photo") || aria.includes("image") || aria.includes("add a photo"));
          }) || null;
        `);

        if (photoTrigger) {
          logger.info("Clicking 'Photo' link trigger via JS click with capturing preventDefault interceptor...");
          await this.driver.executeScript(`
            const el = arguments[0];
            // Remove any capture-phase preventDefault calls that block the click
            const handler = e => { e.stopImmediatePropagation(); };
            document.addEventListener('click', handler, true);
            el.click();
            document.removeEventListener('click', handler, true);
          `, photoTrigger);
        } else {
          logger.warn("LinkedInService: 'Photo' trigger not found; falling back to 'Start a post' trigger.");
          const postTrigger = await this.driver.executeScript(`
            const all = Array.from(document.querySelectorAll("p, span, button, div, a"));
            return all.find(el => (el.textContent || "").trim().toLowerCase() === "start a post") || null;
          `);
          if (postTrigger) await this.driver.executeScript(`arguments[0].click();`, postTrigger);
        }
      } else {
        // Text-only post: use the "Start a post" entry trigger
        logger.info("LinkedInService: Locating 'Start a post' trigger for text-only post...");
        const postTrigger = await this.driver.executeScript(`
          const all = Array.from(document.querySelectorAll("p, span, button, div, a"));
          return all.find(el => (el.textContent || "").trim().toLowerCase() === "start a post") || null;
        `);
        if (postTrigger) {
          await this.driver.executeScript(`arguments[0].click();`, postTrigger);
        } else {
          // Hard fallback to Selenium locator
          const fallback = await this.driver.wait(
            until.elementLocated(By.css("[aria-label*='Start a post'], a[href*='sharebox'], .share-box-feed-entry__trigger")),
            8000
          );
          await fallback.click();
        }
      }
      await sleep(5000); // Allow shadow DOM modal to fully render

      // ── Step 2: Upload image (Shadow DOM aware) ───────────────────────────
      if (imageUrl) {
        isRemote = imageUrl.startsWith("http");
        localImagePath = imageUrl;

        if (isRemote) {
          const tempDir = path.join(process.cwd(), "temp");
          if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
          let ext = ".jpg";
          try { ext = path.extname(new URL(imageUrl).pathname.split("?")[0]) || ".jpg"; } catch (e) {}
          localImagePath = path.join(tempDir, `linkedin-upload-${Date.now()}${ext}`);
          logger.info(`LinkedInService: Downloading image from ${imageUrl}...`);
          await this.downloadImage(imageUrl, localImagePath);
          logger.info(`LinkedInService: Image downloaded to ${localImagePath}`);
        } else {
          logger.info(`LinkedInService: Using local image path for upload: ${localImagePath}`);
        }

        logger.info("LinkedInService: Locating hidden file input inside Shadow DOM and uploading image...");
        const fileInput = await this._getShadowEl("input[type='file']", 20000);
        await fileInput.sendKeys(path.resolve(localImagePath));
        logger.info("LinkedInService: Uploaded image file path to input element");
        await sleep(6000); // Wait for upload preview to render

        // Click 'Next' to proceed to the text composition screen
        logger.info("LinkedInService: Confirming image preview (Next button)...");
        const nextButton = await this._getShadowEl(
          "button[aria-label='Next'], button.share-box-footer__primary-btn, button[class*='primary-btn']",
          15000
        );
        await nextButton.click();
        await sleep(4000);
      }

      // ── Step 3: Type post text (Shadow DOM aware) ────────────────────────
      logger.info("LinkedInService: Locating editor text area inside Shadow DOM...");
      const editor = await this._getShadowEl(
        "div.ql-editor, div[role='textbox'][contenteditable='true']",
        20000
      );
      await editor.click();
      await sleep(1000);

      logger.info("LinkedInService: Formatting and injecting post text into editor...");
      await this.driver.executeScript(`
        const outlet = document.getElementById("interop-outlet");
        if (outlet && outlet.shadowRoot) {
          const editorEl = outlet.shadowRoot.querySelector("div.ql-editor, div[role='textbox'][contenteditable='true']");
          if (editorEl) {
            editorEl.innerHTML = "";
            const formattedText = arguments[0].split('\\n').map(p => {
              const trimmed = p.trim();
              return trimmed ? '<p>' + p + '</p>' : '<p><br></p>';
            }).join('');
            editorEl.innerHTML = formattedText;
            editorEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      `, text);
      await sleep(3000);


      // ── Step 4: Click Post (Shadow DOM aware) ─────────────────────────────
      logger.info("LinkedInService: Locating post submission button inside Shadow DOM...");
      const postButton = await this._getShadowEl(
        "button.share-actions__primary-action, button[class*='primary-action']",
        15000
      );

      // Wait for the Post button to become enabled (not disabled)
      let isEnabled = false;
      for (let i = 0; i < 20; i++) {
        isEnabled = await this.driver.executeScript(`
          const outlet = document.getElementById("interop-outlet");
          if (outlet && outlet.shadowRoot) {
            const btn = outlet.shadowRoot.querySelector("button.share-actions__primary-action, button[class*='primary-action']");
            return btn ? !btn.disabled : false;
          }
          return false;
        `);
        if (isEnabled) break;
        await sleep(500);
      }

      logger.info(`LinkedInService: Clicking Post submission (button enabled: ${isEnabled})...`);
      await postButton.click();
      await sleep(8000);

      logger.info("LinkedInService: Post submitted successfully!");
      return true;
    } catch (error) {
      logger.error("LinkedInService: Failed to post to LinkedIn:", error);
      try {
        const screenshot = await this.driver.takeScreenshot();
        fs.writeFileSync("linkedin-post-failed.png", screenshot, "base64");
      } catch (e) {}
      return false;
    } finally {
      // Clean up downloaded temp image
      try {
        if (isRemote && localImagePath && fs.existsSync(localImagePath)) {
          fs.unlinkSync(localImagePath);
        }
      } catch (e) {}

      // Close the post tab if we opened a new one
      if (originalHandle) {
        try { await this.driver.switchTo().window(originalHandle); } catch (e) {}
      }
    }
  }

  async downloadImage(url, destPath) {
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
      timeout: 30000,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      }
    });
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath);
      response.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }

  async generateSlideImage(title, points, slideTagline = "Curated by AI \u00b7 Updated Weekly") {
    let originalHandle = null;
    let renderTabOpened = false;
    let originalSize = null;
    // Use module-level fs and path imports (no inner require needed)

    try {
      await this.ensureDriverConnected();
      originalHandle = await this.driver.getWindowHandle();
    } catch (e) {}

    try {
      originalSize = await this.driver.manage().window().getSize();
    } catch (e) {}

    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Escape any HTML special chars in dynamic content to prevent injection
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const pointsHtml = points.map((pt, i) => `
      <div class="point-item">
        <div class="point-num">${i + 1}</div>
        <div class="point-text">${esc(pt)}</div>
      </div>
    `).join("");
    
    // Portrait 1080x1350 — LinkedIn feed-optimal with a clean, flat Swiss-developer aesthetic
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1080px;
      height: 1350px;
      display: flex;
      flex-direction: column;
      background: #0f0f11;
      color: #f4f4f5;
      font-family: 'Inter', sans-serif;
      overflow: hidden;
      position: relative;
    }
    .content {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 90px 80px 70px;
    }
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 70px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid #3f3f46;
      background: #18181b;
      padding: 10px 20px;
      border-radius: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #e4e4e7;
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
    }
    .logo-area {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      color: #71717a;
      font-weight: 500;
    }
    .hero-section {
      margin-bottom: 50px;
      border-left: 5px solid #6366f1;
      padding-left: 28px;
    }
    .eyebrow {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #a5b4fc;
      margin-bottom: 14px;
    }
    .title {
      font-size: 58px;
      font-weight: 800;
      line-height: 1.15;
      color: #ffffff;
      letter-spacing: -0.02em;
    }
    .points-section {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
    .point-item {
      display: flex;
      align-items: flex-start;
      gap: 28px;
      padding: 30px;
      background: #18181b;
      border: 1px solid #27272a;
      border-radius: 8px;
    }
    .point-num {
      flex-shrink: 0;
      width: 44px;
      height: 44px;
      border-radius: 6px;
      background: #27272a;
      border: 1px solid #3f3f46;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 18px;
      font-weight: 700;
      color: #6366f1;
    }
    .point-text {
      font-size: 24px;
      font-weight: 500;
      color: #d4d4d8;
      line-height: 1.5;
    }
    .footer {
      margin-top: 50px;
      padding-top: 36px;
      border-top: 1px solid #27272a;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .footer-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .footer-icon {
      font-size: 18px;
    }
    .footer-text {
      font-size: 16px;
      color: #71717a;
      font-weight: 500;
      font-family: 'JetBrains Mono', monospace;
    }
    .save-cta {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #27272a;
      border: 1px solid #3f3f46;
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      color: #e4e4e7;
      letter-spacing: 0.02em;
    }
  </style>
</head>
<body>
  <div class="content">
    <div class="top-bar">
      <div class="badge"><span class="badge-dot"></span>Tech Curation</div>
      <div class="logo-area">github.com/Drix10</div>
    </div>
    <div class="hero-section">
      <div class="eyebrow">Curated Report</div>
      <div class="title">${esc(title)}</div>
    </div>
    <div class="points-section">
      ${pointsHtml}
    </div>
    <div class="footer">
      <div class="footer-left">
        <span class="footer-icon">⚡</span>
        <span class="footer-text">${esc(slideTagline)}</span>
      </div>
      <div class="save-cta">⭐ Save for later</div>
    </div>
  </div>
</body>
</html>`;
    
    const htmlPath = path.join(tempDir, `slide-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, htmlContent);
    const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
    logger.info(`LinkedInService: Loading generated slide HTML: ${fileUrl}`);

    try {
      // Open rendering tab
      await this.driver.switchTo().newWindow("tab");
      renderTabOpened = true;
      
      // Resize window to match 1080x1350 portrait canvas
      await this.driver.manage().window().setSize({ width: 1080, height: 1420 });
      await this.driver.get(fileUrl);
      await sleep(2500); // Wait for Google Fonts to load
      
      const imagePath = path.join(tempDir, `slide-${Date.now()}.png`);
      const screenshotData = await this.driver.takeScreenshot();
      fs.writeFileSync(imagePath, Buffer.from(screenshotData, "base64"));
      logger.info(`LinkedInService: Generated slide image screenshot saved to ${imagePath}`);
      
      return imagePath;
    } catch (err) {
      logger.error("LinkedInService: Failed to render slide image in browser tab:", err);
      return null;
    } finally {
      if (renderTabOpened) {
        try {
          await this.driver.close();
        } catch (closeErr) {}
      }
      if (originalHandle) {
        try {
          await this.driver.switchTo().window(originalHandle);
        } catch (switchErr) {}
      }
      if (originalSize) {
        try {
          await this.driver.manage().window().setSize({ width: originalSize.width, height: originalSize.height });
        } catch (resizeErr) {}
      }
      try {
        if (fs.existsSync(htmlPath)) {
          fs.unlinkSync(htmlPath);
        }
      } catch (e) {}
    }
  }

  async cleanup() {
    try {
      if (this.driver) {
        logger.info("LinkedInService: Releasing WebDriver control of debugging browser session");
        // Detach connection by clearing reference without calling quit(), preserving user's Chrome tabs
        this.driver = null;
      }
    } catch (error) {
      logger.error("LinkedInService: Failed to clean up driver:", error);
    } finally {
      this.driver = null;
      this.isInitialized = false;
    }
  }
}

module.exports = LinkedInService;
