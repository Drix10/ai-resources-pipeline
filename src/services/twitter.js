const { By, Key, until } = require("selenium-webdriver");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");
const { attachDriver, releaseDriver, waitForXLogin, MOD_KEY } = require("../utils/chromeLauncher");
const fs = require("fs");
const path = require("path");

// Anchored to the repo, not process.cwd(): a start from another directory must not
// begin with an empty store and republish everything.
const REPO_ROOT = path.resolve(__dirname, "../..");
const PROCESSED_IDS_PATH = path.join(REPO_ROOT, ".processed-tweet-ids.json");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "logs");
const SCREENSHOT_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const envDays = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const DAY_MS = 24 * 60 * 60 * 1000;
// Older posts are stale news for a daily digest.
const TWEET_MAX_AGE_DAYS = envDays("TWEET_MAX_AGE_DAYS", 14);
// Stored IDs are evicted by tweet age, never by insertion order: anything evicted is
// far older than TWEET_MAX_AGE_DAYS, so the age gate already blocks it.
const PROCESSED_ID_RETENTION_DAYS = Math.max(120, TWEET_MAX_AGE_DAYS + 30);
const MAX_PROCESSED_IDS = 100000;

// X snowflake IDs carry their creation time (ms since the Twitter epoch in the top bits).
function snowflakeTime(id) {
  try {
    if (!/^\d{1,20}$/.test(String(id))) return NaN;
    return Number((BigInt(id) >> 22n) + 1288834974657n);
  } catch {
    return NaN;
  }
}

// Age from the scraped <time> when it parses, else from the ID itself.
function tweetAgeMs(tweetId, timestamp, now = Date.now()) {
  const scraped = timestamp ? Date.parse(timestamp) : NaN;
  const created = Number.isFinite(scraped) ? scraped : snowflakeTime(tweetId);
  return Number.isFinite(created) ? now - created : NaN;
}

function isTooOld(tweetId, timestamp, maxAgeDays = TWEET_MAX_AGE_DAYS, now = Date.now()) {
  const age = tweetAgeMs(tweetId, timestamp, now);
  return Number.isFinite(age) && age > maxAgeDays * DAY_MS;
}

// Topic blocks catch sports, fashion, celebrity and film posts that show up in lists of
// tech people. Each can be lifted by the folder it runs in, and a clear tech subject
// ("computer vision", "robots", "startup") overrides them: those posts are on topic.
const QUOTE = `["'“”‘’]`;
const TECH_CONTEXT_RE = /\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|llms?|neural|computer vision|robots?|robotics?|humanoids?|algorithms?|startups?|open[- ]source|apis?|gpus?|datasets?|software|sensors?|autonomous|generative|model weights|benchmark)\b/i;

const TOPIC_BLOCKS = [
  {
    name: "sports",
    re: /\b(nba|nfl|mlb|premier league|champions league|football|soccer|basketball|baseball|touchdown|pacers|lakers|warriors|celtics|quarterback|referee|halftime score|slam dunk|all-star voting|ipl|cricket|tennis|formula (?:1|one)|f1 (?:race|grand prix|driver|team|season|championship))\b/i,
    exemptFolder: /\b(robot\w*|sports?)\b/i,
  },
  {
    name: "fashion",
    re: /\b(perfume|fragrance|cologne|lipstick|makeup|eyeliner|haute couture|ootd|fashion week|runway (?:show|walk)|dress code|wardrobe|shoes|sneakers|footwear|arch support|skincare)\b/i,
  },
  {
    name: "celebrity",
    re: /\b(kardashian|grammys|oscars red carpet|celebrity dating|paparazzi|celebrity gossip|horoscope|astrology|zodiac)\b/i,
  },
  {
    name: "film",
    re: /\b(film review|movie review|telluride|sundance|cannes film|venice film|box office|movie premiere|film festival|rotten tomatoes|standout performance in the film|comedy-drama film|theatrical release)\b/i,
    // "directed by" only counts as a film credit with a capitalised name and film words
    // nearby; case-insensitively it matched "directed by the planner model".
    test: (text) => /\bdirected by (?:[A-Z][a-z]+ ){1,2}[A-Z][a-z]+\b/.test(text) && /\b(film|movie|starring|documentary|feature|cast)\b/i.test(text),
    exemptFolder: /\b(film|movies?|cinema|media|video|entertainment|artists?|creators?)\b/i,
  },
];

// Engagement bait and coin shilling: dropped in every folder, tech words or not.
const CRYPTO_CONTEXT_RE = /\b(crypto|memecoins?|meme coins?|coins?|nfts?|wallets?|web3|blockchain|on-?chain|defi|dex|solana|ethereum|eth|bitcoin|btc|pump\.fun)\b|\$[A-Za-z]{2,10}\b/i;
const BAIT_PATTERNS = [
  new RegExp(`\\bcomment\\s+${QUOTE}\\s*[\\w-]+\\s*${QUOTE}`, "i"),
  /\bcomment\s+(?:yes|link|send|guide|prompt)\b/i,
  new RegExp(`\\breply\\s+(?:with\\s+)?${QUOTE}\\s*[\\w-]+\\s*${QUOTE}`, "i"),
  /\b(?:reply|comment|retweet|repost|rt|drop a like)\b[^.\n]{0,60}?\b(?:and|&)\s+i(?:'|’)?ll\s+(?:dm|send|share)\b/i,
  /\bretweet for a chance\b/i,
  /\bgiveaway\b/i,
  /\b(?:ca|contract address)\s*:\s*(?:0x[0-9a-f]{6,}|[1-9a-hj-np-z]{32,44})\b/i,
  // Shill phrases only near coin words: "the next 10x in inference" and "back to the moon" are fine.
  { test: (text) => /\b(?:next|easy|potential)\s+\d{2,4}x\b|\b\d{2,4}x\s+(?:gem|potential|coin)\b|\bto the moon\b|\bape (?:in|into)\b|\bpresale (?:is )?(?:live|open)\b/i.test(text) && CRYPTO_CONTEXT_RE.test(text) },
  { test: (text) => /\b(airdrops?|whitelist(?:ed)?|presale|free tokens)\b/i.test(text) && CRYPTO_CONTEXT_RE.test(text) },
  /\b(\d+\s+(?:morning\s+)?habits\b|morning routine\b|mindset shift\b|how to wake up at \d|financial freedom in \d|crypto signal group|passive income|(?:become|became|becoming) a (?:millionaire|billionaire)|millionaire mindset)\b/i,
];

function isOfftopicTweet(text, folderName = "") {
  if (!text || typeof text !== "string") return false;
  if (BAIT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const techContext = TECH_CONTEXT_RE.test(text);
  return TOPIC_BLOCKS.some((block) => {
    if (block.exemptFolder && block.exemptFolder.test(folderName || "")) return false;
    if (!(block.re.test(text) || (block.test && block.test(text)))) return false;
    return !techContext;
  });
}

// Self-promotion phrases, word-bounded: a bare substring check dropped "LDM for video
// generation" ("dm for") and "Feel free to use my code" ("use my code").
const SPAM_PATTERNS = [
  /\bwe(?:'|’)?re hiring\b|\bwe are hiring\b/i,
  /\bhiring for\b/i,
  /\bdm me (?:to|for)\b/i,
  /\bdm for\b/i,
  /\bjoin my team\b/i,
  /\bcheck out my course\b/i,
  /\bbuy my book\b/i,
  /\bjoin the waitlist\b/i,
  /\bsign up now\b/i,
  // A promo code is an upper-case token; "use my code to reproduce" is not one.
  new RegExp(`\\b[Uu]se (?:my |promo |discount )?code:?\\s+${QUOTE}?[A-Z0-9]{3,}\\b`),
  /\blimited spots\b/i,
  /\bsubscribe for\b/i,
  /\blink in bio\b/i,
];

function isSpamTweet(text) {
  if (!text || typeof text !== "string") return false;
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

// Event, hiring and awareness-day promotion: never a concrete technical or business fact.
// "join us" and "speaking at" need an event shape: bare, they matched "Join us in building
// the open-source..." and "Speaking at a high level...".
const PROMO_RE = /\b(join us (?:at|for|on|live|this|next|tomorrow|tonight|today|in person)\b|register (?:now|here|today)|webinar|rsvp|early.?bird|tickets? (?:are )?(?:on sale|available)|we(?:'|’)re hiring|now hiring|open roles?|(?:i(?:'|’)m|i am|we(?:'|’)re|we are|i(?:'|’)ll be|we(?:'|’)ll be|will be) speaking at|fireside chat|come meet|see you (?:at|in)|celebrating .{0,40}\bday)\b/i;

function isPromoTweet(text) {
  return typeof text === "string" && PROMO_RE.test(text);
}

// One verdict for the scraper: null keeps the post, otherwise the reason it was dropped.
function classifyTweetText(text, folderName = "") {
  if (!text || typeof text !== "string") return "empty";
  if (isSpamTweet(text)) return "spam";
  if (isPromoTweet(text)) return "promo";
  if (isOfftopicTweet(text, folderName)) return "offtopic";
  return null;
}

// ---- Processed-ID store: a JSON array of tweet IDs, written durably on Windows ----

// Synchronous backoff: markContentAsPublished is sync and must finish before posting.
const sleepSync = (ms) => {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* best effort */ }
};

function readIdFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!Array.isArray(parsed)) return { exists: true, error: "not a JSON array" };
    return { exists: true, ids: parsed.filter((id) => typeof id === "string" && /^\d+$/.test(id)) };
  } catch (error) {
    return { exists: true, error: error.message };
  }
}

// Unions the main file, a leftover .tmp (crash between write and rename) and the .bak.
// Returns { ids, error }: error is set only when a store existed but nothing could be
// read, so the caller refuses to run instead of republishing everything from an empty set.
function loadIdStore(filePath) {
  const sources = [filePath, `${filePath}.tmp`, `${filePath}.bak`].map((p) => ({ p, ...readIdFile(p) }));
  const main = sources[0];
  const readable = sources.filter((s) => s.ids);
  const ids = new Set(readable.flatMap((s) => s.ids));

  if (main.error) {
    // Set the bad file aside so the next save cannot be confused by it, and keep it for a human.
    const aside = `${filePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(filePath, aside);
      logger.error(`Processed-ID store ${filePath} was unreadable (${main.error}); set aside as ${aside}`);
    } catch (error) {
      logger.error(`Processed-ID store ${filePath} is unreadable (${main.error}) and could not be set aside: ${error.message}`);
    }
  }
  if (readable.length > 0) {
    if (!main.ids) logger.warn(`Processed-ID store recovered from ${readable.map((s) => path.basename(s.p)).join(" + ")}`);
    return { ids, error: null };
  }

  // Nothing readable. A store that never existed is a first run; anything else (a corrupt
  // file, or one set aside earlier) needs a human before X content is curated again.
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  let setAside = [];
  try { setAside = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.corrupt-`)); } catch { /* no dir yet */ }
  if (sources.some((s) => s.exists) || setAside.length > 0) {
    return {
      ids,
      error: `processed-ID store unreadable (${filePath}; set-aside copies: ${setAside.join(", ") || "none"}). Restore it from a .corrupt-* copy, or delete those copies to start fresh.`,
    };
  }
  return { ids, error: null };
}

function renameWithRetry(from, to, attempts = 6) {
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      // Antivirus, indexers and a second reader briefly lock files on Windows.
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || i >= attempts - 1) throw error;
      sleepSync(50 * 2 ** i);
    }
  }
}

// Write .tmp (fsynced), keep the current good file as .bak, then rename over the target.
// The target is never deleted first: a crash at any point leaves a readable store.
function saveIdStore(filePath, ids) {
  const tempPath = `${filePath}.tmp`;
  const fd = fs.openSync(tempPath, "w");
  try {
    fs.writeSync(fd, JSON.stringify(Array.from(ids)));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (readIdFile(filePath).ids) {
    try { fs.copyFileSync(filePath, `${filePath}.bak`); } catch (error) { logger.warn(`Could not refresh ${filePath}.bak: ${error.message}`); }
  }
  renameWithRetry(tempPath, filePath);
}

// Evict by tweet age (snowflake time), never by insertion order. The hard cap only
// matters if the retention window ever holds more than MAX_PROCESSED_IDS posts.
function pruneIds(ids, { now = Date.now(), retentionDays = PROCESSED_ID_RETENTION_DAYS, max = MAX_PROCESSED_IDS } = {}) {
  const cutoff = now - retentionDays * DAY_MS;
  let kept = Array.from(ids).filter((id) => {
    const t = snowflakeTime(id);
    return !Number.isFinite(t) || t >= cutoff;
  });
  if (kept.length > max) {
    kept.sort((a, b) => snowflakeTime(b) - snowflakeTime(a));
    kept = kept.slice(0, max);
  }
  return new Set(kept);
}

// ---- X availability: failures a retry cannot fix end the X phase for the run ----

function xUnavailable(message) {
  const error = new Error(`X unavailable: ${message}`);
  error.code = "X_UNAVAILABLE";
  return error;
}

// Login flow, logout or the account-access (locked / challenge) page.
function classifyXUrl(url) {
  let pathname = "";
  try { pathname = new URL(url).pathname; } catch { return null; }
  if (/^\/(?:i\/flow\/login|login|logout|i\/flow\/signup)\b/.test(pathname)) return "logged out of X (login page)";
  if (/^\/account\/access\b/.test(pathname)) return "X account locked or challenged (/account/access)";
  return null;
}

const SESSION_ERROR_RE = /invalid session|no such window|chrome not reachable|session not created|session deleted|disconnected|target window already closed|web view not found|ECONNREFUSED|ECONNRESET|socket hang up|not connected to devtools/i;
const isSessionError = (error) => SESSION_ERROR_RE.test(String(error?.message || error || ""));

// Resolves the promise, or rejects after ms so a hung WebDriver call cannot stall a run.
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// Full-page failures only: a single "Something went wrong" cell inside a working
// timeline is not one, so pages that still show posts pass.
function detectXErrorPage() {
  if (document.querySelector('article[data-testid="tweet"]')) return "";
  const body = ((document.body && document.body.innerText) || "").slice(0, 5000);
  const match = body.match(/Something went wrong\. Try reloading\.|Rate limit exceeded|over the daily limit|temporarily (?:restricted|limited)|account (?:is )?(?:suspended|locked)/i);
  if (match) return match[0];
  const detail = document.querySelector('[data-testid="error-detail"]');
  if (detail) return ((detail.innerText || "").trim().slice(0, 120)) || "error page";
  return "";
}

class TwitterService {
  constructor(options = {}) {
    this.driver = null;
    // The one tab this service opened and owns; the user's other tabs are never touched.
    this.tabHandle = null;
    this.RATE_LIMIT_DELAY = 1500;
    this.lastRequestTime = 0;
    this.isInitialized = false;
    this.MAX_PROCESSED_IDS = MAX_PROCESSED_IDS;
    this.storePath = options.storePath || PROCESSED_IDS_PATH;
    this.storeError = null;
    // IDs handed out this run, so overlapping lists never yield the same post twice.
    this.reservedIds = new Set();
    this.processedTweetIds = this.loadProcessedIds();
  }

  // Called by cron right after it takes the pipeline lock: reread the store (a second
  // instance or a manual edit may have changed it) and start a fresh reservation set.
  beginRun() {
    this.processedTweetIds = this.loadProcessedIds();
    this.reservedIds = new Set();
  }

  isKnownId(id) {
    return this.processedTweetIds.has(id) || this.reservedIds.has(id);
  }

  pruneProcessedIds() {
    const before = this.processedTweetIds.size;
    this.processedTweetIds = pruneIds(this.processedTweetIds);
    const dropped = before - this.processedTweetIds.size;
    if (dropped > 0) logger.info(`Evicted ${dropped} processed tweet IDs older than ${PROCESSED_ID_RETENTION_DAYS} days`);
    return dropped;
  }

  // Kept for older callers: eviction is by tweet age now, see pruneIds.
  clearProcessedIds() {
    return this.pruneProcessedIds();
  }

  loadProcessedIds() {
    const { ids, error } = loadIdStore(this.storePath);
    this.storeError = error;
    if (error) logger.error(`Published X IDs: ${error}`);
    return pruneIds(ids);
  }

  persistProcessedIds() {
    // Writing now would replace an unreadable store with a partial one and hide the problem.
    if (this.storeError) {
      logger.error(`Not writing published X IDs: ${this.storeError}`);
      return false;
    }
    try {
      // Merge what another instance may have written since this run loaded the store.
      const onDisk = loadIdStore(this.storePath);
      if (!onDisk.error) for (const id of onDisk.ids) this.processedTweetIds.add(id);
      this.processedTweetIds = pruneIds(this.processedTweetIds);
      saveIdStore(this.storePath, this.processedTweetIds);
      return true;
    } catch (error) {
      logger.error(`Could not persist published X IDs: ${error.message}`);
      return false;
    }
  }

  markContentAsPublished(collections) {
    let changed = false;
    for (const collection of collections || []) {
      for (const tweet of collection?.tweets || []) {
        // Prefer the ID findContent stored; parse the URL only for older objects.
        const id = tweet?.tweetId || tweet?.id || String(tweet?.url || "").match(/\/status\/(\d+)/)?.[1];
        if (!id) continue;
        this.reservedIds.add(String(id));
        if (!this.processedTweetIds.has(String(id))) {
          this.processedTweetIds.add(String(id));
          changed = true;
        }
      }
    }
    this.pruneProcessedIds();
    if (changed) this.persistProcessedIds();
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
    // Record timestamp AFTER the sleep so the next caller measures from when
    // this request actually completed, not when the wait started.
    this.lastRequestTime = Date.now();
  }

  currentUrl(ms = 10000) {
    return withTimeout(this.driver.getCurrentUrl(), ms, "getCurrentUrl");
  }

  // Health probe that does not depend on the current tab still being open.
  async isDriverHealthy() {
    if (!this.driver) return false;
    try {
      await withTimeout(this.driver.getAllWindowHandles(), 10000, "WebDriver health probe");
      return true;
    } catch (error) {
      logger.warn(`TwitterService: WebDriver health probe failed (${error.message})`);
      return false;
    }
  }

  async ensureDriverConnected() {
    if (this.driver && this.isInitialized && (await this.isDriverHealthy())) return;
    if (this.driver) {
      logger.warn("TwitterService: WebDriver session was lost or invalid. Reattaching...");
      await this.cleanup({ closeTab: false });
    }
    await this.init();
  }

  async init() {
    try {
      // A reused driver may sit on a dead chromedriver or a closed Chrome: probe it first.
      if (this.driver && this.isInitialized && !(await this.isDriverHealthy())) {
        logger.warn("TwitterService: reused WebDriver is unhealthy; reattaching (relaunches Chrome if needed)");
        await this.cleanup({ closeTab: false });
      }
      if (!this.driver || !this.isInitialized) {
        this.driver = await attachDriver();
        this.isInitialized = true;
        logger.info("Connected to existing Chrome browser");
        // Session-level bound so a hung page load cannot stall the run.
        try { await this.driver.manage().setTimeouts({ pageLoad: 60000, script: 30000 }); } catch (e) { }
      }
      await this.ensureTab();
      await this.login();
    } catch (error) {
      logger.error("Failed to initialize:", error);
      await this.cleanup({ closeTab: false });
      throw error;
    }
  }

  // Use the tab this service opened if it still exists, else open exactly one new tab.
  // Never switches through the user's tabs. Tab handles are Chrome target IDs, so the
  // same tab is found again after a reattach.
  async ensureTab() {
    const handles = await withTimeout(this.driver.getAllWindowHandles(), 10000, "listing tabs");
    if (this.tabHandle && handles.includes(this.tabHandle)) {
      await withTimeout(this.driver.switchTo().window(this.tabHandle), 10000, "switching to the X tab");
      return;
    }
    try {
      await withTimeout(this.driver.switchTo().newWindow("tab"), 15000, "opening the X tab");
    } catch (error) {
      // New Window fails when the session's current tab was closed; anchor on any tab first.
      if (!handles.length) throw error;
      await withTimeout(this.driver.switchTo().window(handles[0]), 10000, "anchoring on a tab");
      await withTimeout(this.driver.switchTo().newWindow("tab"), 15000, "opening the X tab");
    }
    this.tabHandle = await withTimeout(this.driver.getWindowHandle(), 10000, "reading the tab handle");
    logger.info("TwitterService: opened a dedicated X tab");
  }

  async closeOwnTab() {
    if (!this.driver || !this.tabHandle) return;
    const handles = await withTimeout(this.driver.getAllWindowHandles(), 5000, "listing tabs");
    if (!handles.includes(this.tabHandle)) return;
    // Closing the last tab would close the user's browser window.
    if (handles.length <= 1) return;
    await withTimeout(this.driver.switchTo().window(this.tabHandle), 5000, "switching to the X tab");
    await withTimeout(this.driver.close(), 5000, "closing the X tab");
  }

  // Throws X_UNAVAILABLE for states a retry cannot fix: logged out, account locked or
  // challenged, or an error / rate-limit page that survives one reload.
  async assertXUsable(context) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const urlProblem = classifyXUrl(await this.currentUrl());
      if (urlProblem) {
        await this.saveFailureScreenshot("x-unavailable");
        throw xUnavailable(`${urlProblem} while ${context}`);
      }
      const pageProblem = await withTimeout(this.driver.executeScript(detectXErrorPage), 10000, "error-page check").catch(() => "");
      if (!pageProblem) return;
      if (attempt === 0) {
        logger.warn(`X showed "${pageProblem}" while ${context}; reloading once`);
        await withTimeout(this.driver.navigate().refresh(), 60000, "reload").catch(() => { });
        await sleep(4000);
        continue;
      }
      await this.saveFailureScreenshot("x-unavailable");
      throw xUnavailable(`"${pageProblem}" persisted after a reload while ${context}`);
    }
  }

  async login() {
    try {
      await waitForXLogin(this.driver, "pipeline");
    } catch (error) {
      logger.error("Error during X (Twitter) login check:", error);
      if (error.code === "X_UNAVAILABLE") throw error;
      // Still on a login or account-access page, or nobody logged in within the wait.
      const urlProblem = classifyXUrl(await this.currentUrl().catch(() => ""));
      if (urlProblem || /login timed out/i.test(String(error.message))) {
        throw xUnavailable(urlProblem || error.message);
      }
      throw error;
    }
  }

  async findContent(folderName = "") {
    try {
      // The writer skips roughly half of what it is given (opinion, PR, thin posts),
      // so collect a deeper pool; generation keeps at most 8 articles per file.
      const THREADS_NEEDED = 16;
      const MAX_SCROLL_ATTEMPTS = 24;
      const SCROLL_PAUSE = 700;
      const INITIAL_LOAD_TIMEOUT = 10000;
      const MIN_TOTAL_WORDS = 30;
      const MIN_WORDS_WITH_EXTERNAL_LINK = 15;
      // Lists run newest first: a long run of stale posts means nothing fresh is left.
      const MAX_OLD_STREAK = 15;

      let collectedContent = [];
      let scrollAttempts = 0;
      let validTweetsCount = 0;
      const seenTweetIds = new Set();
      let sameContentCount = 0;
      let oldStreak = 0;
      const skipped = {};
      const skip = (reason, tweetId) => {
        skipped[reason] = (skipped[reason] || 0) + 1;
        logger.debug(`Skipping tweet ${tweetId}: ${reason}`);
      };

      this.pruneProcessedIds();

      const articleLocator = By.css('article[data-testid="tweet"]');
      try {
        await this.driver.wait(until.elementLocated(articleLocator), INITIAL_LOAD_TIMEOUT);
      } catch (error) {
        logger.warn(`No posts after ${INITIAL_LOAD_TIMEOUT / 1000}s; checking whether X itself is failing`);
        // Logged out, locked or a persistent error page end the X phase (X_UNAVAILABLE);
        // otherwise give a slow page (or the one reload) one more wait.
        await this.assertXUsable(`loading list for ${folderName || "folder"}`);
        try {
          await this.driver.wait(until.elementLocated(articleLocator), INITIAL_LOAD_TIMEOUT);
        } catch (retryError) {
          logger.error("Initial tweet selector not found:", retryError);
          throw retryError;
        }
      }

      while (scrollAttempts < MAX_SCROLL_ATTEMPTS && validTweetsCount < THREADS_NEEDED) {
        let batch = [];
        try {
          batch = await this.driver.executeScript(() => {
            const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
            const list = [];
            for (const el of articles) {
              try {
                // A quoted post sits in a [role=link] card inside the article. Anything in
                // that card belongs to the quoted post, never to the outer one.
                const inQuote = (node) => {
                  const card = node.closest('[role="link"]');
                  return !!card && card !== el && el.contains(card);
                };

                // The permalink wrapping the first <time> is the post's own; fall back to
                // the first status link. Normalised so /photo/1 or /analytics never leak in.
                const timeEl = el.querySelector("time");
                const statusA = (timeEl && timeEl.closest('a[href*="/status/"]')) || el.querySelector('a[href*="/status/"]');
                const rawUrl = statusA ? statusA.href : "";
                const idMatch = rawUrl.match(/\/status\/(\d+)/);
                const tweetId = idMatch ? idMatch[1] : "";
                if (!tweetId) continue;
                const url = rawUrl.replace(/(\/status\/\d+).*$/, "$1");
                const timestamp = timeEl ? timeEl.getAttribute("datetime") || "" : "";

                const textNodes = Array.from(el.querySelectorAll('[data-testid="tweetText"]'));
                const mainNodes = textNodes.filter((n) => !inQuote(n));
                const quoteNodes = textNodes.filter((n) => inQuote(n));
                // Without the card structure, keep the old reading: first block is the post.
                const ownNodes = mainNodes.length ? mainNodes.slice(0, 1) : [];
                const quotedNodes = mainNodes.length ? quoteNodes.concat(mainNodes.slice(1)) : quoteNodes;
                const mainText = ownNodes.map((n) => (n.innerText || "").trim()).join("\n").trim();
                const quotedText = quotedNodes.map((n) => (n.innerText || "").trim()).filter(Boolean).join("\n\n");
                let text = mainText;
                if (quotedText) text += "\n\nQuoted Tweet:\n" + quotedText;

                // "Show more" means the visible text is cut; an article from half a post is not safe.
                const showMore = Array.from(el.querySelectorAll('[data-testid="tweet-text-show-more-link"]'));
                const truncated = showMore.some((n) => !inQuote(n));

                // Promoted posts: a bare "Ad"/"Promoted" label outside the text. Not placementTracking:
                // X wraps every organic video player in it, so it would drop all video demos.
                const isAd = Array.from(el.querySelectorAll("span")).some((s) => !s.closest('[data-testid="tweetText"]') && /^(Ad|Promoted)$/.test((s.textContent || "").trim()));

                const isReply = Array.from(el.querySelectorAll("div")).some((n) => !inQuote(n)
                  && !n.closest('[data-testid="tweetText"]') && /^Replying to\b/.test((n.textContent || "").trim()));

                const links = [];
                const anchors = Array.from(el.querySelectorAll("a[href]"));
                for (const a of anchors) {
                  const href = a.href;
                  if (!href) continue;
                  const hl = href.toLowerCase();
                  const isInternal = hl.includes("twitter.com/") || hl.includes("x.com/") || href.startsWith("/");
                  const isNav = hl.includes("/status/") || hl.includes("/hashtag/") || hl.includes("/search") || hl.includes("/i/lists") || hl.includes("/home");
                  if (hl.includes("t.co") || !isInternal || (!isNav && !href.startsWith("/"))) {
                    links.push(href);
                  }
                }

                const images = [];
                const imgEls = Array.from(el.querySelectorAll('[data-testid="tweetPhoto"] img'));
                for (const img of imgEls) {
                  if (img.src) images.push(img.src);
                }

                list.push({ tweetId, url, timestamp, text, mainText, links, images, truncated, isAd, isReply });
              } catch (e) {}
            }
            return list;
          });
        } catch (scriptErr) {
          // A dead session must reach the retry loop (it reattaches); a script error just skips the step.
          if (isSessionError(scriptErr)) throw scriptErr;
          logger.warn("Batch DOM extraction failed:", scriptErr.message);
        }

        let newInScroll = 0;

        for (const item of batch || []) {
          if (validTweetsCount >= THREADS_NEEDED) break;
          const { tweetId, url, timestamp, text, mainText, links, images, truncated, isAd, isReply } = item;
          if (!tweetId || seenTweetIds.has(tweetId)) continue;
          seenTweetIds.add(tweetId);
          newInScroll++;

          // Published before, or already taken by another folder this run.
          if (this.isKnownId(tweetId)) { skip("already published or reserved this run", tweetId); continue; }
          if (isAd) { skip("promoted post", tweetId); continue; }
          if (isReply) { skip("reply", tweetId); continue; }
          if (truncated) { skip("truncated (Show more)", tweetId); continue; }
          // mainText is absent only if the page script is older than this file; then use text.
          if (!(mainText ?? text)) { skip("no text of its own", tweetId); continue; }

          if (isTooOld(tweetId, timestamp)) {
            skip(`older than ${TWEET_MAX_AGE_DAYS} days`, tweetId);
            if (++oldStreak >= MAX_OLD_STREAK) break;
            continue;
          }
          oldStreak = 0;

          const reason = classifyTweetText(text, folderName);
          if (reason) { skip(reason, tweetId); continue; }

          const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
          const hasExternalLink = (links || []).some(l => /^https?:\/\//i.test(l) && !/^(https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(l));
          const hasEnoughDetail = wordCount >= MIN_TOTAL_WORDS || (hasExternalLink && wordCount >= MIN_WORDS_WITH_EXTERNAL_LINK);

          if (!hasEnoughDetail) {
            skip(`thin (${wordCount} words)`, tweetId);
            continue;
          }

          // Reserve at collection time: overlapping lists in later folders skip it.
          this.reservedIds.add(tweetId);
          collectedContent.push({
            tweets: [{ tweetId, text, links, images, url, timestamp }],
            url,
            timestamp
          });
          validTweetsCount++;
        }

        if (oldStreak >= MAX_OLD_STREAK) {
          logger.info(`Reached ${MAX_OLD_STREAK} posts older than ${TWEET_MAX_AGE_DAYS} days in a row, finishing list.`);
          break;
        }

        if (newInScroll === 0) {
          sameContentCount++;
          if (sameContentCount >= 5) {
            logger.info("No more new tweets loading after multiple fast scrolls, finishing list.");
            break;
          }
        } else {
          sameContentCount = 0;
        }

        if (validTweetsCount >= THREADS_NEEDED) break;

        // Under one screen per step: the timeline is virtualised, so a bigger jump
        // renders and unmounts posts between two extractions without reading them.
        try {
          await this.driver.executeScript("window.scrollBy(0, Math.round(window.innerHeight * 0.8));");
        } catch (e) {
          if (isSessionError(e)) throw e;
        }

        await sleep(SCROLL_PAUSE);
        scrollAttempts++;
      }

      const skipSummary = Object.entries(skipped).map(([k, v]) => `${k}: ${v}`).join(", ");
      logger.info(`Collected ${validTweetsCount} valid high-signal content pieces${skipSummary ? ` (skipped ${skipSummary})` : ""}`);
      return collectedContent;
    } catch (error) {
      logger.error("Error in findContent:", error);
      throw error;
    }
  }

  async openList(listId) {
    const listUrl = `https://x.com/i/lists/${listId}`;
    for (let i = 0; i < 3; i++) {
      try {
        await withTimeout(this.driver.get(listUrl), 90000, `loading ${listUrl}`);
        // A login redirect will not turn into the list by waiting: fail fast.
        const urlProblem = classifyXUrl(await this.currentUrl());
        if (urlProblem) {
          await this.saveFailureScreenshot("x-unavailable");
          throw xUnavailable(`${urlProblem} while opening ${listUrl}`);
        }
        await this.driver.wait(until.urlContains(`/i/lists/${listId}`), 30000);
        return;
      } catch (gotoError) {
        if (gotoError.code === "X_UNAVAILABLE" || isSessionError(gotoError) || i === 2) throw gotoError;
        logger.error(`Error navigating to ${listUrl} (attempt ${i + 1}): ${gotoError.message}`);
        await sleep(5000);
      }
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
    // Curating without the published-ID store would republish everything it ever posted.
    if (this.storeError) throw xUnavailable(this.storeError);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.ensureDriverConnected();
        await this.ensureTab();

        await this.checkRateLimit();
        const { listId, name } = this.getSearchQuery(folder);
        logger.info(`Processing list ID: ${listId} (Type: ${name})`);
        await this.openList(listId);

        return await this.findContent(name);
      } catch (error) {
        // Logged out, locked, rate limited: retrying only hammers X. cron ends the X phase.
        if (error.code === "X_UNAVAILABLE") throw error;
        logger.error(
          `Attempt ${attempt} failed to fetch tweets: ${error.message}`
        );
        if (attempt >= maxRetries) {
          logger.error("Max retries reached. Unable to fetch tweets.");
          throw error;
        }
        logger.info(`Retrying in ${retryDelay / 1000} seconds...`);
        await sleep(retryDelay);
        // Reattach only when the session or connection itself broke.
        if (reinitializeOnFailure && isSessionError(error)) {
          await this.cleanup({ closeTab: false });
        }
      }
    }
  }

  // Safe at the end of every run and on shutdown. Closes only the tab this service
  // opened (unless closeTab is false, for a reattach), then stops chromedriver; the
  // instance can init() again afterwards.
  async cleanup({ closeTab = true } = {}) {
    try {
      if (this.driver) {
        if (closeTab) {
          try {
            await this.closeOwnTab();
          } catch (tabErr) {
            logger.warn(`TwitterService: could not close the X tab: ${tabErr.message}`);
          }
        }
        logger.info("TwitterService: Releasing WebDriver control of debugging browser session");
        // No quit(): that would close the user's browser tabs. Stop only this
        // session's chromedriver process so reconnects don't leak them.
        await releaseDriver(this.driver);
      }
    } catch (error) {
      logger.error("Failed to clean up:", error);
    } finally {
      this.driver = null;
      this.isInitialized = false;
      if (closeTab) this.tabHandle = null;
    }
  }

  async saveFailureScreenshot(name) {
    try {
      if (!this.driver) return;
      const image = await withTimeout(this.driver.takeScreenshot(), 10000, "screenshot");
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
      const file = path.join(SCREENSHOT_DIR, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
      fs.writeFileSync(file, image, "base64");
      logger.info(`Saved failure screenshot: ${file}`);
    } catch (e) { }
  }

  // Failure screenshots are evidence: keep the last 3 days (in logs/), delete older ones.
  cleanupScreenshots() {
    const now = Date.now();
    const ageOf = (file) => now - fs.statSync(file).mtimeMs;
    const stampOf = (file) => new Date(fs.statSync(file).mtimeMs).toISOString().replace(/[:.]/g, "-");
    // Older builds wrote fixed names to the working directory.
    for (const dir of new Set([process.cwd(), REPO_ROOT])) {
      for (const name of ["login-error.png", "tweet-failed.png"]) {
        const file = path.join(dir, name);
        try {
          if (!fs.existsSync(file)) continue;
          if (ageOf(file) > SCREENSHOT_KEEP_MS) {
            fs.unlinkSync(file);
            logger.info(`Cleaned up old screenshot: ${file}`);
          } else {
            fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
            const target = path.join(SCREENSHOT_DIR, `${path.basename(name, ".png")}-${stampOf(file)}.png`);
            fs.renameSync(file, target);
            logger.info(`Kept recent failure screenshot as ${target}`);
          }
        } catch (error) {
          logger.warn(`Failed to clean up screenshot ${file}: ${error.message}`);
        }
      }
    }
    try {
      if (!fs.existsSync(SCREENSHOT_DIR)) return;
      for (const name of fs.readdirSync(SCREENSHOT_DIR)) {
        if (!/^(?:tweet-failed|login-error|x-unavailable)-.+\.png$/.test(name)) continue;
        const file = path.join(SCREENSHOT_DIR, name);
        try {
          if (ageOf(file) > SCREENSHOT_KEEP_MS) {
            fs.unlinkSync(file);
            logger.info(`Cleaned up old screenshot: ${name}`);
          }
        } catch (error) {
          logger.warn(`Failed to clean up screenshot ${name}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.warn("Failed to cleanup screenshots:", error);
    }
  }

  async postTweet(text) {
    try {
      await this.ensureDriverConnected();
      await this.ensureTab();

      logger.info("Posting new tweet...");
      await withTimeout(this.driver.get("https://x.com/compose/tweet"), 90000, "opening the composer");
      const urlProblem = classifyXUrl(await this.currentUrl());
      if (urlProblem) throw xUnavailable(`${urlProblem} while posting`);

      const tweetTextarea = await this.driver.wait(
        until.elementLocated(By.css('div[data-testid="tweetTextarea_0"]')),
        60000
      );
      await this.driver.wait(until.elementIsVisible(tweetTextarea), 60000);
      await this.driver.wait(until.elementIsEnabled(tweetTextarea), 60000);
      // Enter right after "@CosLynxAI" can be taken by the mention autocomplete (it picks
      // a suggestion instead of starting a new line). A space closes the suggestions, and
      // a short pause lets the box go away before the newline arrives.
      const typed = typeof text === "string" ? text : String(text ?? "");
      const segments = typed.replace(/(@\w+)(?=\r?\n|$)/g, "$1 ").split(/(?<=@\w+ )(?=\r?\n|$)/);
      for (const segment of segments) {
        if (!segment) continue;
        await tweetTextarea.sendKeys(segment);
        await sleep(400);
      }
      await sleep(1600);

      await tweetTextarea.sendKeys(Key.chord(MOD_KEY, Key.ENTER));
      // Only a closed compose modal counts as posted; a dropped shortcut leaves
      // it open. (The home timeline has its own inline composer, so check the URL.)
      const posted = await this.driver
        .wait(async () => !(await this.currentUrl()).includes("/compose/"), 15000)
        .then(() => true, () => false);
      if (!posted) {
        throw new Error("Composer still open after submit; tweet was not posted.");
      }
      logger.info("Tweet posted (composer closed).");
      return true;
    } catch (error) {
      logger.error("Failed to post tweet:", error);
      await this.saveFailureScreenshot("tweet-failed");
      return false;
    }
  }
}

module.exports = TwitterService;
module.exports.isOfftopicTweet = isOfftopicTweet;
TwitterService.isOfftopicTweet = isOfftopicTweet;
// Pure helpers for tests/twitter.test.js; not part of the runtime interface.
module.exports.__test = {
  classifyTweetText,
  isOfftopicTweet,
  isSpamTweet,
  isPromoTweet,
  snowflakeTime,
  tweetAgeMs,
  isTooOld,
  pruneIds,
  loadIdStore,
  saveIdStore,
  classifyXUrl,
  isSessionError,
  PROCESSED_IDS_PATH,
  TWEET_MAX_AGE_DAYS,
  PROCESSED_ID_RETENTION_DAYS,
  MAX_PROCESSED_IDS,
};
