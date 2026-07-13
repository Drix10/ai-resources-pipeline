const { Builder, By, until, Key } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const { logger, sleep } = require("../utils/helpers");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

class LinkedInService {
  constructor() {
    this.driver = null;
    this.isInitialized = false;
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
            const shadowEl = outlet.shadowRoot.querySelector(arguments[0]);
            if (shadowEl) return shadowEl;
          }
          return document.querySelector(arguments[0]);
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

  async postToLinkedIn(text, imageUrl = null, commentText = null) {
    let originalHandle = null;
    let localImagePath = null;
    let isRemote = false;

    // Clean up markdown formatting so it renders beautifully on LinkedIn (which only supports plain text)
    const cleanedText = text
      // Remove bold markers (**bold** -> bold)
      .replace(/\*\*(.*?)\*\*/g, "$1")
      // Remove italic markers (*italic* -> italic)
      .replace(/\*(.*?)\*/g, "$1")
      // Remove underline markers (__underline__ -> underline)
      .replace(/__(.*?)__/g, "$1")
      // Remove backticks (code format) (`code` -> code)
      .replace(/`(.*?)`/g, "$1")
      // Clean up markdown headers (e.g., ### Title -> Title)
      .replace(/^#+\s*(.*?)$/gm, "$1")
      // Clean up markdown links ([Link text](http://url) -> Link text: http://url)
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1: $2");

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
            try {
              el.click();
            } finally {
              document.removeEventListener('click', handler, true);
            }
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
        let editorEl = null;
        const outlet = document.getElementById("interop-outlet");
        if (outlet && outlet.shadowRoot) {
          editorEl = outlet.shadowRoot.querySelector("div.ql-editor, div[role='textbox'][contenteditable='true']");
        }
        if (!editorEl) {
          editorEl = document.querySelector("div.ql-editor, div[role='textbox'][contenteditable='true']");
        }
        if (editorEl) {
          editorEl.innerHTML = "";
          const formattedText = arguments[0].split('\\n').map(p => {
            const trimmed = p.trim();
            return trimmed ? '<p>' + p + '</p>' : '<p><br></p>';
          }).join('');
          editorEl.innerHTML = formattedText;
          editorEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      `, cleanedText);
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
          let btn = null;
          const outlet = document.getElementById("interop-outlet");
          if (outlet && outlet.shadowRoot) {
            btn = outlet.shadowRoot.querySelector("button.share-actions__primary-action, button[class*='primary-action']");
          }
          if (!btn) {
            btn = document.querySelector("button.share-actions__primary-action, button[class*='primary-action']");
          }
          return btn ? !btn.disabled : false;
        `);
        if (isEnabled) break;
        await sleep(500);
      }

      logger.info("LinkedInService: Clicking Post submission...");
      await postButton.click();
      await sleep(8000);

      logger.info("LinkedInService: Post submitted successfully!");

      if (commentText) {
        let postUrl = null;
        try {
          const currentUrl = await this.driver.getCurrentUrl();
          if (currentUrl.includes('/posts/') || currentUrl.includes('/feed/update/')) {
            postUrl = currentUrl;
            logger.info(`LinkedInService: Post URL captured directly: ${postUrl}`);
          }
        } catch (e) {}

        let clickedToast = false;
        if (postUrl && !postUrl.includes('/feed/')) {
          await this.driver.get(postUrl);
          await sleep(3000);
          clickedToast = true;
        } else {
          logger.info("LinkedInService: Post URL not captured directly. Detecting 'View post' success toast to open dedicated post URL...");
          for (let i = 0; i < 20; i++) {
            clickedToast = await this.driver.executeScript(`
              const toastBtn = Array.from(document.querySelectorAll("a, button, span, div")).find(el => {
                const txt = (el.textContent || "").toLowerCase().trim();
                return txt === "view post" || txt === "view" || txt === "view updates";
              });
              if (toastBtn) {
                toastBtn.click();
                return true;
              }
              return false;
            `);
            if (clickedToast) break;
            await sleep(500);
          }

          if (clickedToast) {
            logger.info("LinkedInService: Clicked success toast! Waiting for dedicated post page to render...");
            await sleep(5000);
          } else {
            logger.warn("LinkedInService: Success toast not detected. Falling back to feed-level first post container...");
          }
        }

        try {
          logger.info("LinkedInService: Scrolling social action bar or media into view to trigger comments...");
          await this.driver.executeScript(`
            const actionBar = document.querySelector(".social-actions, .feed-shared-social-action-bar, [class*='social-actions']");
            if (actionBar) {
              actionBar.scrollIntoView({ behavior: 'auto', block: 'center' });
            } else {
              const media = document.querySelector(".feed-shared-update-v2__content, .update-components-image, [class*='update-components-']");
              if (media) {
                media.scrollIntoView({ behavior: 'auto', block: 'end' });
              }
            }
          `);
          await sleep(2000);

          logger.info("LinkedInService: Scrolling page and layout containers to bottom...");
          await this.driver.executeScript(`
            window.scrollTo(0, 100000);
            if (document.documentElement) document.documentElement.scrollTop = 100000;
            if (document.body) document.body.scrollTop = 100000;
            
            const allElements = document.querySelectorAll("*");
            for (const el of allElements) {
              if (el.scrollHeight > el.clientHeight) {
                const style = window.getComputedStyle(el);
                if (style.overflowY === "auto" || style.overflowY === "scroll" || el.tagName === "MAIN" || el.tagName === "SECTION") {
                  el.scrollTop = el.scrollHeight;
                }
              }
            }
          `);
          await sleep(2000);

          logger.info("LinkedInService: Locating comments container...");
          await this.driver.executeScript(`
            const commentBox = document.querySelector(
              "[aria-label='Text editor for creating comment'], " +
              ".tiptap, " +
              ".ProseMirror"
            );
            if (commentBox) {
              commentBox.scrollIntoView({ behavior: 'auto', block: 'center' });
            }
          `);
          await sleep(1500);

          logger.info("LinkedInService: Locating comment editor...");
          const editorEl = await this.driver.wait(
            until.elementLocated(By.css(
              "[aria-label='Text editor for creating comment'], " +
              ".tiptap, " +
              ".ProseMirror"
            )),
            15000
          );
          
          logger.info("LinkedInService: Clicking comment editor to focus...");
          await this.driver.executeScript(`
            const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
            if (ed) { ed.focus(); ed.scrollIntoView({ behavior: 'auto', block: 'center' }); }
          `);
          await sleep(500);
          await editorEl.click();
          await sleep(800);

          logger.info("LinkedInService: Typing comment text via sendKeys (fires native key events ProseMirror handles)...");
          // sendKeys fires real OS-level key events which Tiptap/ProseMirror handles correctly
          // This is more reliable than execCommand in a remote debugging session
          await editorEl.sendKeys(Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE);
          await sleep(300);
          await editorEl.sendKeys(commentText);
          await sleep(2000);

          const editorContent = await this.driver.executeScript(`
            const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
            return ed ? ed.innerText.trim() : "";
          `);
          logger.info(`LinkedInService: Comment editor content preview: "${editorContent.substring(0, 80)}"`);

          logger.info("LinkedInService: Waiting for submit button to enable naturally...");
          let submitBtnEnabled = false;
          for (let i = 0; i < 25; i++) {
            submitBtnEnabled = await this.driver.executeScript(`
              const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
              if (!ed) return false;
              let parent = ed.parentElement;
              let submitBtn = null;
              while (parent && parent.tagName !== "BODY") {
                // The comment submit button has text 'Comment' and type='button' (not 'submit')
                const allBtns = parent.querySelectorAll("button");
                for (const b of allBtns) {
                  if (b.innerText.trim() === "Comment" && !b.disabled) {
                    submitBtn = b;
                    break;
                  }
                }
                if (submitBtn) break;
                parent = parent.parentElement;
              }
              if (!submitBtn) return false;
              submitBtn.scrollIntoView({ behavior: 'auto', block: 'center' });
              const rect = submitBtn.getBoundingClientRect();
              return rect.width > 0 && rect.height > 0;
            `);
            if (submitBtnEnabled) break;
            await sleep(400);
          }

          await sleep(500);
          logger.info(`LinkedInService: Submit button naturally enabled: ${submitBtnEnabled}. Clicking...`);

          // Locate the visible 'Comment' submit button and click via Actions
          let clicked = false;
          try {
            const submitBtnEl = await this.driver.executeScript(`
              const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
              if (!ed) return null;
              let parent = ed.parentElement;
              while (parent && parent.tagName !== "BODY") {
                const allBtns = parent.querySelectorAll("button");
                for (const b of allBtns) {
                  if (b.innerText.trim() === "Comment") {
                    const rect = b.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) return b;
                  }
                }
                parent = parent.parentElement;
              }
              return null;
            `);
            if (submitBtnEl) {
              await this.driver.executeScript(`arguments[0].scrollIntoView({ behavior: 'auto', block: 'center' });`, submitBtnEl);
              await sleep(500);
              const actions = this.driver.actions({ async: true });
              await actions.move({ origin: submitBtnEl }).click().perform();
              clicked = true;
              logger.info("LinkedInService: 'Comment' submit button clicked via Actions mouse click.");
            } else {
              logger.warn("LinkedInService: Could not find visible 'Comment' button.");
            }
          } catch (clickErr) {
            logger.warn(`LinkedInService: Actions click failed: ${clickErr.message}`);
          }

          if (!clicked) {
            logger.warn("LinkedInService: Falling back to Ctrl+Enter keyboard submit...");
            try {
              await editorEl.click();
              await sleep(300);
              const actions = this.driver.actions({ async: true });
              await actions
                .keyDown("\uE009") // Ctrl
                .sendKeys("\n")     // Enter
                .keyUp("\uE009")
                .perform();
            } catch (kbErr) {
              logger.error("LinkedInService: Keyboard submit also failed:", kbErr.message);
            }
          }

          // Wait for comment to be submitted — editor clears on success
          await sleep(5000);
          
          const commentPosted = await this.driver.executeScript(`
            const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
            // If editor is empty after submission, comment was posted successfully
            const editorEmpty = !ed || ed.innerText.trim() === "" || ed.innerText.trim() === "\\n";
            const hasError = document.body.innerText.toLowerCase().includes("something went wrong");
            return editorEmpty && !hasError;
          `);
          logger.info(`LinkedInService: Comment posted: ${commentPosted}`);
          
          // Always save screenshot for inspection
          try {
            const screenshot = await this.driver.takeScreenshot();
            fs.writeFileSync("linkedin-comment-result.png", screenshot, "base64");
            logger.info("LinkedInService: Screenshot saved to linkedin-comment-result.png");
          } catch (e) {}

        } catch (commentErr) {
          logger.error("LinkedInService: Failed to post first comment:", commentErr);
          try {
            const screenshot = await this.driver.takeScreenshot();
            fs.writeFileSync("linkedin-comment-failed.png", screenshot, "base64");
            logger.info("LinkedInService: Screenshot saved to linkedin-comment-failed.png for debugging");
          } catch (e) {}
        }
      }

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
      writer.on("error", (err) => {
        writer.destroy();
        reject(err);
      });
    });
  }

  async generateSlideImage(title, points, slideTagline = "Curated by AI \u00b7 Updated Weekly", authorHandle = "github.com/Drix10") {
    let originalHandle = null;
    let renderTabOpened = false;
    let originalSize = null;

    try {
      await this.ensureDriverConnected();
    } catch (err) {
      logger.error("LinkedInService: Failed to ensure driver connected for slide image:", err);
      return null;
    }

    try {
      originalHandle = await this.driver.getWindowHandle();
    } catch (e) {}

    try {
      originalSize = await this.driver.manage().window().getSize();
    } catch (e) {}

    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const safePoints = Array.isArray(points) ? points : [];
    const accents = [
      { border: "rgba(249, 115, 22, 0.4)", numBg: "linear-gradient(135deg, #ea580c 0%, #7c2d12 100%)", glow: "rgba(249, 115, 22, 0.3)", textColor: "#ffedd5" },
      { border: "rgba(99, 102, 241, 0.4)", numBg: "linear-gradient(135deg, #4f46e5 0%, #312e81 100%)", glow: "rgba(99, 102, 241, 0.3)", textColor: "#e0e7ff" },
      { border: "rgba(16, 185, 129, 0.4)", numBg: "linear-gradient(135deg, #059669 0%, #064e3b 100%)", glow: "rgba(16, 185, 129, 0.3)", textColor: "#d1fae5" }
    ];

    const pointsHtml = safePoints.map((pt, i) => {
      const acc = accents[i] || accents[0];
      return `
        <div class="point-item" style="border-left: 5px solid ${acc.border}; box-shadow: 0 12px 40px rgba(0,0,0,0.4), inset 0 0 15px ${acc.glow};">
          <div class="point-num" style="background: ${acc.numBg}; border: 1px solid ${acc.border}; box-shadow: 0 0 15px ${acc.glow}; color: ${acc.textColor};">${i + 1}</div>
          <div class="point-text">${esc(pt)}</div>
        </div>
      `;
    }).join("");
    
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1080px;
      height: 1350px;
      display: flex;
      flex-direction: column;
      background: radial-gradient(circle at 50% 0%, #201a15 0%, #0a0806 70%, #020101 100%);
      background-image: radial-gradient(circle at 50% 0%, #201a15 0%, #0a0806 70%, #020101 100%), radial-gradient(rgba(255, 255, 255, 0.03) 1.5px, transparent 0);
      background-size: 100% 100%, 32px 32px;
      color: #f5f5f4;
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
      padding: 70px 85px 60px;
    }
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 45px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      border: 1px solid rgba(249, 115, 22, 0.15);
      background: rgba(43, 30, 20, 0.4);
      backdrop-filter: blur(8px);
      padding: 10px 22px;
      border-radius: 99px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #ffedd5;
      box-shadow: 0 4px 15px rgba(0,0,0,0.25);
    }
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f97316;
      box-shadow: 0 0 10px #f97316;
    }
    .logo-area {
      font-family: 'JetBrains Mono', monospace;
      font-size: 15px;
      color: #a8a29e;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    .hero-section {
      margin-bottom: 40px;
      border-left: 4px solid;
      border-image: linear-gradient(to bottom, #f97316, #ea580c, transparent) 1;
      padding-left: 32px;
    }
    .eyebrow {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
      color: #fed7aa;
      margin-bottom: 16px;
    }
    .title {
      font-size: 54px;
      font-weight: 800;
      line-height: 1.15;
      background: linear-gradient(135deg, #ffffff 30%, #ffedd5 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.03em;
    }
    .points-section {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .point-item {
      display: flex;
      align-items: flex-start;
      gap: 28px;
      padding: 24px 32px;
      background: rgba(28, 25, 23, 0.45);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
      transition: all 0.3s ease;
    }
    .point-num {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #ea580c 0%, #7c2d12 100%);
      border: 1px solid #f97316;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 19px;
      font-weight: 700;
      color: #ffedd5;
      box-shadow: 0 0 15px rgba(249, 115, 22, 0.25);
    }
    .point-text {
      font-size: 22px;
      font-weight: 500;
      color: #e4e4e7;
      line-height: 1.45;
    }
    .footer {
      margin-top: 40px;
      padding-top: 25px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
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
      font-size: 20px;
      filter: drop-shadow(0 0 8px #f97316);
    }
    .footer-text {
      font-size: 16px;
      color: #a8a29e;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .save-cta {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #292524 0%, #1c1917 100%);
      border: 1px solid rgba(255, 255, 255, 0.08);
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      color: #ffedd5;
      box-shadow: 0 4px 15px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.05);
      letter-spacing: 0.01em;
    }
  </style>
</head>
<body>
  <div class="content">
    <div class="top-bar">
      <div class="badge"><span class="badge-dot"></span>Tech Curation</div>
      <div class="logo-area">${esc(authorHandle)}</div>
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
      
      // Use massive window dimensions to comfortably fit the 1080x1350 canvas even on high Windows DPI/OS scaling
      await this.driver.manage().window().setSize({ width: 1500, height: 1800 });
      await this.driver.get(fileUrl);
      await sleep(2500); // Wait for Google Fonts to load
      
      const imagePath = path.join(tempDir, `slide-${Date.now()}.png`);
      // Find body element and take element-level screenshot to capture exact 1080x1350 area without window scrollbars or border clipping
      const bodyEl = await this.driver.findElement(By.css("body"));
      const screenshotData = await bodyEl.takeScreenshot();
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
