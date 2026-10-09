const { By, Key } = require("selenium-webdriver");
const { logger, sleep } = require("../utils/helpers");
const { attachDriver, releaseDriver, MOD_KEY } = require("../utils/chromeLauncher");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Fixed waits read as a bot; every pause in this file is jittered +-25%.
const nap = (ms) => sleep(Math.round(ms * (0.75 + Math.random() * 0.5)));

// Set when LinkedIn must not be touched again in this process run (login lost, a
// checkpoint, a pass that hung). Every pass checks it first and returns at once, so an
// unattended run never sits on a login wall or keeps poking a restricted account.
let linkedinDisabledUntil = 0;
let linkedinDisabledReason = "";

// Typed errors the passes act on: LINKEDIN_LOGIN_REQUIRED (signed out), LINKEDIN_RESTRICTED
// (checkpoint or limit wall: feedEngage persists a 24-48 h cooldown).
function linkedinError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}
// LINKEDIN_UNAVAILABLE = already switched off earlier in this run (hung pass, earlier wall).
const isLinkedInStop = (err) => !!err && ["LINKEDIN_LOGIN_REQUIRED", "LINKEDIN_RESTRICTED", "LINKEDIN_UNAVAILABLE"].includes(err.code);

// Pages LinkedIn shows a flagged or rate-limited account. Matched against page chrome
// (title, dialogs, alerts, headings), never post bodies, so a post about a "monthly limit" is safe.
const RESTRICTED_TEXT_RE = /unusual activity|temporarily restricted|security verification|let['’]?s do a quick security check|commercial use limit|monthly limit/i;

// Tally/reaction/video chrome at the end of a card. Line-anchored so a body sentence
// ("I read 300 comments on this") is never mistaken for the tally line.
const TALLY_LINE_RE = /^\s*(?:[\d][\d,.]*[KkMm]?\s+(?:comments?|reposts?)\b.*|.{0,120}\band\s+[\d,]+\s+others?\s*|remaining time\b.*|[\d][\d,.]*[KkMm]?\s*(?:reactions?|likes?)\s*)$/im;
const MORE_TAIL_RE = /(?:…|\.\.\.)\s*(?:see\s+)?more\s*$/im;
const LOGGED_IN_CSS = "a[href*='/feed'], a[href*='/mynetwork'], a[href*='/messaging'], a[href*='/notifications'], nav.global-nav, .global-nav";

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
    this._tabHandle = null; // the one tab this service opened and drives
    // Own profile slug (to spot our own earlier comment on a card): LINKEDIN_PROFILE_SLUG,
    // else read once from the nav "Me" link.
    this._ownSlug = String(process.env.LINKEDIN_PROFILE_SLUG || "").trim().replace(/^.*\/in\//, "").replace(/[/?#].*$/, "");
  }

  // Process-wide stop switch (see linkedinDisabledUntil).
  static disable(ms, reason) {
    linkedinDisabledUntil = Math.max(linkedinDisabledUntil, Date.now() + ms);
    linkedinDisabledReason = String(reason || "unavailable");
    logger.warn(`LinkedInService: LinkedIn off for this run (${linkedinDisabledReason}).`);
  }
  static disabledReason() {
    return Date.now() < linkedinDisabledUntil ? linkedinDisabledReason || "unavailable" : "";
  }
  static _resetDisabled() { linkedinDisabledUntil = 0; linkedinDisabledReason = ""; } // tests only
  static isStopError(err) { return isLinkedInStop(err); }

  // Pure: what a page means for the account. "login" = signed out, "restricted" = checkpoint,
  // authwall or a limit/verification wall (every pass stops for a day or two), "" = fine.
  static restrictionReason(url, chromeText = "") {
    const u = String(url || "");
    if (/\/checkpoint\/|authwall/i.test(u)) return "restricted";
    if (/\/uas\/login|\/login\b|\/signup\b/i.test(u)) return "login";
    if (RESTRICTED_TEXT_RE.test(String(chromeText || ""))) return "restricted";
    return "";
  }

  // Throws the typed stop error when the current page is a wall. includeBody also reads the
  // start of the page text, for pages with no posts or results on them.
  async _assertUsable(includeBody = false) {
    const info = await this.driver.executeScript(`
      const parts = [document.title];
      for (const el of document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="alert"], .artdeco-modal, h1')) parts.push((el.innerText || '').slice(0, 300));
      if (arguments[0] && document.body) parts.push(document.body.innerText.slice(0, 2500));
      return { url: location.href, text: parts.join(' | ') };
    `, includeBody).catch(() => null);
    if (!info) return;
    const kind = LinkedInService.restrictionReason(info.url, info.text);
    if (kind === "login") {
      LinkedInService.disable(6 * 3600000, "login required");
      throw linkedinError("LINKEDIN_LOGIN_REQUIRED", `LinkedIn is signed out (${String(info.url).slice(0, 80)})`);
    }
    if (kind === "restricted") {
      const hit = (String(info.text).match(RESTRICTED_TEXT_RE) || ["checkpoint"])[0];
      LinkedInService.disable(6 * 3600000, `restricted: ${hit}`);
      throw linkedinError("LINKEDIN_RESTRICTED", `LinkedIn restriction page (${hit}, ${String(info.url).slice(0, 80)})`);
    }
  }

  // One dedicated tab, opened once and remembered. The user's own tabs are never
  // switched to, navigated or brought to the front.
  async _useOwnTab() {
    if (this._tabHandle) {
      const handles = await this.driver.getAllWindowHandles().catch(() => []);
      if (handles.includes(this._tabHandle)) {
        await this.driver.switchTo().window(this._tabHandle);
        return;
      }
    }
    await this.driver.switchTo().newWindow("tab");
    this._tabHandle = await this.driver.getWindowHandle();
    logger.info("LinkedInService: opened a dedicated LinkedIn tab.");
  }

  async ensureDriverConnected(requireLogin = false) {
    const off = LinkedInService.disabledReason();
    if (off) throw linkedinError(/login/i.test(off) ? "LINKEDIN_LOGIN_REQUIRED" : "LINKEDIN_UNAVAILABLE", `LinkedIn is off for this run (${off})`);
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
    await this._useOwnTab();

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
        this._tabHandle = null;
      }
      await this._useOwnTab();
      if (requireLogin && !this._isLoggedIn) {
        await this.checkLogin();
        this._isLoggedIn = true;
      }
      this.cleanupDebugScreenshots();
    } catch (error) {
      if (isLinkedInStop(error)) logger.warn(`LinkedInService: ${error.message}`);
      else logger.error("LinkedInService: Failed to initialize:", error);
      this.isInitialized = false;
      this._isLoggedIn = false;
      await this.cleanup();
      throw error;
    }
  }

  // One quick check (~10 s). An unattended run never waits for a human: a signed-out
  // browser switches LinkedIn off for the rest of the run (LINKEDIN_LOGIN_REQUIRED) instead
  // of stalling 5 minutes on every scan. Only feed-preview.js --wait-login
  // (LINKEDIN_INTERACTIVE_LOGIN=true) waits for a manual login.
  async checkLogin() {
    await this.driver.get("https://www.linkedin.com/feed/");
    let isLoggedIn = false;
    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      const url = await this.driver.getCurrentUrl().catch(() => "");
      if (LinkedInService.restrictionReason(url)) break;
      const loggedInElements = await this.driver.findElements(By.css(LOGGED_IN_CSS)).catch(() => []);
      if (loggedInElements.length > 0) {
        isLoggedIn = true;
        break;
      }
      await sleep(1000);
    }
    if (isLoggedIn) {
      await this._assertUsable(false); // logged in, but a checkpoint/limit banner still stops everything
      logger.info("LinkedInService: Already logged into LinkedIn");
      return;
    }
    const url = await this.driver.getCurrentUrl().catch(() => "");
    // A signed-out redirect to the authwall is a lost login, not a restriction.
    if (/\/checkpoint\//i.test(url)) await this._assertUsable(true);
    if (process.env.LINKEDIN_INTERACTIVE_LOGIN === "true") {
      await this.login();
      return;
    }
    LinkedInService.disable(6 * 3600000, "login required");
    throw linkedinError("LINKEDIN_LOGIN_REQUIRED", "LinkedIn is not logged in in the debug Chrome; skipping LinkedIn for this run.");
  }

  // Interactive only (feed-preview.js --wait-login): a person is at the keyboard.
  async login() {
    const maxAttempts = 60; // 5 minutes total wait time (60 * 5 seconds)
    let attempts = 0;

    try {
      logger.warn("⚠️ LinkedIn Login Required: Please log in manually in the Chrome browser window.");

      // Poll until the login is completed by the user or we timeout
      while (attempts < maxAttempts) {
        try {
          const loggedInElements = await this.driver.findElements(
            By.css(LOGGED_IN_CSS)
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
    // Ad label = a header line (or a "•"-separated header segment) that is exactly "Promoted".
    // Body sentences ("I got promoted", "Promoted by the board") never match.
    const headLines = String(text || "").split(/\r?\n/).slice(0, 8);
    if (headLines.some((l) => l.split("•").some((seg) => /^\s*promoted\s*$/i.test(seg)))) return true;
    return false;
  }

  // Pure: split a raw card innerText into its post body (header chrome, author
  // headline, and trailing tally lines removed) so drafting/validation only ever
  // see what the author wrote. Headline leakage is what produced comments like
  // "Great post on Machine Learning Engineer" on a post about intern interviews.
  static postBodyFromLines(tlines) {
    let bodyStart = 0, followLine = -1;
    for (let i = 0; i < Math.min(tlines.length, 12); i++) {
      if (/\d+\s*(?:mo|yr|[smhdw])\s*•/.test(tlines[i])) { bodyStart = i + 1; break; }
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

  // Pure: the author's commentary only - the body cut at the first tally/reaction/video
  // line ("2 comments", "Jane Smith and 45 others", "Remaining time 0:45") and at a
  // trailing "\u2026more". Those lines change between visits, so they must never reach a key.
  static commentaryText(body) {
    let t = String(body || "").replace(/[\u200b-\u200d\ufeff]/g, "");
    const tally = t.match(TALLY_LINE_RE);
    if (tally) t = t.slice(0, tally.index);
    const more = t.match(MORE_TAIL_RE);
    if (more) t = t.slice(0, more.index);
    return t.trim();
  }

  // Pure: a post's tracker keys. key = the activity URN when the card links its permalink
  // (stable forever), else a hash of the commentary's first 200 chars. altKeys are every
  // older scheme (commentary hash, body hash, author+body hash), so posts tracked before
  // still match and are never commented twice.
  static postKeys({ href = "", urn = "", body = "" } = {}) {
    const h = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
    const legacyKey = h(`${href}|${String(body).slice(0, 300)}`);
    const bodyKey = String(body).length >= 60 ? h(`body|${String(body).slice(0, 300)}`) : legacyKey;
    const norm = LinkedInService.commentaryText(body).replace(/\s+/g, " ").trim().slice(0, 200);
    const textKey = norm.length >= 40 ? `c1:${h(norm)}` : "";
    const urnKey = /^urn:li:activity:\d+$/.test(String(urn)) ? String(urn) : "";
    const all = [urnKey, textKey, bodyKey, legacyKey].filter(Boolean);
    const unique = [...new Set(all)];
    return { key: unique[0], altKeys: unique.slice(1), legacyKey };
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
    const MIN_WORDS = 15;
    try {
      await this.ensureDriverConnected(true);
      const homeFeed = !sourceUrl;
      await this.driver.get(sourceUrl || "https://www.linkedin.com/feed/");
      await nap(5000);
      // Login/checkpoint/limit wall: a typed error stops every pass (see feedEngage).
      await this._assertUsable(false);
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
          await nap(1500);
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
          await nap(6000);
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
          await nap(800);
        } catch (e) {}
        let batch = [];
        try {
          batch = await this.driver.executeScript(`
            ${CARDS_JS}
            return cards
              .filter(c => (c.innerText || '').length > 200)
              .map(c => {
                const links = Array.from(c.querySelectorAll('a[href*="/in/"], a[href*="/company/"]')).filter(x => (x.innerText || '').trim()); const a = links[0]; // first text-bearing profile/company link (avatar links are empty);
                // Activity URN from the permalink or a data-urn: the post's stable identity.
                const pl = c.querySelector('a[href*="urn:li:activity:"]');
                const du = c.matches('[data-urn*="urn:li:activity:"]') ? c : c.querySelector('[data-urn*="urn:li:activity:"]');
                const um = ((pl && decodeURIComponent(pl.href)) || (du && du.getAttribute('data-urn')) || '').match(/urn:li:activity:\\d+/);
                return {
                  urn: um ? um[0] : '',
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
          const { key, altKeys, legacyKey } = LinkedInService.postKeys({ href: item.href, urn: item.urn, body: keySrc });
          if (seen.has(key)) { dropped.dupe++; continue; }
          seen.add(key);
          cardsSeen++;
          fresh++;
          if (out.length >= maxPosts) break;
          if (LinkedInService.isActivityCard(text)) { dropped.activity++; continue; } // someone else's post in activity chrome: wrong author
          if (LinkedInService.hasMixedAuthors(text)) { dropped.mixed++; continue; } // two authors merged in one card: attribution unknowable
          if (LinkedInService.isFeedModuleText(text)) { dropped.module++; continue; } // recommendation module (Jobs/People cards): not a post
          if (LinkedInService.isFeedSpamText(text)) { dropped.spam++; continue; }
          if (/drishtant|drix10/i.test(`${item.author} ${item.href}`) || (this._ownSlug && String(item.href).includes(`/in/${this._ownSlug}`))) { dropped.own++; continue; } // own post: never engage
          if (keySrc.split(/\s+/).length < MIN_WORDS) { dropped.thin++; continue; }
          const allLetters = keySrc.match(/[\p{L}]/gu) || [];
          const asciiLetters = keySrc.match(/[A-Za-z]/g) || [];
          if (allLetters.length > 0 && asciiLetters.length / allLetters.length < 0.5) { dropped.nonlatin++; continue; }
          // Life updates and milestones pass through: they ride the CONGRATS path.
          // Drafting/validation see the clean BODY only - never the headline (which is
          // what produced "Great post on Machine Learning Engineer" on an interview post).
          // head = author/headline/timestamp chrome above the body, used only for audience scoring.
          const ageM = text.match(/(\d+)\s*(mo|yr|[smhdw])\s*•/);
          const ageH = ageM ? Number(ageM[1]) * { s: 1 / 3600, m: 1 / 60, h: 1, d: 24, w: 168, mo: 720, yr: 8760 }[ageM[2]] : 999;
          // Drafting sees the commentary without trailing tally/reaction lines when that
          // still leaves a real post; otherwise the body as before.
          const commentary = LinkedInService.commentaryText(keySrc);
          const draftText = commentary.split(/\s+/).filter(Boolean).length >= 10 ? commentary : keySrc;
          out.push({ key, altKeys, legacyKey, urn: item.urn || "", author: item.author || "unknown", href: item.href || "", text: draftText.slice(0, 1500), head: tlines.slice(0, 8).join(" "), ageH });
        }
        if (fresh === 0) {
          stallRounds++;
          if (stallRounds >= 4) break;
        } else stallRounds = 0;
        try { await this.driver.executeScript("window.scrollBy(0, window.innerHeight * 2);"); } catch (e) {}
        await nap(1500);
      }
      logger.info(`LinkedInService: feed scan collected ${out.length} likeable posts (saw ${cardsSeen} unique cards; dropped: fragment ${dropped.fragment}, dupe ${dropped.dupe}, activity ${dropped.activity}, mixed-authors ${dropped.mixed}, module ${dropped.module}, spam ${dropped.spam}, own ${dropped.own}, thin ${dropped.thin}, non-latin ${dropped.nonlatin}).`);
      return out;
    } catch (err) {
      if (isLinkedInStop(err)) throw err; // the passes must see a wall, not an empty page
      logger.error("LinkedInService: scanFeedPosts failed:", err.message);
      return [];
    }
  }

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
      await nap(800);
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
      await nap(2500);
      const state = await this.driver.executeScript(`
        const q = arguments[0];
        const card = (function() { ${FIND_CARD} })();
        if (!card) return 'gone';
        // Proof is the reaction button's own aria-pressed, nothing else: other pressed
        // buttons in the card (Follow, a toggled comment box) are not a like.
        const rb = Array.from(card.querySelectorAll('button')).find(b => {
          const al = (b.getAttribute('aria-label') || '').toLowerCase();
          return al === 'like' || al === 'react like' || al.indexOf('unlike') === 0 || al.indexOf('reaction button state') === 0;
        });
        if (!rb) return 'no-reaction-button';
        const pressed = rb.getAttribute('aria-pressed');
        if (pressed === 'true') return 'liked';
        return 'not-liked:' + ((rb.getAttribute('aria-label') || '') + '|' + pressed).slice(0, 80);
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


  // Our own profile slug: LINKEDIN_PROFILE_SLUG / the tracker's remembered one, else the
  // nav "Me" link. "" when unknown (the own-comment check is then skipped).
  async _ownProfileSlug() {
    if (this._ownSlug) return this._ownSlug;
    const href = await this.driver.executeScript(`
      const a = document.querySelector('nav a[href*="/in/"], header a[href*="/in/"], .global-nav a[href*="/in/"]');
      return a ? a.href : '';
    `).catch(() => "");
    const m = String(href || "").match(/\/in\/([^/?#]+)/);
    if (m) this._ownSlug = decodeURIComponent(m[1]);
    return this._ownSlug;
  }

  // Comment INLINE on a feed card (no navigation: open its comment box, type, submit).
  // Returns { status, liked }:
  //   "posted"    the comment is on the page
  //   "uncertain" a submit was dispatched but could not be confirmed. Tracked as commented
  //               (unverified): retrying a maybe-posted comment is how double comments happen
  //   "already"   the card already holds a comment by our own profile
  //   "failed"    nothing was submitted, safe to try another time
  // Every non-posted exit clears the editor, so a "leave page?" prompt never blocks the next navigation.
  async commentOnFeedCard(cardKey, authorHref, textSnippet, text, fullName = "") {
    const snip = String(textSnippet).substring(0, 80);
    const EDITOR_SEL = '[aria-label="Text editor for creating comment"], .tiptap, .ProseMirror';
    const FIND = `
      const norm = s => (s || '').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim();
      ${CARDS_JS}
      const nq = norm(arguments[0]);
      const card = cards.find(c => norm(c.innerText).includes(nq)) || null;
    `;
    let submitted = false; // once true, this call can never report "failed"
    let liked = false;
    const clearEditor = async () => {
      try {
        await this.driver.executeScript(`${FIND}
          const ed = card && card.querySelector(arguments[1]);
          if (!ed || !(ed.innerText || '').trim()) return;
          ed.focus();
          document.execCommand('selectAll');
          document.execCommand('delete');
        `, snip, EDITOR_SEL);
      } catch (e) {}
    };
    const done = async (status) => {
      if (status !== "posted") await clearEditor();
      logger.info(`LinkedInService: feed comment result: ${status}.`);
      return { status, liked };
    };
    try {
      await this.ensureDriverConnected(true);
      const ownSlug = await this._ownProfileSlug();
      const opened = await this.driver.executeScript(`${FIND}
        if (!card) return 'no-card';
        if (arguments[1] && !card.querySelector('a[href*="' + arguments[1] + '"]')) return 'author-mismatch';
        try { card.scrollIntoView({ block: 'center' }); } catch (e) {}
        const toggle = Array.from(card.querySelectorAll('button'))
          .find(b => (b.getAttribute('aria-label') || '').toLowerCase() === 'comment');
        if (!toggle) return 'no-toggle';
        toggle.click();
        return 'opened';
      `, snip, String(authorHref || "").split("/in/")[1] || "").catch(() => "fail");
      if (opened !== "opened") {
        logger.warn(`LinkedInService: feed card or Comment toggle not found (${opened}).`);
        return { status: "failed", liked };
      }
      await nap(2500);
      // Already commented here (a run that crashed after posting, or an older key)? Any link
      // to our own profile inside the card's comment list means yes: never post twice.
      if (ownSlug) {
        const mine = await this.driver.executeScript(`${FIND}
          if (!card) return false;
          const ed = card.querySelector(arguments[2]);
          return Array.from(card.querySelectorAll('a[href*="/in/' + arguments[1] + '"]'))
            .some(a => !(ed && ed.contains(a)) && !!a.closest('article, [class*="comment"], [data-id*="comment"]'));
        `, snip, ownSlug, EDITOR_SEL).catch(() => false);
        if (mine) {
          logger.info("LinkedInService: this post already has our comment - not commenting again.");
          return await done("already");
        }
      } else {
        logger.warn("LinkedInService: own profile unknown (set LINKEDIN_PROFILE_SLUG) - own-comment check skipped.");
      }
      // Like first (human flow: like, then comment). Non-fatal if it fails.
      liked = await this.driver.executeScript(`${FIND}
        if (!card) return false;
        const likeBtn = Array.from(card.querySelectorAll('button')).find(b => {
          const al = (b.getAttribute('aria-label') || '').toLowerCase();
          return al === 'like' || al === 'react like' ||
            (al.startsWith('reaction button state') && al.includes('no reaction'));
        });
        if (!likeBtn) return false;
        try { likeBtn.click(); return true; } catch (e) { return false; }
      `, snip).catch(() => false) === true;
      if (liked) logger.info("LinkedInService: post liked before commenting.");
      await nap(1200);
      const editor = await this.driver.executeScript(`${FIND}
        return card ? card.querySelector(arguments[1]) : null;
      `, snip, EDITOR_SEL).catch(() => null);
      if (!editor) {
        logger.warn("LinkedInService: comment editor did not open on feed card.");
        return await done("failed");
      }
      await editor.click();
      await nap(400);
      await editor.sendKeys(Key.chord(MOD_KEY, "a"), Key.BACK_SPACE);
      await nap(300);
      const mentionState = await this._typeWithMention(editor, text, fullName, authorHref);
      logger.info(`LinkedInService: mention flow: ${mentionState}.`);
      // Read back what actually landed in the editor: empty here = typing failed.
      let typedLen = -1;
      try { typedLen = String(await editor.getText()).length; } catch (e) {}
      logger.info(`LinkedInService: comment editor holds ${typedLen} chars after typing.`);
      if (typedLen === 0) {
        // Keystrokes only land while the window has focus; an unattended run often does not. Put the
        // text in with the editor's own insert command, which needs no OS focus, then read it back.
        for (let attempt = 1; attempt <= 2 && typedLen === 0; attempt++) {
          typedLen = await this._insertCommentText(textSnippet, text);
          logger.info(`LinkedInService: insert fallback ${attempt}: editor holds ${typedLen} chars.`);
        }
        if (typedLen <= 0) {
          logger.warn("LinkedInService: editor empty after typing and insert fallback - aborting post.");
          return await done("failed");
        }
      }
      await nap(2000);
      // Submit finder: the submit button is the ONLY button whose visible text is exactly
      // "Comment" (toggles show a count like "7" and carry aria-label="Comment" instead).
      // Do NOT match aria-label here - that would click the toggle and close the editor.
      // The button renders only after typing fires input events, so poll for it.
      const clickSubmit = `${FIND}
        if (!card) return 'no-card';
        const btn = Array.from(card.querySelectorAll('button'))
          .find(b => (b.innerText || '').trim().toLowerCase() === 'comment' && !b.disabled);
        if (!btn) return 'no-button';
        try { btn.click(); return 'clicked'; } catch (e) { return 'click-threw'; }
      `;
      let submitEl = null;
      for (let attempt = 0; attempt < 4 && !submitted; attempt++) {
        if (attempt > 0) await nap(2000); // button renders async after input events
        submitEl = await this.driver.executeScript(clickSubmit, snip).catch(() => null);
        submitted = submitEl === "clicked";
      }
      logger.info(`LinkedInService: submit button state: ${submitEl}.`);
      if (!submitted) {
        // From here on a submit may be in flight: the result can only be posted or uncertain.
        submitted = true;
        await editor.click();
        await nap(300);
        const actions = this.driver.actions({ async: true });
        await actions.keyDown(MOD_KEY).sendKeys(Key.ENTER).keyUp(MOD_KEY).perform();
        logger.info("LinkedInService: submit fell back to keyboard.");
      }
      // Watch for ~20 s instead of re-clicking: a second click on a slow submit is a second comment.
      const want = String(text).replace(/\s+/g, " ").trim().substring(0, 40);
      let state = { onPage: false, residual: -1 };
      for (let i = 0; i < 10; i++) {
        await sleep(2000);
        state = await this.driver.executeScript(`${FIND}
          const ed = card ? card.querySelector(arguments[2]) : null;
          const residual = ed ? (ed.innerText || '').trim().length : -1;
          const want = norm(arguments[1]);
          const nodes = Array.from((card || document).querySelectorAll('article, [class*="comment"]'))
            .filter(n => !(ed && (n.contains(ed) || ed.contains(n))));
          return { residual, onPage: !!want && nodes.some(n => norm(n.innerText).includes(want)) };
        `, snip, want, EDITOR_SEL).catch(() => state) || state;
        if (state.onPage) break;
      }
      logger.info(`LinkedInService: after submit: on-page=${state.onPage}, editor-residual=${state.residual}.`);
      if (state.onPage) return await done("posted");
      logger.warn("LinkedInService: submit dispatched but the comment is not visible (hidden by sorting, slow, or dropped) - tracking it as unverified.");
      return await done("uncertain");
    } catch (err) {
      logger.error("LinkedInService: commentOnFeedCard failed:", err.message);
      if (isLinkedInStop(err) && !submitted) throw err;
      return await done(submitted ? "uncertain" : "failed");
    }
  }

  // Type comment text, converting the author's name into a REAL @-mention.
  // Three hard rules (from live-DOM inspection): the typeahead popup must be ANCHORED
  // near this editor (a far-away listbox belongs to another card - never touch it),
  // the option's FIRST LINE must equal the full name (LinkedIn renders "Name\nheadline")
  // AND the option must reference the author's own profile id from post.href (two people
  // can share a name; tagging the wrong one is public), and the pick must be VERIFIED as a chip in the editor. Anything else falls back
  // to plain text. This is how "never tag strangers" is actually enforced.

  // Fallback for typing that did not land: re-find this card's editor, focus it, and insert the text
  // with execCommand (the same path paste uses). Returns the character count now in the editor.
  async _insertCommentText(textSnippet, text) {
    try {
      return await this.driver.executeScript(`
        const norm = s => (s || '').replace(/[\\u200b-\\u200d\\ufeff]/g, '').replace(/\\s+/g, ' ').trim();
        ${CARDS_JS}
        const nq = norm(arguments[0]);
        const card = cards.find(c => norm(c.innerText).includes(nq));
        if (!card) return -1;
        const ed = card.querySelector('[aria-label="Text editor for creating comment"], .tiptap, .ProseMirror');
        if (!ed) return -1;
        try { window.focus(); } catch (e) {}
        ed.focus();
        document.execCommand('selectAll');
        document.execCommand('delete');
        document.execCommand('insertText', false, arguments[1]);
        return (ed.innerText || '').trim().length;
      `, String(textSnippet).substring(0, 80), String(text)).catch(() => -1);
    } catch (e) {
      return -1;
    }
  }

  async _typeWithMention(editor, text, fullName, authorHref = "") {
    const plainFallback = async () => {
      try {
        try { await editor.sendKeys(Key.ESCAPE); } catch (e) {}
        await nap(300);
        await editor.sendKeys(Key.chord(MOD_KEY, "a"), Key.BACK_SPACE);
        await nap(300);
        await editor.sendKeys(text);
      } catch (e2) {}
      return "plain-fallback";
    };
    try {
      const name = String(fullName || "").trim();
      const idx = name && name.toLowerCase() !== "there" && name.toLowerCase() !== "unknown"
        ? String(text).toLowerCase().indexOf(name.toLowerCase())
        : -1;
      // No profile id to match the typeahead option against: the name stays plain text.
      const wantId = (String(authorHref || "").match(/\/(?:in|company)\/([^/?#]+)/) || [])[1] || "";
      if (idx < 0 || !wantId) { await editor.sendKeys(text); return "plain"; }
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
              // Same person, not just the same name: the option must carry the author's profile id.
              const ids = (o.outerHTML || "") + " " + Array.from(o.querySelectorAll("a[href]")).map(x => x.href).join(" ");
              if (ids.indexOf(arguments[2]) === -1) continue;
              if (first === want || (want.length >= 3 && first.indexOf(want + " ") === 0)) {
                try { o.click(); return 'picked:' + first.slice(0, 60); } catch (e) { return 'click-threw'; }
              }
            }
          }
          return null;
        `, name, edRect, wantId).catch(() => null);
        if (picked && picked.indexOf("picked:") !== 0) { picked = null; break; }
      }
      if (!picked) return await plainFallback();
      logger.info(`LinkedInService: mention picked (${picked}).`);
      await nap(800);
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
      await nap(2000);
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
      await nap(5000);
      await this._assertUsable(false); // login/checkpoint/limit wall: typed error, handled below
      for (let i = 0; i < 3; i++) {
        try { await this.driver.executeScript("window.scrollBy(0, window.innerHeight);"); } catch (e) {}
        await nap(1200);
      }
      const readPeople = () => this.driver.executeScript(`
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
      let people = await readPeople();
      // Results render lazily; give a slow page a few more chances before calling it empty.
      for (let i = 0; i < 3 && !(people && people.length); i++) {
        await nap(3000);
        try { await this.driver.executeScript("window.scrollBy(0, 300);"); } catch (e) {}
        people = await readPeople();
      }
      if (!people || !people.length) {
        // An empty page may be the "commercial use limit" banner rather than no results.
        await this._assertUsable(true);
        const where = await this.driver.executeScript("return location.href.slice(0, 160) + ' | ' + document.title + ' | ' + (document.body ? document.body.innerText.slice(0, 120).split(String.fromCharCode(10)).join(' / ') : '')").catch(() => "?");
        logger.warn(`LinkedInService: people search "${keywords}" page ${page} found no invite buttons (${where}).`);
      }

      return { blocked: false, people: people || [] };
    } catch (e) {
      logger.warn(`LinkedInService: people search failed: ${e.message}`);
      // A wall (signed out, checkpoint, limit) blocks the pass; code tells feedEngage which.
      if (isLinkedInStop(e)) return { blocked: true, code: e.code, reason: e.message, people: [] };
      return { blocked: false, people: [] };
    }
  }

  // True while the tab is still on people-search results (a send must never leave it
  // somewhere else, e.g. a profile page or a verification step, with the pass still running).
  async onPeopleSearchPage() {
    const url = await this.driver.getCurrentUrl().catch(() => "");
    return /linkedin\.com\/search\/results\/people/i.test(url);
  }

  // Send one connection request WITHOUT a note from the current search page.
  // person = { label, href }: the Invite button is looked up inside the result whose /in/
  // link is this person's, never by label alone (two "Invite Alex Kim" buttons can exist).
  // Returns 'sent' | 'sent-unverified' (Send was clicked but the re-render was slow: counted
  // as sent, over-counting beats under-counting a cap) | 'limit' (weekly cap: stop) | 'email' | 'fail'.
  async sendConnectRequest(person) {
    const label = typeof person === "string" ? person : String((person && person.label) || "");
    const slug = typeof person === "string" ? "" : ((String((person && person.href) || "").match(/\/in\/([^/?#]+)/) || [])[1] || "");
    let dispatched = false; // true once a click may have sent the invite
    try {
      const clicked = await this.driver.executeScript(`
        const label = arguments[0], slug = arguments[1];
        const isInvite = x => (x.getAttribute('aria-label') || '').trim() === label;
        let b = null;
        if (slug) {
          for (const a of document.querySelectorAll('a[href*="/in/' + slug + '"]')) {
            let c = a;
            for (let i = 0; i < 8 && c.parentElement && !b; i++) {
              c = c.parentElement;
              const inv = Array.from(c.querySelectorAll('a, button')).filter(isInvite);
              if (inv.length === 1) b = inv[0];
              else if (inv.length > 1) break; // container spans several results: ambiguous
            }
            if (b) break;
          }
        } else {
          const all = Array.from(document.querySelectorAll('a, button')).filter(isInvite);
          if (all.length === 1) b = all[0];
        }
        if (!b) return 'no-button';
        try { b.scrollIntoView({ block: 'center' }); b.click(); return 'clicked'; } catch (e) { return 'fail'; }
      `, label, slug).catch(() => 'fail');
      if (clicked !== 'clicked') return "fail";
      dispatched = true; // some accounts send straight from the Invite click, with no modal
      await nap(1800);
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
        // A modal that stopped short of Send means nothing was sent.
        try { await this.driver.actions().sendKeys(Key.ESCAPE).perform(); } catch (e) {}
        return modal === "limit" ? "limit" : modal === "email" ? "email" : "fail";
      }
      // Proof: the Invite button is gone (swapped to Pending) and no dialog is left open.
      // Poll a few seconds: the re-render can lag behind the send.
      let state = "fail";
      for (let i = 0; i < 3 && state !== "gone" && state !== "limit"; i++) {
        await nap(2200);
        state = await this.driver.executeScript(`
        const label = arguments[0];
        const still = Array.from(document.querySelectorAll('a, button')).some(x => (x.getAttribute('aria-label') || '').trim() === label);
        const host = document.querySelector('#interop-outlet');
        const dlg = host && host.shadowRoot;
        const dtxt = dlg ? (dlg.textContent || '').toLowerCase() : '';
        if (dtxt.indexOf('invitation limit') !== -1 || dtxt.indexOf('weekly invitation') !== -1) return 'limit';
        return still ? 'still-there' : 'gone';
      `, label).catch(() => 'fail');
      }
      if (state === "limit") { try { await this.driver.actions().sendKeys(Key.ESCAPE).perform(); } catch (e) {} return "limit"; }
      if (state === "gone") return "sent";
      try { await this.driver.actions().sendKeys(Key.ESCAPE).perform(); } catch (e) {}
      return "sent-unverified";
    } catch (e) {
      return dispatched ? "sent-unverified" : "fail";
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
      // Close the tab this service opened (never the user's, never the last one) so runs do
      // not pile up tabs. Bounded: a hung session (pass timeout) must not hang cleanup too.
      const driver = this.driver, own = this._tabHandle;
      if (own) {
        const closeOwn = (async () => {
          const handles = await driver.getAllWindowHandles();
          if (handles.length > 1 && handles.includes(own)) {
            await driver.switchTo().window(own);
            await driver.close();
          }
        })().catch(() => {});
        await Promise.race([closeOwn, sleep(5000)]);
      }
      logger.info("LinkedInService: Releasing WebDriver control of debugging browser session");
      await releaseDriver(this.driver);
    }
    this.driver = null;
    this.isInitialized = false;
    this._isLoggedIn = false;
    this._tabHandle = null;
  }
}

module.exports = LinkedInService;
