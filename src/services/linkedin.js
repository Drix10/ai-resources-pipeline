const { By, Key } = require("selenium-webdriver");
const { logger, sleep } = require("../utils/helpers");
const { attachDriver, releaseDriver, MOD_KEY } = require("../utils/chromeLauncher");
const fs = require("fs");
const path = require("path");

// Card lookup shared by scan/like/comment/follow. Home feed cards are children of
// mainFeed; other pages (content search, profile activity) have no mainFeed, so
// fall back to list items inside <main>. Sets `cards` (never null).
const CARDS_JS = `
  const feedRoot = document.querySelector('div[data-testid="mainFeed"]');
  const cards = feedRoot
    ? Array.from(feedRoot.children).filter(c => (c.innerText || '').includes('Feed post'))
    : Array.from(document.querySelectorAll('main li, main [role="listitem"]')).filter(c => (c.innerText || '').length > 200 && !(c.parentElement && c.parentElement.closest('li, [role="listitem"]')));
`;

class LinkedInService {
  constructor() {
    this.driver = null;
    this.isInitialized = false;
    this._isLoggedIn = false;
  }

  async ensureDriverConnected(requireLogin = false) {
    if (!this.driver || !this.isInitialized) {
      await this.init(requireLogin);
      return;
    }
    try {
      await this.driver.getCurrentUrl();
    } catch (err) {
      logger.warn(`LinkedInService: WebDriver session was lost or invalid (${err.message}). Reinitializing...`);
      this.isInitialized = false;
      this._isLoggedIn = false;
      await this.cleanup();
      await this.init(requireLogin);
      return;
    }

    if (requireLogin && !this._isLoggedIn) {
      await this.checkLogin();
      this._isLoggedIn = true;
    }
  }

  async init(requireLogin = true) {
    try {
      if (!this.driver || !this.isInitialized) {
        this.driver = await attachDriver();
        logger.info("LinkedInService: Connected to existing Chrome browser on port 9222");
        this.isInitialized = true;
      }
      if (requireLogin && !this._isLoggedIn) {
        await this.checkLogin();
        this._isLoggedIn = true;
      }
      this.cleanupDebugScreenshots();
    } catch (error) {
      logger.error("LinkedInService: Failed to initialize:", error);
      this.isInitialized = false;
      this._isLoggedIn = false;
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

          // Exact host or a real subdomain: "notlinkedin.com" must not match.
          if (hostname === domainKeyword || hostname.endsWith(`.${domainKeyword}`)) {
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


  // FEED SCAN: real LinkedIn markup (hashed classes, no data-urn). On the home feed, cards are
  // the mainFeed children containing "Feed post" (sort is set to Top or Recent); on content
  // search and profile pages they are the outermost list items (see CARDS_JS).
  // Identity = sha1 of the post text, so the same post is one post whichever page it is found on;
  // legacyKey (author link + text) is kept to recognise posts tracked before that change.
  // Pure predicate so the spam gate is unit-testable without a browser.
  // Life updates (joined, new role, promotion, anniversary) are CONGRATS targets,
  // not spam. Only LinkedIn's own "Promoted" ad label is filtered - matched in the
  // card header, and never when the body talks about a promotion.
  static isFeedSpamText(text) {
    const FEED_SPAM = [
      "we are hiring", "we're hiring", "hiring for", "hiring our", "dm me to", "join my team", "dm for",
      "check out my course", "buy my book", "join the waitlist", "sign up now",
      "use my code", "limited spots", "giveaway", "subscribe for", "link in bio",
      "say congrats", "congratulate", "only connections can comment",
      "apply:", "apply here", "reopen applications", "rolling basis", "currently unpaid", "send your resume", "send in your resume", "interested candidates",
      "webinar", "masterclass", "bootcamp", "cohort", "enroll", "early bird",
      // event promotion, phrased so finance posts ("register of members", "starts the quarter") pass
      "register now", "register here", "register today", "register for", "registration is open"
    ];
    const lower = String(text || "").toLowerCase();
    if (FEED_SPAM.some((kw) => lower.includes(kw)) || /starts (?:on|at|in) /.test(lower)) return true;
    const head = String(text || "").slice(0, 300);
    if (/\bpromoted\b/i.test(head) && !/\bpromot(ed to|ion)\b|been promoted/i.test(String(text || ""))) return true;
    return false;
  }

  // Pure: split a raw card innerText into its post body (header chrome, author
  // headline, and trailing tally lines removed) so drafting/validation only ever
  // see what the author wrote. Headline leakage is what produced comments like
  // "Great post on Machine Learning Engineer" on a post about intern interviews.
  static postBodyFromLines(tlines) {
    let bodyStart = 0, followLine = -1;
    for (let i = 0; i < Math.min(tlines.length, 12); i++) {
      if (/\d+\s*[smhdw]\s*•/.test(tlines[i])) { bodyStart = i + 1; break; }
      if (followLine < 0 && /^\s*follow\s*$/i.test(tlines[i])) followLine = i;
    }
    if (bodyStart === 0 && followLine >= 0) bodyStart = followLine + 1;
    // Body (not header) drives identity: same post re-rendered = same key, no double-comments.
    // Trailing count-only lines (reaction/comment/repost tallies) shift over time, so they
    // are stripped - counts rot keys and cause re-comments (and leak digits into drafts).
    // NOTE: no .trim() here - keySrc must stay byte-identical to the pre-refactor key
    // computation, or every previously-commented post becomes commentable again.
    // Zero-width/format chars are stripped FIRST: they break the tally regex ($ anchor)
    // and inflate word counts ("97\n9\n\u200b" never strips otherwise).
    return tlines.slice(bodyStart).join("\n").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/^follow\s*$/gim, "").replace(/(\n\s*[\d][\d\s,.KMB]*)+$/, "");
  }

  // Pure: LinkedIn wraps other people's posts in activity chrome ("X supports this",
  // "Y commented", "Followed by Z"). Commenting there attributes the wrong author -
  // the Rohini-card-is-actually-Shrey's-post class of bug. Skip the whole card.
  static isActivityCard(text) {
    const head = String(text || "").slice(0, 400);
    // "commented" only counts at a line end (LinkedIn's "Hank Wu commented" header) -
    // body sentences like "most commented threads" must not trip it.
    return /(likes|loves|celebrates|supports)\s+this\b|commented on this|\breposted\b|followed by/i.test(head)
      || /^.*\bcommented\s*$/m.test(head)
      || /\bcommented\s+[A-Z][\w.()]*\s+\S+\s*•/.test(head);
  }

  // Pure: two connection-degree markers (• 1st/2nd/3rd+) = two author headers merged
  // in one card (judge commentary + winner's post). Attribution is unknowable: skip.
  static hasMixedAuthors(text) {
    const markers = String(text || "").match(/•\s*(1st|2nd|3rd\+?)\b/gi) || [];
    return markers.length >= 2;
  }

  // Pure: LinkedIn recommendation modules are UI, not human posts (Jobs cards,
  // People-You-May-Know). Commenting on - or liking - them is bot behavior.
  // Matched on card headers/body markers a real post would never contain.
  static isFeedModuleText(text) {
    const head = String(text || "").slice(0, 400);
    return /jobs recommended for you|people you may know|\bopenings near you\b|alumni works here|actively reviewing applicants/i.test(head);
  }

  async scanFeedPosts({ maxPosts = 10, maxScrolls = 10, sort = "recent", url: sourceUrl = "" } = {}) {
    const crypto = require("crypto");
    const MIN_WORDS = 15;
    // Older trackers keyed posts by author link + text; that key differed between search results,
    // profile pages and the home feed, so it is kept only to recognise posts handled before.
    const legacyKeyOf = (href, bodyText) => crypto.createHash("sha1").update(`${href}|${bodyText.slice(0, 300)}`).digest("hex").slice(0, 16);
    const keyOf = (href, bodyText) =>
      bodyText.length >= 60 ? crypto.createHash("sha1").update(`body|${bodyText.slice(0, 300)}`).digest("hex").slice(0, 16) : legacyKeyOf(href, bodyText);
    try {
      await this.ensureDriverConnected(true);
      const homeFeed = !sourceUrl;
      await this.driver.get(sourceUrl || "https://www.linkedin.com/feed/");
      await sleep(5000);
      const url = await this.driver.getCurrentUrl();
      if (/authwall|login|checkpoint|uas\/login/.test(url)) {
        logger.warn("LinkedInService: login/authwall hit while scanning feed.");
        return [];
      }
      // Sort mode per phase: 'top' = default engagement feed, 'recent' = fresh posts.
      const wantSort = String(sort || 'recent');
      if (homeFeed) try {
        const sortState = await this.driver.executeScript(
          "const want = arguments[0];" +
          " " +
          "const ctl = Array.from(document.querySelectorAll('button, [role=\"button\"]'))" +
          " " +
          "  .find(b => (b.innerText || '').indexOf('Sort by') !== -1);" +
          " " +
          "if (!ctl) return 'missing';" +
          " " +
          "if ((ctl.innerText || '').toLowerCase().indexOf(want.toLowerCase()) !== -1) return 'already';" +
          " " +
          "ctl.click();" +
          " " +
          "return 'opened';",
          wantSort === 'top' ? 'Top' : 'Recent'
        );
        if (sortState === 'opened') {
          await sleep(1500);
          await this.driver.executeScript(
            "const want = arguments[0];" +
            " " +
            "const opt = Array.from(document.querySelectorAll('[role=\"option\"], [role=\"menuitemradio\"], [role=\"menuitem\"], button'))" +
            " " +
            "  .find(i => (i.innerText || '').trim() === want);" +
            " " +
            "if (opt) opt.click();",
            wantSort === 'top' ? 'Top' : 'Recent'
          );
          await sleep(6000);
          logger.info('LinkedInService: feed sort set to ' + wantSort + '.');
        }
      } catch (e) { logger.warn('LinkedInService: sort set skipped: ' + e.message); }

      const seen = new Set();
      const out = [];
      // Rejection breakdown so "0 commentable posts" is diagnosable: empty feed
      // vs everything filtered (and by which filter) look identical otherwise.
      const dropped = { fragment: 0, dupe: 0, activity: 0, mixed: 0, module: 0, spam: 0, own: 0, thin: 0, nonlatin: 0 };
      let cardsSeen = 0;
      let stallRounds = 0;
      for (let round = 0; round < maxScrolls && out.length < maxPosts; round++) {
        // Expand truncated posts so we read (and judge) the full text.
        try {
          await this.driver.executeScript(`
            for (const b of document.querySelectorAll('div[data-testid="mainFeed"] button, main li button')) {
              if (/^(?:\\u2026|\\.\\.\\.)?\\s*(?:see\\s+)?more$/i.test((b.innerText || '').trim())) { try { b.click(); } catch (e) {} }
            }
          `);
          await sleep(800);
        } catch (e) {}
        let batch = [];
        try {
          batch = await this.driver.executeScript(`
            ${CARDS_JS}
            return cards
              .filter(c => (c.innerText || '').length > 200)
              .map(c => {
                const links = Array.from(c.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')).filter(x => (x.innerText || '').trim()); const a = links[0]; // first text-bearing profile/company link (avatar links are empty);
                return {
                  href: a ? a.href.split('?')[0] : '',
                  author: a ? (a.innerText || '').trim().split('\\n')[0] : '',
                  text: (c.innerText || '').trim()
                };
              });
          `);
        } catch (e) { logger.warn(`LinkedInService: feed batch extraction failed: ${e.message}`); }
        let fresh = 0;
        for (const item of batch || []) {
          const text = String(item.text || "").trim();
          if (!text) { dropped.fragment++; continue; }
          const tlines = text.split(/\r?\n/);
          const keySrc = LinkedInService.postBodyFromLines(tlines);
          if (keySrc.split(/\s+/).filter(Boolean).length < 10) { dropped.fragment++; continue; } // render fragment, not a post yet
          const key = keyOf(item.href, keySrc);
          if (seen.has(key)) { dropped.dupe++; continue; }
          seen.add(key);
          cardsSeen++;
          fresh++;
          if (out.length >= maxPosts) break;
          if (LinkedInService.isActivityCard(text)) { dropped.activity++; continue; } // someone else's post in activity chrome: wrong author
          if (LinkedInService.hasMixedAuthors(text)) { dropped.mixed++; continue; } // two authors merged in one card: attribution unknowable
          if (LinkedInService.isFeedModuleText(text)) { dropped.module++; continue; } // recommendation module (Jobs/People cards): not a post
          if (LinkedInService.isFeedSpamText(text)) { dropped.spam++; continue; }
          if (/drishtant|drix10/i.test(`${item.author} ${item.href}`)) { dropped.own++; continue; } // own post: never engage
          if (keySrc.split(/\s+/).length < MIN_WORDS) { dropped.thin++; continue; }
          const allLetters = keySrc.match(/[\p{L}]/gu) || [];
          const asciiLetters = keySrc.match(/[A-Za-z]/g) || [];
          if (allLetters.length > 0 && asciiLetters.length / allLetters.length < 0.5) { dropped.nonlatin++; continue; }
          // Life updates and milestones pass through: they ride the CONGRATS path.
          // Drafting/validation see the clean BODY only - never the headline (which is
          // what produced "Great post on Machine Learning Engineer" on an interview post).
          // head = author/headline/timestamp chrome above the body, used only for audience scoring.
          const ageM = text.match(/(\d+)\s*([smhdw])\s*•/);
          const ageH = ageM ? Number(ageM[1]) * { s: 1 / 3600, m: 1 / 60, h: 1, d: 24, w: 168 }[ageM[2]] : 999;
          out.push({ key, legacyKey: legacyKeyOf(item.href, keySrc), author: item.author || "unknown", href: item.href || "", text: keySrc.slice(0, 1500), head: tlines.slice(0, 8).join(" "), ageH });
        }
        if (fresh === 0) {
          stallRounds++;
          if (stallRounds >= 4) break;
        } else stallRounds = 0;
        try { await this.driver.executeScript("window.scrollBy(0, window.innerHeight * 2);"); } catch (e) {}
        await sleep(1500);
      }
      logger.info(`LinkedInService: feed scan collected ${out.length} likeable posts (saw ${cardsSeen} unique cards; dropped: fragment ${dropped.fragment}, dupe ${dropped.dupe}, activity ${dropped.activity}, mixed-authors ${dropped.mixed}, module ${dropped.module}, spam ${dropped.spam}, own ${dropped.own}, thin ${dropped.thin}, non-latin ${dropped.nonlatin}).`);
      return out;
    } catch (err) {
      logger.error("LinkedInService: scanFeedPosts failed:", err.message);
      return [];
    }
  }

  // Comment INLINE on a feed card (no navigation: click its Comment toggle, type, submit).
  // Re-finds the card by author href + text snippet (virtualized feed unmounts nodes).
  // Like a feed card by text snippet. State-checked: only clicks an un-liked Like
  // button, so it never unlikes or double-likes. True = like newly placed.
  // Three-phase like with read-back proof: locate+scroll, click, then re-read
  // the button state. Only a flipped state counts as liked - a dispatched click
  // LinkedIn drops must never log as a like (that false positive is exactly
  // what the old fire-and-forget version produced).
  async likeFeedCard(textSnippet) {
    const snip = String(textSnippet).substring(0, 80);
    const FIND_CARD = `
      const norm = s => (s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
      ${CARDS_JS}
      const nq = norm(q).slice(0, 80);
      if (!nq) return null;
      return cards.find(c => norm(c.innerText).includes(nq)) || null;
    `;
    try {
      const located = await this.driver.executeScript(`
        const q = arguments[0];
        const card = (function() { ${FIND_CARD} })();
        if (!card) return 'no-card';
        try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
        return 'ready';
      `, snip).catch(() => 'fail');
      if (located !== 'ready') {
        logger.warn(`LinkedInService: like skipped (locate: '${located}', snippet: '${snip.slice(0, 40)}').`);
        return false;
      }
      await sleep(800);
      const clicked = await this.driver.executeScript(`
        const q = arguments[0];
        const card = (function() { ${FIND_CARD} })();
        if (!card) return 'no-card';
        const likeBtn = Array.from(card.querySelectorAll('button')).find(b => {
          const al = (b.getAttribute('aria-label') || '').toLowerCase();
          return al === 'like' || al === 'react like' ||
            (al.startsWith('reaction button state') && al.includes('no reaction'));
        });
        if (!likeBtn) return 'already';
        try { likeBtn.click(); return 'clicked'; } catch (e) { return 'fail'; }
      `, snip).catch(() => 'fail');
      if (clicked !== 'clicked') {
        logger.warn(`LinkedInService: like skipped (click phase: '${clicked}').`);
        return false; // 'already'/'no-card'/'fail': nothing to verify
      }
      await sleep(2500);
      const state = await this.driver.executeScript(`
        const q = arguments[0];
        const card = (function() { ${FIND_CARD} })();
        if (!card) return 'gone';
        const btns = Array.from(card.querySelectorAll('button'));
        const info = btns.map(b => ((b.getAttribute('aria-label') || '') + '|' + b.getAttribute('aria-pressed')).toLowerCase());
        if (info.some(s => s.indexOf('unlike') !== -1 || s.split('|')[1] === 'true')) return 'liked';
        if (info.some(s => s.indexOf('reaction button state') === 0 && s.indexOf('no reaction') === -1)) return 'liked';
        if (info.some(s => s.split('|')[0] === 'like')) return 'not-liked';
        return 'unknown:' + info.filter(s => s.indexOf('like') !== -1 || s.indexOf('reaction') !== -1).join(';').slice(0, 120);
      `, snip).catch(() => 'fail');
      if (state === 'liked') {
        logger.info("LinkedInService: feed post liked (verified).");
        return true;
      }
      logger.warn(`LinkedInService: like click dropped (post-click state: '${state}').`);
      return false;
    } catch (e) {
      return false;
    }
  }


  async commentOnFeedCard(cardKey, authorHref, textSnippet, text, fullName = "") {
    try {
      await this.ensureDriverConnected(true);
      const toggleResult = await this.driver.executeScript(`
        const norm = s => (s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
        ${CARDS_JS}
        const nq = norm(arguments[0]);
        const card = cards.find(c =>
          norm(c.innerText).includes(nq) &&
          (arguments[1] ? !!c.querySelector('a[href*="' + arguments[1] + '"]') : true)
        );
        if (!card) return null;
        try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
        // Like first (human flow: like, then comment). Non-fatal if it fails.
        let liked = false;
        try {
          const likeBtn = Array.from(card.querySelectorAll('button')).find(b => {
            const al = (b.getAttribute('aria-label') || '').toLowerCase();
            return al === 'like' || al === 'react like' ||
              (al.startsWith('reaction button state') && al.includes('no reaction'));
          });
          if (likeBtn) { likeBtn.click(); liked = true; }
        } catch (e) {}
        const toggle = Array.from(card.querySelectorAll('button'))
          .find(b => (b.getAttribute('aria-label') || '').toLowerCase() === 'comment');
        if (!toggle) return null;
        toggle.click();
        return { toggled: true, liked: liked };
      `, String(textSnippet).substring(0, 80), String(authorHref || "").split("/in/")[1] || "").catch(() => null);
      if (!toggleResult || !toggleResult.toggled) {
        logger.warn("LinkedInService: feed card or Comment toggle not found.");
        return false;
      }
      if (toggleResult.liked) logger.info("LinkedInService: post liked before commenting.");
      await sleep(2500);
      // Re-query the open editor inside the same card.
      const editor = await this.driver.executeScript(`
        const norm = s => (s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
        ${CARDS_JS}
        const nq = norm(arguments[0]);
        const card = cards.find(c => norm(c.innerText).includes(nq));
        if (!card) return null;
        return card.querySelector('[aria-label="Text editor for creating comment"], .tiptap, .ProseMirror');
      `, String(textSnippet).substring(0, 80)).catch(() => null);
      if (!editor) {
        logger.warn("LinkedInService: comment editor did not open on feed card.");
        return false;
      }
      await editor.click();
      await sleep(400);
      await editor.sendKeys(Key.chord(MOD_KEY, "a"), Key.BACK_SPACE);
      await sleep(300);
      const mentionState = await this._typeWithMention(editor, text, fullName);
      logger.info(`LinkedInService: mention flow: ${mentionState}.`);
      // Read back what actually landed in the editor: distinguishes "typed into the
      // void" (focus lost) from "submit never fired" later. Empty here = typing failed.
      let typedLen = -1;
      try { typedLen = String(await editor.getText()).length; } catch (e) {}
      logger.info(`LinkedInService: comment editor holds ${typedLen} chars after typing.`);
      if (typedLen === 0) {
        logger.warn("LinkedInService: editor empty after typing - focus lost, aborting post.");
        return false;
      }
      await sleep(2000);
      // Submit finder: the submit button is the ONLY button whose visible text is exactly
      // "Comment" (toggles show a count like "7" and carry aria-label="Comment" instead).
      // Do NOT match aria-label here - that would click the toggle and close the editor.
      // The button renders only after typing fires input events, so poll for it.
      const clickSubmit = `
        const norm = s => (s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
        ${CARDS_JS}
        const nq = norm(arguments[0]);
        const card = cards.find(c => norm(c.innerText).includes(nq));
        if (!card) return 'no-card';
        const btn = Array.from(card.querySelectorAll('button'))
          .find(b => (b.innerText || '').trim().toLowerCase() === 'comment' && !b.disabled);
        if (!btn) return 'no-button';
        try { btn.click(); return 'clicked'; } catch (e) { return 'click-threw'; }
      `;
      let clicked = false;
      let submitHow = "none";
      let submitEl = null;
      for (let attempt = 0; attempt < 4 && !clicked; attempt++) {
        if (attempt > 0) await sleep(2000); // button renders async after input events
        try { submitEl = await this.driver.executeScript(clickSubmit, String(textSnippet).substring(0, 80)).catch(() => null); } catch (e) { submitEl = null; }
        clicked = submitEl === "clicked";
      }
      logger.info(`LinkedInService: submit button state: ${submitEl}.`);
      if (clicked) submitHow = "button";
      if (!clicked) {
        await editor.click();
        await sleep(300);
        const actions = this.driver.actions({ async: true });
        await actions.keyDown(MOD_KEY).sendKeys(Key.ENTER).keyUp(MOD_KEY).perform();
        submitHow = "keyboard-fallback";
        logger.info("LinkedInService: submit fell back to keyboard.");
      }
      await sleep(5000);
      const checkPosted = async () => {
        let residual = -1;
        try { residual = String(await editor.getText()).length; } catch (e) {}
        const onPage = residual === 0 && await this.driver.executeScript(`
          const ed = arguments[1];
          const nodes = Array.from(document.querySelectorAll('article, [class*="comment"]'))
            .filter(n => !(ed && (n.contains(ed) || ed.contains(n))));
          return nodes.some(n => (n.innerText || '').includes(arguments[0]));
        `, String(text).substring(0, 40), editor).catch(() => false);
        return { onPage: !!onPage, residual };
      };
      let { onPage: verified, residual } = await checkPosted();
      logger.info(`LinkedInService: after submit (${submitHow}): on-page=${verified}, editor-residual=${residual}.`);
      if (!verified && residual > 0) {
        // Text still sitting in the editor = submit never fired. One retry, then Enter.
        logger.warn("LinkedInService: submit missed (text still in editor) - retrying once.");
        try { await this.driver.executeScript(clickSubmit, String(textSnippet).substring(0, 80)).catch(() => null); } catch (e) {}
        await sleep(2000);
        try { residual = String(await editor.getText()).length; } catch (e) {}
        if (residual > 0) {
          try {
            await editor.click();
            const actions = this.driver.actions({ async: true });
            await actions.sendKeys(Key.ENTER).perform(); // Enter on the focused editor
          } catch (e) {}
          await sleep(3000);
        }
        ({ onPage: verified, residual } = await checkPosted());
        logger.info(`LinkedInService: after retry: on-page=${verified}, editor-residual=${residual}.`);
      }
      if (!verified && residual === 0) {
        logger.warn("LinkedInService: text left the editor but is not on the page - likely posted but hidden by comment sorting, or silently dropped.");
        logger.info(`LinkedInService: feed comment posted+verified: uncertain.`);
        return "uncertain";
      }
      logger.info(`LinkedInService: feed comment posted+verified: ${!!verified}.`);
      return !!verified;
    } catch (err) {
      logger.error("LinkedInService: commentOnFeedCard failed:", err.message);
      return false;
    }
  }

  // Type comment text, converting the author's name into a REAL @-mention.
  // Three hard rules (from live-DOM inspection): the typeahead popup must be ANCHORED
  // near this editor (a far-away listbox belongs to another card - never touch it),
  // the option's FIRST LINE must equal the full name (LinkedIn renders "Name\nheadline"),
  // and the pick must be VERIFIED as a chip in the editor. Anything else falls back
  // to plain text. This is how "never tag strangers" is actually enforced.

  async _typeWithMention(editor, text, fullName) {
    const plainFallback = async () => {
      try {
        try { await editor.sendKeys(Key.ESCAPE); } catch (e) {}
        await sleep(300);
        await editor.sendKeys(Key.chord(MOD_KEY, "a"), Key.BACK_SPACE);
        await sleep(300);
        await editor.sendKeys(text);
      } catch (e2) {}
      return "plain-fallback";
    };
    try {
      const name = String(fullName || "").trim();
      const idx = name && name.toLowerCase() !== "there" && name.toLowerCase() !== "unknown"
        ? String(text).toLowerCase().indexOf(name.toLowerCase())
        : -1;
      if (idx < 0) { await editor.sendKeys(text); return "plain"; }
      const before = String(text).slice(0, idx);
      const after = String(text).slice(idx + name.length);
      if (before) await editor.sendKeys(before);
      await editor.sendKeys("@" + name.split(/\s+/)[0]);
      const edRect = await this.driver.executeScript(
        "const e = arguments[0]; return e ? e.getBoundingClientRect().toJSON() : null;", editor
      ).catch(() => null);
      // Poll for the popup (server-side filter is async); match exact full name only.
      let picked = null;
      for (let i = 0; i < 6 && !picked; i++) {
        await sleep(1000);
        picked = await this.driver.executeScript(`
          const clean = (s) => String(s || "").toLowerCase().replace(/[.]+/g, "").replace(/\\s+/g, " ").trim();
          const want = clean(arguments[0]);
          const edR = arguments[1];
          const boxes = Array.from(document.querySelectorAll('[role="listbox"]')).filter(m => m.offsetParent);
          for (const m of boxes) {
            if (edR) {
              const r = m.getBoundingClientRect();
              if (Math.abs(r.top - edR.top) > 500 && Math.abs(r.bottom - edR.bottom) > 500) continue;
            }
            const opts = Array.from(m.querySelectorAll('[role="option"]')).filter(o => o.offsetParent);
            for (const o of opts) {
              const first = clean((o.innerText || "").split("\\n")[0]);
              if (first === want || (want.length >= 3 && first.indexOf(want + " ") === 0)) {
                try { o.click(); return 'picked:' + first.slice(0, 60); } catch (e) { return 'click-threw'; }
              }
            }
          }
          return null;
        `, name, edRect).catch(() => null);
        if (picked && picked.indexOf("picked:") !== 0) { picked = null; break; }
      }
      if (!picked) return await plainFallback();
      logger.info(`LinkedInService: mention picked (${picked}).`);
      await sleep(800);
      // Verify the pick landed: a chip element, or the "@" consumed with the name
      // present. A leftover "@First" means the popup just closed - fall back (the
      // fallback wipes and retypes clean text, so no stray @ ever posts).
      const st = await this.driver.executeScript(`
        const ed = arguments[1];
        if (!ed) return 'no-editor';
        const t = ed.innerText || '';
        const chip = ed.querySelector('a, [data-entity], [data-type="mention"], .mention');
        return JSON.stringify({ chip: !!chip, hasAt: t.indexOf('@') !== -1, hasName: t.toLowerCase().indexOf(arguments[0].toLowerCase()) !== -1 });
      `, name, editor).catch(() => null);
      let landed = false;
      try { const s = JSON.parse(st); landed = s.chip || (!s.hasAt && s.hasName); } catch (e) {}
      if (!landed) {
        logger.warn("LinkedInService: mention pick did not land - plain fallback.");
        return await plainFallback();
      }
      if (after) await editor.sendKeys(after);
      return "mentioned";
    } catch (e) {
      logger.warn(`LinkedInService: mention flow failed (${e.message}), plain-text fallback.`);
      return await plainFallback();
    }
  }
  // Follow the author of a feed card (state-checked: only clicks a plain Follow
  // button, never unfollows). Following shapes what LinkedIn ranks into the feed.
  async followFeedCard(textSnippet) {
    const snip = String(textSnippet).substring(0, 80);
    const FIND = `
      const norm = s => (s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
      ${CARDS_JS}
      const nq = norm(arguments[0]).slice(0, 80);
      if (!nq) return null;
      return cards.find(c => norm(c.innerText).includes(nq)) || null;
    `;
    try {
      const clicked = await this.driver.executeScript(`
        const card = (function() { ${FIND} }).apply(null, arguments);
        if (!card) return 'no-card';
        try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
        const btn = Array.from(card.querySelectorAll('button')).find(b => {
          const t = (b.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
          const al = (b.getAttribute('aria-label') || '').toLowerCase();
          return t === 'follow' || t === '+ follow' || al.indexOf('follow ') === 0;
        });
        if (!btn) return 'no-button';
        try { btn.click(); return 'clicked'; } catch (e) { return 'fail'; }
      `, snip).catch(() => 'fail');
      if (clicked !== 'clicked') return false;
      await sleep(2000);
      const state = await this.driver.executeScript(`
        const card = (function() { ${FIND} }).apply(null, arguments);
        if (!card) return 'gone';
        const txt = Array.from(card.querySelectorAll('button')).map(b => (b.innerText || '').trim().toLowerCase());
        return txt.some(t => t === 'following') ? 'following' : 'unknown';
      `, snip).catch(() => 'fail');
      return state === "following";
    } catch (e) {
      return false;
    }
  }

  // People search (US only via geoUrn, 2nd-degree only, which accept far more often).
  // Returns visible Connect candidates: { label, name, href, text }.
  async scanPeopleSearch(keywords, page = 1) {
    try {
      await this.ensureDriverConnected(true);
      const url = "https://www.linkedin.com/search/results/people/?keywords=" + encodeURIComponent(keywords) +
        "&geoUrn=%5B%22103644278%22%5D&network=%5B%22S%22%5D&origin=FACETED_SEARCH&page=" + page;
      await this.driver.get(url);
      await sleep(5000);
      const cur = await this.driver.getCurrentUrl();
      if (/authwall|login|checkpoint|uas\/login/.test(cur)) return { blocked: true, people: [] };
      for (let i = 0; i < 3; i++) {
        try { await this.driver.executeScript("window.scrollBy(0, window.innerHeight);"); } catch (e) {}
        await sleep(1200);
      }
      const people = await this.driver.executeScript(`
        const out = [];
        const btns = Array.from(document.querySelectorAll('a, button')).filter(b => /^Invite .+ to connect$/i.test((b.getAttribute('aria-label') || '').trim()));
        for (const b of btns) {
          let c = b;
          for (let i = 0; i < 8 && c.parentElement; i++) {
            c = c.parentElement;
            if (c.querySelector('a[href*="/in/"]') && (c.innerText || '').length > 60) break;
          }
          const a = c.querySelector('a[href*="/in/"]');
          const label = (b.getAttribute('aria-label') || '').trim();
          out.push({
            label: label,
            name: label.replace(/^Invite\\s+/i, '').replace(/\\s+to connect$/i, ''),
            href: a ? a.href.split('?')[0] : '',
            text: (c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 400)
          });
        }
        return out;
      `).catch(() => []);
      return { blocked: false, people: people || [] };
    } catch (e) {
      logger.warn(`LinkedInService: people search failed: ${e.message}`);
      return { blocked: false, people: [] };
    }
  }

  // Send one connection request WITHOUT a note from the current search page.
  // Returns 'sent' | 'limit' (weekly cap hit: stop everything) | 'email' | 'fail'.
  async sendConnectRequest(label) {
    try {
      const clicked = await this.driver.executeScript(`
        const label = arguments[0];
        const b = Array.from(document.querySelectorAll('a, button')).find(x => (x.getAttribute('aria-label') || '').trim() === label);
        if (!b) return 'no-button';
        try { b.scrollIntoView({ block: 'center' }); b.click(); return 'clicked'; } catch (e) { return 'fail'; }
      `, label).catch(() => 'fail');
      if (clicked !== 'clicked') return "fail";
      await sleep(1800);
      // The invite modal renders inside #interop-outlet's shadow root, invisible to document queries.
      const modal = await this.driver.executeScript(`
        const host = document.querySelector('#interop-outlet');
        const dlg = (host && host.shadowRoot) || document.querySelector('[role="dialog"], .artdeco-modal');
        if (!dlg) return 'no-modal';
        const txt = (dlg.textContent || '').toLowerCase();
        if (txt.indexOf('invitation limit') !== -1 || txt.indexOf('weekly invitation') !== -1) return 'limit';
        if (dlg.querySelector('input[type="email"], input[name="email"]')) return 'email';
        const btns = Array.from(dlg.querySelectorAll('button'));
        const send = btns.find(x => /send without a note/i.test((x.getAttribute('aria-label') || '') + ' ' + (x.innerText || '')))
          || btns.find(x => (x.innerText || '').trim().toLowerCase() === 'send');
        if (!send) return 'no-send';
        try { send.click(); return 'sent-click'; } catch (e) { return 'fail'; }
      `).catch(() => 'fail');
      if (modal === "limit" || modal === "email" || modal === "no-send" || modal === "fail") {
        try { await this.driver.actions().sendKeys(Key.ESCAPE).perform(); } catch (e) {}
        return modal === "limit" ? "limit" : modal === "email" ? "email" : "fail";
      }
      await sleep(2200);
      // Proof: the Invite button is gone (swapped to Pending) and no dialog is left open.
      const state = await this.driver.executeScript(`
        const label = arguments[0];
        const still = Array.from(document.querySelectorAll('a, button')).some(x => (x.getAttribute('aria-label') || '').trim() === label);
        const host = document.querySelector('#interop-outlet');
        const dlg = host && host.shadowRoot;
        const dtxt = dlg ? (dlg.textContent || '').toLowerCase() : '';
        if (dtxt.indexOf('invitation limit') !== -1 || dtxt.indexOf('weekly invitation') !== -1) return 'limit';
        return still ? 'still-there' : 'gone';
      `, label).catch(() => 'fail');
      if (state === "limit") { try { await this.driver.actions().sendKeys(Key.ESCAPE).perform(); } catch (e) {} return "limit"; }
      if (state === "gone") return "sent";
      try { await this.driver.actions().sendKeys(Key.ESCAPE).perform(); } catch (e) {}
      return "fail";
    } catch (e) {
      return "fail";
    }
  }

  cleanupDebugScreenshots() {
    try {
      const tempDir = path.join(process.cwd(), "temp");
      if (!fs.existsSync(tempDir)) return;
      const files = fs.readdirSync(tempDir).filter(f =>
        f.startsWith("linkedin-") &&
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
    // Never quit(): the attached Chrome is the user's persistent logged-in session.
    // Stop only this session's chromedriver process so reconnects don't leak them.
    if (this.driver) {
      logger.info("LinkedInService: Releasing WebDriver control of debugging browser session");
      await releaseDriver(this.driver);
    }
    this.driver = null;
    this.isInitialized = false;
    this._isLoggedIn = false;
  }
}

module.exports = LinkedInService;
