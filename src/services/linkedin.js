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
      this.cleanupDebugScreenshots();
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
    } catch (e) { }

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
          } catch (urlErr) { }

          if (hostname.endsWith(domainKeyword) || hostname === domainKeyword) {
            if (!domainMatchHandle) {
              domainMatchHandle = handle;
            }
            if (pathKeyword && url.includes(pathKeyword)) {
              bestMatchHandle = handle;
              break;
            }
          }
        } catch (err) { }
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
        } catch (restoreErr) { }
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
    let postSucceeded = false;
    let commentSucceeded = !commentText;

    const cleanedText = text
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/`(.*?)`/g, "$1")
      .replace(/^#+\s*(.*?)$/gm, "$1")
      .replace(/\[(.*?)\]\((.*?)\)/g, "$1: $2");

    try {
      await this.ensureDriverConnected();

      try {
        originalHandle = await this.driver.getWindowHandle();
      } catch (e) { }

      logger.info("Switching to existing LinkedIn tab...");
      const matched = await this.switchToTab("linkedin.com", "/feed");
      if (!matched) {
        logger.info("LinkedInService: No existing feed tab found, navigating current tab to feed...");
        await this.driver.get("https://www.linkedin.com/feed/");
      }
      await sleep(4000);

      if (imageUrl) {
        logger.info("Locating 'Photo' or 'Start a post' trigger on feed page...");
        const triggered = await this.driver.executeScript(`
          const all = Array.from(document.querySelectorAll("button, a, span, div, p"));
          const photoBtn = all.find(el => {
            const text = (el.textContent || "").trim().toLowerCase();
            const aria  = (el.getAttribute("aria-label") || "").toLowerCase();
            return (text === "photo" || aria.includes("photo") || aria.includes("image") || aria.includes("add a photo") || aria.includes("media"));
          });
          if (photoBtn) {
            photoBtn.click();
            return "photo";
          }
          const postBtn = all.find(el => (el.textContent || "").trim().toLowerCase() === "start a post");
          if (postBtn) {
            postBtn.click();
            return "post";
          }
          return null;
        `);
        logger.info(`LinkedInService: Trigger result: ${triggered}`);
      } else {
        logger.info("LinkedInService: Locating 'Start a post' trigger for text-only post...");
        const postTrigger = await this.driver.executeScript(`
          const all = Array.from(document.querySelectorAll("p, span, button, div, a"));
          return all.find(el => (el.textContent || "").trim().toLowerCase() === "start a post") || null;
        `);
        if (postTrigger) {
          await this.driver.executeScript(`arguments[0].click();`, postTrigger);
        } else {
          const fallback = await this.driver.wait(
            until.elementLocated(By.css("[aria-label*='Start a post'], a[href*='sharebox'], .share-box-feed-entry__trigger")),
            8000
          );
          await fallback.click();
        }
      }
      await sleep(4000);

      if (imageUrl) {
        try {
          isRemote = imageUrl.startsWith("http");
          localImagePath = imageUrl;

          if (isRemote) {
            const tempDir = path.join(process.cwd(), "temp");
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            let ext = ".jpg";
            try { ext = path.extname(new URL(imageUrl).pathname.split("?")[0]) || ".jpg"; } catch (e) { }
            localImagePath = path.join(tempDir, `linkedin-upload-${Date.now()}${ext}`);
            logger.info(`LinkedInService: Downloading image from ${imageUrl}...`);
            await this.downloadImageWithRetry(imageUrl, localImagePath);
            logger.info(`LinkedInService: Image downloaded to ${localImagePath}`);
          } else {
            logger.info(`LinkedInService: Using local image path for upload: ${localImagePath}`);
          }

          logger.info("LinkedInService: Locating hidden file input and uploading image...");
          let fileInput = null;
          for (let attempt = 0; attempt < 10; attempt++) {
            try {
              fileInput = await this._getShadowEl("input[type='file']", 3000);
              if (fileInput) break;
            } catch (e) { }

            // If file input not found, try clicking media button inside open modal
            await this.driver.executeScript(`
              const modal = document.querySelector("div[class*='share-creation-state'], div[aria-label='Create a post'], div[role='dialog'], #interop-outlet");
              if (modal) {
                const root = (modal.shadowRoot || modal);
                const mediaBtn = Array.from(root.querySelectorAll("button, label, span")).find(b => {
                  const label = (b.getAttribute("aria-label") || b.textContent || "").toLowerCase();
                  return label.includes("media") || label.includes("photo") || label.includes("image");
                });
                if (mediaBtn) mediaBtn.click();
              }
            `);
            await sleep(1500);
          }

          if (!fileInput) {
            fileInput = await this._getShadowEl("input[type='file']", 5000);
          }

          await fileInput.sendKeys(path.resolve(localImagePath));
          logger.info("LinkedInService: Uploaded image file path to input element");

          let imagePreviewReady = false;
          for (let i = 0; i < 20; i++) {
            imagePreviewReady = await this.driver.executeScript(`
              const outlet = document.getElementById("interop-outlet");
              const root = (outlet && outlet.shadowRoot) ? outlet.shadowRoot : document;
              const nextBtn = root.querySelector("button[aria-label='Next'], button.share-box-footer__primary-btn, button[class*='primary-btn']");
              return nextBtn && !nextBtn.disabled;
            `);
            if (imagePreviewReady) break;
            await sleep(1000);
          }

          if (!imagePreviewReady) {
            logger.warn("LinkedInService: Image preview did not become ready within timeout. Attempting to proceed anyway...");
          }

          logger.info("LinkedInService: Confirming image preview (Next button)...");
          try {
            const nextButton = await this._getShadowEl(
              "button[aria-label='Next'], button.share-box-footer__primary-btn, button[class*='primary-btn']",
              8000
            );
            await nextButton.click();
            await sleep(4000);
          } catch (e) {
            logger.warn("LinkedInService: Next button click skipped or not required.");
          }
        } catch (imageUploadErr) {
          logger.warn(`LinkedInService: Image upload failed (${imageUploadErr.message}). Gracefully degrading to text-only post...`);
        }
      }

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

      logger.info("LinkedInService: Locating post submission button inside Shadow DOM...");
      const postButton = await this._getShadowEl(
        "button.share-actions__primary-action, button[class*='primary-action']",
        15000
      );

      let isEnabled = false;
      for (let i = 0; i < 30; i++) {
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

      if (!isEnabled) {
        logger.warn("LinkedInService: Post button did not become enabled within timeout. Attempting click anyway...");
      }

      logger.info("LinkedInService: Clicking Post submission...");
      await postButton.click();

      let postConfirmAttempts = 0;
      const MAX_POST_CONFIRM = 15;
      let postConfirmed = false;
      while (postConfirmAttempts < MAX_POST_CONFIRM) {
        await sleep(1000);
        const modalClosed = await this.driver.executeScript(`
          const outlet = document.getElementById("interop-outlet");
          const root = (outlet && outlet.shadowRoot) ? outlet.shadowRoot : document;
          const modal = root.querySelector("div[class*='share-creation-state'], div[aria-label='Create a post']");
          return !modal;
        `).catch(() => false);
        if (modalClosed) {
          postConfirmed = true;
          break;
        }
        postConfirmAttempts++;
      }

      await sleep(3000);
      if (postConfirmed) {
        postSucceeded = true;
        logger.info("LinkedInService: Post submitted successfully!");
      } else {
        logger.warn("LinkedInService: Post confirmation did not complete within timeout.");
      }

      if (commentText) {
        let postUrl = null;
        try {
          const currentUrl = await this.driver.getCurrentUrl();
          if (currentUrl.includes('/posts/') || currentUrl.includes('/feed/update/')) {
            postUrl = currentUrl;
            logger.info(`LinkedInService: Post URL captured directly: ${postUrl}`);
          }
        } catch (e) { }

        let clickedToast = false;
        if (postUrl && !postUrl.includes('/feed/')) {
          await this.driver.get(postUrl);
          await sleep(3000);
          clickedToast = true;
        } else {
          logger.info("LinkedInService: Post URL not captured directly. Detecting 'View post' success toast...");
          for (let i = 0; i < 30; i++) {
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

          logger.info("LinkedInService: Locating comments container and clicking Comment trigger if needed...");
          await this.driver.executeScript(`
            const existingEd = document.querySelector(
              "[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror"
            );
            if (!existingEd) {
              const commentBtn = Array.from(document.querySelectorAll("button, span, div, a")).find(el => {
                const aria = (el.getAttribute("aria-label") || "").toLowerCase();
                const txt = (el.textContent || "").trim().toLowerCase();
                return aria.includes("comment") || txt === "comment" || txt === "commenter";
              });
              if (commentBtn) commentBtn.click();
            }
          `);
          await sleep(2000);

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

          logger.info("LinkedInService: Typing comment text via sendKeys...");
          await editorEl.sendKeys(Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE);
          await sleep(300);
          await editorEl.sendKeys(commentText);
          await sleep(2000);

          const editorContent = await this.driver.executeScript(`
            const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
            return ed ? ed.innerText.trim() : "";
          `);
          logger.info(`LinkedInService: Comment editor content preview: "${editorContent.substring(0, 80)}"`);

          if (!editorContent || editorContent.trim().length === 0) {
            logger.warn("LinkedInService: Comment editor appears empty after typing. Comment may not have been entered.");
          }

          logger.info("LinkedInService: Waiting for submit button to enable naturally...");
          let submitBtnEnabled = false;
          for (let i = 0; i < 25; i++) {
            submitBtnEnabled = await this.driver.executeScript(`
              const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
              if (!ed) return false;
              let parent = ed.parentElement;
              let submitBtn = null;
              while (parent && parent.tagName !== "BODY") {
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
                .keyDown("\uE009")
                .sendKeys("\n")
                .keyUp("\uE009")
                .perform();
            } catch (kbErr) {
              logger.error("LinkedInService: Keyboard submit also failed:", kbErr.message);
            }
          }

          await sleep(5000);

          let commentVerificationAttempts = 0;
          const commentSnippet = commentText.substring(0, 40);
          const initialCommentCount = await this.driver.executeScript(`
            const comments = Array.from(document.querySelectorAll('[data-testid*="comment"], .comments-comment-item, .comments-comments-list__comment-item'));
            return comments.length;
          `).catch(() => 0);

          while (commentVerificationAttempts < 5) {
            const commentState = await this.driver.executeScript(`
              const ed = document.querySelector("[aria-label='Text editor for creating comment'], .tiptap, .ProseMirror");
              const editorEmpty = !ed || ed.innerText.trim() === "" || ed.innerText.trim() === "\\n";
              const hasError = document.body.innerText.toLowerCase().includes("something went wrong");
              const hasNewComment = document.body.innerText.includes(arguments[0]);
              return { editorEmpty, hasError, hasNewComment };
            `, commentSnippet);

            if (commentState.hasNewComment && !commentState.hasError) {
              const laterCommentCount = await this.driver.executeScript(`
                const comments = Array.from(document.querySelectorAll('[data-testid*="comment"], .comments-comment-item, .comments-comments-list__comment-item'));
                return comments.length;
              `).catch(() => initialCommentCount);

              if (laterCommentCount > initialCommentCount) {
                commentSucceeded = true;
                logger.info("LinkedInService: Comment posted and verified successfully.");
                break;
              }
            }

            if (commentState.editorEmpty && !commentState.hasError) {
              logger.info("LinkedInService: Comment editor is empty and no error is present; assuming the comment was submitted.");
              commentSucceeded = true;
              break;
            }

            commentVerificationAttempts++;
            await sleep(2000);
          }

          if (!commentSucceeded) {
            logger.warn("LinkedInService: Comment could not be verified as posted.");
            try {
              const screenshot = await this.driver.takeScreenshot();
              const screenshotPath = path.join(process.cwd(), "temp", `linkedin-comment-${Date.now()}.png`);
              const tempDir = path.join(process.cwd(), "temp");
              if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
              fs.writeFileSync(screenshotPath, screenshot, "base64");
              logger.info(`LinkedInService: Screenshot saved to ${screenshotPath}`);
            } catch (e) { }
          }

        } catch (commentErr) {
          logger.error("LinkedInService: Failed to post first comment:", commentErr);
          try {
            const tempDir = path.join(process.cwd(), "temp");
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            const screenshot = await this.driver.takeScreenshot();
            fs.writeFileSync(path.join(tempDir, `linkedin-comment-failed-${Date.now()}.png`), screenshot, "base64");
            logger.info("LinkedInService: Screenshot saved for debugging");
          } catch (e) { }
        }
      }

      // A successful post must not be retried just because the optional first
      // comment could not be verified; retrying could create duplicate posts.
      return postSucceeded;
    } catch (error) {
      logger.error("LinkedInService: Failed to post to LinkedIn:", error);
      try {
        const tempDir = path.join(process.cwd(), "temp");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
        const screenshot = await this.driver.takeScreenshot();
        fs.writeFileSync(path.join(tempDir, `linkedin-post-failed-${Date.now()}.png`), screenshot, "base64");
      } catch (e) { }
      return false;
    } finally {
      try {
        if (localImagePath && fs.existsSync(localImagePath)) {
          fs.unlinkSync(localImagePath);
          logger.info(`LinkedInService: Cleaned up temporary image file: ${localImagePath}`);
        }
      } catch (e) { }

      if (originalHandle) {
        try { await this.driver.switchTo().window(originalHandle); } catch (e) { }
      }
    }
  }

  async downloadImageWithRetry(url, destPath, retries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
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
        return await new Promise((resolve, reject) => {
          const writer = fs.createWriteStream(destPath);
          response.data.pipe(writer);
          response.data.on("error", (err) => {
            writer.destroy();
            reject(err);
          });
          writer.on("finish", resolve);
          writer.on("error", (err) => {
            response.data.destroy();
            reject(err);
          });
        });
      } catch (err) {
        lastError = err;
        logger.warn(`LinkedInService: Image download attempt ${attempt}/${retries} failed: ${err.message}`);
        if (attempt < retries) {
          await sleep(2000 * attempt);
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath); } catch (e) { }
          }
        }
      }
    }
    throw lastError;
  }

  async generateSlideImage(title, points, slideTagline = "Systems Architecture Teardown · Drix10", authorHandle = "github.com/Drix10/ai-resources", options = {}) {
    let originalHandle = null;
    let renderTabOpened = false;
    let originalSize = null;
    let htmlPath = null;

    try {
      await this.ensureDriverConnected();
    } catch (err) {
      logger.error("LinkedInService: Failed to ensure driver connected for slide image:", err);
      return null;
    }

    try {
      originalHandle = await this.driver.getWindowHandle();
    } catch (e) { }

    try {
      originalSize = await this.driver.manage().window().getSize();
    } catch (e) { }

    const tempDir = path.join(process.cwd(), "temp");
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

    const safePoints = Array.isArray(points) ? points : [];
    const allText = [title, ...safePoints].join(" ");

    // Dynamic structure badge mapping
    const badgeMap = {
      "problem-insight-framework": "SYSTEMS_FRAMEWORK // v2.6",
      "before-after": "PERFORMANCE_AUDIT // v2.6",
      "story-arc": "FOUNDER_CASE_STUDY // v2.6",
      "contrarian-proof-action": "CONTRARIAN_ANALYSIS // v2.6",
      "breakdown-teardown": "ARCH_TEARDOWN // v2.6"
    };
    const structureKey = (options && options.structureName) ? options.structureName : "";
    const statusBadgeText = badgeMap[structureKey] || "ARCH_TEARDOWN // v2.6";
    const eyebrowText = "// " + statusBadgeText.replace(/\s*\/\/.*$/, "").replace(/_/g, " ");

    // Extract dynamic metrics for ribbon pills strictly from source text (NO fabricated claims)
    const rawMetrics = [];
    const percentMatches = allText.match(/\b\d+(?:\.\d+)?%/g) || [];
    const multiMatches = allText.match(/\b\d+(?:\.\d+)?x\b/gi) || [];
    const latencyMatches = allText.match(/\b\d+(?:\.\d+)?\s*(?:ms|s)\b/gi) || [];

    if (percentMatches[0]) rawMetrics.push(`⚡ ${percentMatches[0]} Metric`);
    if (multiMatches[0]) rawMetrics.push(`🚀 ${multiMatches[0]} Speedup`);
    if (latencyMatches[0]) rawMetrics.push(`⏱️ ${latencyMatches[0]} Latency`);

    // Strictly grounded metrics: only display real numbers actually found in the source
    const metricsToDisplay = rawMetrics.slice(0, 3);

    // Grounded diagram steps from options (only render if meaningful steps exist)
    const diagramSteps = (options && Array.isArray(options.diagramSteps) && options.diagramSteps.length >= 3)
      ? options.diagramSteps
      : null;

    const accents = [
      { border: "rgba(16, 185, 129, 0.7)", numBg: "linear-gradient(135deg, #059669 0%, #064e3b 100%)", glow: "rgba(16, 185, 129, 0.25)", textColor: "#d1fae5", badge: "#10b981" },
      { border: "rgba(245, 158, 11, 0.7)", numBg: "linear-gradient(135deg, #d97706 0%, #78350f 100%)", glow: "rgba(245, 158, 11, 0.25)", textColor: "#fef3c7", badge: "#f59e0b" },
      { border: "rgba(59, 130, 246, 0.7)", numBg: "linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)", glow: "rgba(59, 130, 246, 0.25)", textColor: "#dbeafe", badge: "#3b82f6" }
    ];

    const pointsHtml = safePoints.map((pt, i) => {
      const acc = accents[i] || accents[0];
      const cleanPt = esc(pt).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      return `
        <div class="point-item" style="border-left: 4px solid ${acc.border}; box-shadow: 0 16px 36px rgba(0,0,0,0.5), inset 0 0 20px ${acc.glow};">
          <div class="point-num" style="background: ${acc.numBg}; border: 1px solid ${acc.border}; box-shadow: 0 0 16px ${acc.glow}; color: ${acc.textColor};">0${i + 1}</div>
          <div class="point-text">${cleanPt}</div>
        </div>
      `;
    }).join("");

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1080px;
      height: 1350px;
      display: flex;
      flex-direction: column;
      background: #09090b;
      background-image: 
        radial-gradient(circle at 85% 12%, rgba(245, 158, 11, 0.12) 0%, transparent 45%),
        radial-gradient(circle at 15% 88%, rgba(16, 185, 129, 0.12) 0%, transparent 45%),
        linear-gradient(to right, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
        linear-gradient(to bottom, rgba(255, 255, 255, 0.035) 1px, transparent 1px);
      background-size: 100% 100%, 100% 100%, 48px 48px, 48px 48px;
      color: #f4f4f5;
      font-family: 'Inter', -apple-system, sans-serif;
      overflow: hidden;
      position: relative;
    }
    .content {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 64px 76px 56px;
    }
    .header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 38px;
    }
    .founder-card {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .avatar {
      width: 52px;
      height: 52px;
      border-radius: 12px;
      background: linear-gradient(135deg, #18181b 0%, #27272a 100%);
      border: 1px solid rgba(16, 185, 129, 0.5);
      box-shadow: 0 0 16px rgba(16, 185, 129, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 800;
      font-size: 20px;
      color: #10b981;
    }
    .founder-info {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .founder-name {
      font-size: 19px;
      font-weight: 700;
      color: #ffffff;
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.01em;
    }
    .verified-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      background: #10b981;
      color: #09090b;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 900;
    }
    .founder-role {
      font-size: 13px;
      color: #a1a1aa;
      font-family: 'JetBrains Mono', monospace;
      font-weight: 500;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: rgba(24, 24, 27, 0.7);
      backdrop-filter: blur(12px);
      padding: 10px 18px;
      border-radius: 9999px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      color: #e4e4e7;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #10b981;
      box-shadow: 0 0 10px #10b981;
    }
    .hero-box {
      margin-bottom: 28px;
      border-left: 4px solid #10b981;
      padding-left: 28px;
    }
    .eyebrow {
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #10b981;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .title {
      font-size: 46px;
      font-weight: 800;
      line-height: 1.18;
      background: linear-gradient(135deg, #ffffff 40%, #f4f4f5 75%, #a1a1aa 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      letter-spacing: -0.035em;
    }
    .metrics-ribbon {
      display: flex;
      gap: 12px;
      margin-bottom: 26px;
      flex-wrap: wrap;
    }
    .metric-pill {
      display: inline-flex;
      align-items: center;
      padding: 8px 16px;
      background: rgba(24, 24, 27, 0.75);
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      color: #fef08a;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
    }
    .diagram-strip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: rgba(18, 18, 23, 0.7);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255, 255, 255, 0.07);
      border-radius: 12px;
      padding: 14px 22px;
      margin-bottom: 28px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      font-weight: 600;
      color: #a1a1aa;
    }
    .diagram-step {
      display: flex;
      align-items: center;
      gap: 6px;
      color: #e4e4e7;
    }
    .diagram-step.active {
      color: #10b981;
    }
    .diagram-arrow {
      color: #52525b;
      font-weight: 900;
    }
    .points-section {
      flex-grow: 1;
      display: flex;
      flex-direction: column;
      gap: 26px;
      margin-top: 10px;
    }
    .point-item {
      display: flex;
      align-items: flex-start;
      gap: 26px;
      padding: 28px 34px;
      background: rgba(18, 18, 23, 0.65);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 16px;
      transition: all 0.2s ease;
    }
    .point-num {
      flex-shrink: 0;
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'JetBrains Mono', monospace;
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .point-text {
      font-size: 22px;
      font-weight: 500;
      color: #e4e4e7;
      line-height: 1.48;
      letter-spacing: -0.01em;
    }
    .point-text strong {
      color: #ffffff;
      font-weight: 700;
    }
    .footer {
      margin-top: 32px;
      padding-top: 22px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .footer-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .footer-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #f59e0b;
    }
    .footer-text {
      font-size: 14px;
      color: #a1a1aa;
      font-weight: 600;
      font-family: 'JetBrains Mono', monospace;
    }
    .footer-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(24, 24, 27, 0.8);
      border: 1px solid rgba(255, 255, 255, 0.09);
      padding: 10px 20px;
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      font-weight: 600;
      color: #e4e4e7;
    }
  </style>
</head>
<body>
  <div class="content">
    <div class="header-bar">
      <div class="founder-card">
        <div class="avatar">DG</div>
        <div class="founder-info">
          <div class="founder-name">Drishtant Ghosh (Drix10) <span class="verified-icon">✓</span></div>
          <div class="founder-role">Co-Founder @ PartPilot · AI Systems Architect</div>
        </div>
      </div>
      <div class="status-badge">
        <span class="pulse-dot"></span>
        <span>${esc(statusBadgeText)}</span>
      </div>
    </div>

    <div class="hero-box">
      <div class="eyebrow">${esc(eyebrowText)}</div>
      <div class="title">${esc(title)}</div>
    </div>

    ${metricsToDisplay.length > 0 ? `
    <div class="metrics-ribbon">
      ${metricsToDisplay.map(m => `<div class="metric-pill">${esc(m)}</div>`).join("")}
    </div>
    ` : ''}

    ${diagramSteps ? `
    <div class="diagram-strip">
      ${diagramSteps.map((step, idx) => `
        <div class="diagram-step ${idx === 1 ? "active" : ""}">${esc(step)}</div>
        ${idx < diagramSteps.length - 1 ? '<div class="diagram-arrow">➔</div>' : ''}
      `).join("")}
    </div>
    ` : ''}

    <div class="points-section">
      ${pointsHtml}
    </div>

    <div class="footer">
      <div class="footer-left">
        <span class="footer-dot"></span>
        <span class="footer-text">${esc(slideTagline)}</span>
      </div>
      <div class="footer-badge">${esc(authorHandle)} ★</div>
    </div>
  </div>
</body>
</html>`;

    htmlPath = path.join(tempDir, `slide-${Date.now()}.html`);
    fs.writeFileSync(htmlPath, htmlContent);
    const fileUrl = "file:///" + htmlPath.replace(/\\/g, "/");
    logger.info(`LinkedInService: Loading generated slide HTML: ${fileUrl}`);

    try {
      await this.driver.switchTo().newWindow("tab");
      renderTabOpened = true;

      await this.driver.manage().window().setSize({ width: 1500, height: 1800 });
      await this.driver.get(fileUrl);

      await this.driver.executeScript(`
        return new Promise((resolve) => {
          let resolved = false;
          const done = () => { if (!resolved) { resolved = true; resolve(); } };
          if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(done);
          }
          setTimeout(done, 5000);
        });
      `);
      await sleep(1000);

      const bodyReady = await this.driver.executeScript(`
        const body = document.body;
        return body && body.offsetHeight > 0 && body.offsetWidth > 0;
      `);

      if (!bodyReady) {
        logger.warn("LinkedInService: Slide body not ready for screenshot.");
        return null;
      }

      const imagePath = path.join(tempDir, `slide-${Date.now()}.png`);
      let screenshotBuffer = null;

      try {
        if (typeof this.driver.sendAndGetDevToolsCommand === "function") {
          await this.driver.sendAndGetDevToolsCommand("Emulation.setDeviceMetricsOverride", {
            width: 1080,
            height: 1350,
            deviceScaleFactor: 1,
            mobile: false
          });
          const cdpScreenshot = await this.driver.sendAndGetDevToolsCommand("Page.captureScreenshot", {
            format: "png",
            clip: {
              x: 0,
              y: 0,
              width: 1080,
              height: 1350,
              scale: 1
            }
          });
          if (cdpScreenshot && cdpScreenshot.data) {
            screenshotBuffer = Buffer.from(cdpScreenshot.data, "base64");
          }
        }
      } catch (cdpErr) {
        logger.warn("LinkedInService: CDP screenshot failed, falling back to element screenshot:", cdpErr.message);
      }

      if (!screenshotBuffer) {
        const bodyEl = await this.driver.findElement(By.css("body"));
        const screenshotData = await bodyEl.takeScreenshot();
        screenshotBuffer = Buffer.from(screenshotData, "base64");
      }

      fs.writeFileSync(imagePath, screenshotBuffer);
      logger.info(`LinkedInService: Generated slide image screenshot saved to ${imagePath}`);

      return imagePath;
    } catch (err) {
      logger.error("LinkedInService: Failed to render slide image in browser tab:", err);
      return null;
    } finally {
      if (htmlPath && fs.existsSync(htmlPath)) {
        try { fs.unlinkSync(htmlPath); } catch (e) { }
      }

      try {
        if (typeof this.driver?.sendAndGetDevToolsCommand === "function") {
          await this.driver.sendAndGetDevToolsCommand("Emulation.clearDeviceMetricsOverride", {});
        }
      } catch (e) { }

      if (renderTabOpened) {
        try { await this.driver.close(); } catch (closeErr) { }
      }
      if (originalHandle) {
        try { await this.driver.switchTo().window(originalHandle); } catch (switchErr) { }
      }
      if (originalSize) {
        try { await this.driver.manage().window().setSize({ width: originalSize.width, height: originalSize.height }); } catch (resizeErr) { }
      }
    }
  }

  cleanupDebugScreenshots() {
    try {
      const tempDir = path.join(process.cwd(), "temp");
      if (!fs.existsSync(tempDir)) return;
      const files = fs.readdirSync(tempDir).filter(f =>
        (f.startsWith("linkedin-") || f.startsWith("slide-")) &&
        (f.endsWith(".png") || f.endsWith(".html") || f.endsWith(".jpg") || f.endsWith(".jpeg"))
      );
      const now = Date.now();
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        try {
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > 3600000) {
            fs.unlinkSync(filePath);
            logger.info(`LinkedInService: Cleaned up old temporary file: ${file}`);
          }
        } catch (e) { }
      }
    } catch (error) {
      logger.warn("LinkedInService: Failed to cleanup temporary files:", error.message);
    }
  }

  async cleanup() {
    try {
      if (this.driver) {
        logger.info("LinkedInService: Releasing WebDriver control of debugging browser session");
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
