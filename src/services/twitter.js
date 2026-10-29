const { By, Key, until } = require("selenium-webdriver");
require("../../config"); // loads .env before the settings below are read
const { logger, sleep } = require("../utils/helpers");
const { attachDriver, releaseDriver, adoptTab, waitForXLogin, MOD_KEY } = require("../utils/chromeLauncher");
const fs = require("fs");
const path = require("path");

// Anchored to the repo, not process.cwd(): a start from another directory must not
// begin with an empty store and republish everything. Tests set PROCESSED_IDS_PATH.
const REPO_ROOT = path.resolve(__dirname, "../..");
const PROCESSED_IDS_PATH = path.join(REPO_ROOT, ".processed-tweet-ids.json");
const SCREENSHOT_DIR = path.join(REPO_ROOT, "logs");
const SCREENSHOT_KEEP_MS = 3 * 24 * 60 * 60 * 1000;

const envDays = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const DAY_MS = 24 * 60 * 60 * 1000;
// Text without characters outside the BMP (emoji), with the spaces they leave collapsed within each line.
const stripNonBmp = (s) => String(s ?? "").replace(/[\u{10000}-\u{10FFFF}]️?/gu, "").replace(/[ \t]{2,}/g, " ");
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

// Readers' interest in a post per hour on X: likes, reposts at double (a repost carries it to new readers)
// and views at 1/100 (most readers never tap anything). A post under an hour old counts one hour.
function engagementPerHour({ tweetId, timestamp, likes = 0, reposts = 0, views = 0 }, now = Date.now()) {
  const age = tweetAgeMs(tweetId, timestamp, now);
  const hours = Math.max(1, Number.isFinite(age) ? age / 3600000 : 1);
  return (likes + 2 * reposts + views / 100) / hours;
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

// Synchronous backoff: markContentAsPublished is sync and must finish before the run goes on.
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

// Runs in the page: every post on screen, with its own text, the text it quotes, its links and
// whether it is cut short, promoted or a reply.
function readPosts() {
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
      // Without a quote card, the first text block is the post's own; later ones are quoted.
      const ownNodes = mainNodes.length ? mainNodes.slice(0, 1) : [];
      const quotedNodes = mainNodes.length ? quoteNodes.concat(mainNodes.slice(1)) : quoteNodes;
      const mainText = ownNodes.map((n) => (n.innerText || "").trim()).join("\n").trim();
      // The language X tagged the post's own text with ("en", "und" for too little text to tell).
      const lang = ownNodes.length ? ownNodes[0].getAttribute("lang") || "" : "";
      const quotedText = quotedNodes.map((n) => (n.innerText || "").trim()).filter(Boolean).join("\n\n");
      let text = mainText;
      if (quotedText) text += "\n\nQuoted Tweet:\n" + quotedText;

      // "Show more" means the visible text is cut; an article from half a post is not safe.
      const showMore = Array.from(el.querySelectorAll('[data-testid="tweet-text-show-more-link"]'));
      const truncated = showMore.some((n) => !inQuote(n));

      // Promoted posts: a bare "Ad"/"Promoted" label outside the text. Not placementTracking:
      // X wraps every organic video player in it, so it would drop all video demos.
      const isAd = Array.from(el.querySelectorAll("span")).some((s) => !s.closest('[data-testid="tweetText"]') && /^(Ad|Promoted)$/.test((s.textContent || "").trim()));

      // The author's handle, from the first profile link in its name block (not the quoted post's).
      const nameBlock = Array.from(el.querySelectorAll('[data-testid="User-Name"]')).find((n) => !inQuote(n));
      const profileA = nameBlock && Array.from(nameBlock.querySelectorAll("a[href]")).find((a) => /^https?:\/\/(?:x|twitter)\.com\/\w{1,15}\/?$/.test(a.href));
      const handle = profileA ? profileA.href.replace(/\/$/, "").split("/").pop() : "";

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

      // What readers did with it, from the action bar's label ("12 replies, 34 reposts, 567 likes, 8 bookmarks,
      // 12345 views"); a count X does not show is 0.
      const bar = Array.from(el.querySelectorAll('[role="group"][aria-label]')).find((n) => !inQuote(n));
      const counts = {};
      for (const m of ((bar && bar.getAttribute("aria-label")) || "").matchAll(/([\d,]+)\s+(repl(?:y|ies)|reposts?|likes?|views?)\b/gi)) {
        counts[m[2].toLowerCase().slice(0, 4)] = Number(m[1].replace(/,/g, ""));
      }

      list.push({ tweetId, url, timestamp, text, mainText, lang, handle, links, images, truncated, isAd, isReply, likes: counts.like || 0, reposts: counts.repo || 0, replies: counts.repl || 0, views: counts.view || 0 });
    } catch (e) {}
  }
  return list;
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
    this.storePath = options.storePath || process.env.PROCESSED_IDS_PATH || PROCESSED_IDS_PATH;
    this.storeError = null;
    // True while IDs marked in memory are not on disk (a failed save).
    this.idsUnsaved = false;
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
      this.idsUnsaved = true;
      return false;
    }
    try {
      // Merge what another instance may have written since this run loaded the store.
      const onDisk = loadIdStore(this.storePath);
      if (!onDisk.error) for (const id of onDisk.ids) this.processedTweetIds.add(id);
      this.processedTweetIds = pruneIds(this.processedTweetIds);
      saveIdStore(this.storePath, this.processedTweetIds);
      this.idsUnsaved = false;
      return true;
    } catch (error) {
      logger.error(`Could not persist published X IDs: ${error.message}`);
      this.idsUnsaved = true;
      return false;
    }
  }

  // True once the IDs are on disk. False when the store could not be written: the caller stops
  // curating for the run and retries persistProcessedIds before it ends.
  markContentAsPublished(collections) {
    let changed = false;
    for (const collection of collections || []) {
      for (const tweet of collection?.tweets || []) {
        // The ID findContent stored, else the one in the post's URL.
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
    if (changed || this.idsUnsaved) return this.persistProcessedIds();
    return true;
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
    // An X tab an earlier run left open is reused (its extras closed): one tab, reloaded per page.
    const left = await adoptTab(this.driver, /(?:^|\.)(?:x|twitter)\.com$/i);
    if (left) {
      await withTimeout(this.driver.switchTo().window(left), 10000, "switching to the X tab");
      this.tabHandle = left;
      logger.info("TwitterService: reusing the X tab already open");
      return;
    }
    // Its own window: the sites run side by side, and a background tab stops rendering (lazy feeds stall).
    try {
      await withTimeout(this.driver.switchTo().newWindow("window"), 15000, "opening the X tab");
    } catch (error) {
      // New Window fails when the session's current tab was closed; anchor on any tab first.
      if (!handles.length) throw error;
      await withTimeout(this.driver.switchTo().window(handles[0]), 10000, "anchoring on a tab");
      await withTimeout(this.driver.switchTo().newWindow("window"), 15000, "opening the X tab");
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

  // The posts worth an article on the open list (newest first): never one published or reserved this run,
  // an ad, a reply, a stale or a still-truncated post, an off-topic or thin one. Of those, the
  // THREADS_NEEDED that readers engage with most per hour.
  async findContent(folderName = "") {
    try {
      // The writer skips roughly half of what it is given (opinion, PR, thin posts),
      // so collect a deeper pool; generation keeps at most 8 articles per file.
      const THREADS_NEEDED = 16;
      // How many list posts are read before the best are picked.
      const LIST_MAX_POSTS = 40;
      const MAX_SCROLL_ATTEMPTS = 24;
      const SCROLL_PAUSE = 700;
      const INITIAL_LOAD_TIMEOUT = 10000;
      const MIN_TOTAL_WORDS = 30;
      const MIN_WORDS_WITH_EXTERNAL_LINK = 15;
      // Each long post costs a page load.
      const MAX_LONG_POSTS = 6;
      // Lists run newest first: a long run of stale posts means nothing fresh is left.
      const MAX_OLD_STREAK = 15;

      const eligible = [];
      let scrollAttempts = 0;
      const seenTweetIds = new Set();
      let sameContentCount = 0;
      let oldStreak = 0;
      const skipped = {};
      const skip = (reason, tweetId) => {
        skipped[reason] = (skipped[reason] || 0) + 1;
        logger.debug(`Skipping tweet ${tweetId}: ${reason}`);
      };
      // Long posts show only their opening on the list ("Show more"); they are read in full later.
      const longPosts = [];
      const consider = (post) => {
        const { tweetId, url, timestamp, text, mainText, links, images, likes = 0, reposts = 0, views = 0 } = post;
        if (!mainText) return skip("no text of its own", tweetId);
        const reason = classifyTweetText(text, folderName);
        if (reason) return skip(reason, tweetId);

        const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
        const hasExternalLink = (links || []).some(l => /^https?:\/\//i.test(l) && !/^(https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//i.test(l));
        const hasEnoughDetail = wordCount >= MIN_TOTAL_WORDS || (hasExternalLink && wordCount >= MIN_WORDS_WITH_EXTERNAL_LINK);
        if (!hasEnoughDetail) return skip(`thin (${wordCount} words)`, tweetId);

        eligible.push({ score: engagementPerHour(post), item: { tweets: [{ tweetId, text, links, images, url, timestamp, likes, reposts, views }], url, timestamp } });
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

      while (scrollAttempts < MAX_SCROLL_ATTEMPTS && seenTweetIds.size < LIST_MAX_POSTS) {
        let batch = [];
        try {
          batch = await this.driver.executeScript(readPosts);
        } catch (scriptErr) {
          // A dead session must reach the retry loop (it reattaches); a script error just skips the step.
          if (isSessionError(scriptErr)) throw scriptErr;
          logger.warn("Batch DOM extraction failed:", scriptErr.message);
        }

        let newInScroll = 0;

        for (const item of batch || []) {
          if (seenTweetIds.size >= LIST_MAX_POSTS) break;
          const { tweetId, timestamp, truncated, isAd, isReply } = item;
          if (!tweetId || seenTweetIds.has(tweetId)) continue;
          seenTweetIds.add(tweetId);
          newInScroll++;

          // Published before, or already taken by another folder this run.
          if (this.isKnownId(tweetId)) { skip("already published or reserved this run", tweetId); continue; }
          if (isAd) { skip("promoted post", tweetId); continue; }
          if (isReply) { skip("reply", tweetId); continue; }

          if (isTooOld(tweetId, timestamp)) {
            skip(`older than ${TWEET_MAX_AGE_DAYS} days`, tweetId);
            if (++oldStreak >= MAX_OLD_STREAK) break;
            continue;
          }
          oldStreak = 0;

          if (truncated) { longPosts.push(item); continue; }
          consider(item);
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

      // A post's own page shows all of it; the list is reopened for the next folder. The busiest are read first.
      longPosts.sort((a, b) => engagementPerHour(b) - engagementPerHour(a));
      for (const [i, post] of longPosts.entries()) {
        if (i >= MAX_LONG_POSTS) { skip("truncated (Show more)", post.tweetId); continue; }
        try {
          await this.checkRateLimit();
          await withTimeout(this.driver.get(post.url), 30000, `loading ${post.url}`);
          // get can return while the list is still on screen, where the post is still cut: wait for its own
          // page, then for the post to render on it.
          await this.driver.wait(until.urlContains(`/status/${post.tweetId}`), INITIAL_LOAD_TIMEOUT);
          const findPost = async () => ((await this.driver.executeScript(readPosts)) || []).find((p) => p.tweetId === post.tweetId);
          let full = await findPost();
          for (const deadline = Date.now() + INITIAL_LOAD_TIMEOUT; !full && Date.now() < deadline; full = await findPost()) await sleep(SCROLL_PAUSE);
          if (!full || full.truncated) { skip("truncated (Show more)", post.tweetId); continue; }
          consider({ likes: post.likes, reposts: post.reposts, views: post.views, ...full, url: post.url, timestamp: full.timestamp || post.timestamp });
        } catch (error) {
          if (isSessionError(error)) throw error;
          skip("long post unreadable", post.tweetId);
        }
      }

      const collectedContent = eligible.sort((a, b) => b.score - a.score).slice(0, THREADS_NEEDED).map((e) => e.item);
      // Reserved once picked: overlapping lists in later folders skip them.
      for (const c of collectedContent) this.reservedIds.add(c.tweets[0].tweetId);
      const skipSummary = Object.entries(skipped).map(([k, v]) => `${k}: ${v}`).join(", ");
      logger.info(`Collected ${collectedContent.length} valid high-signal content pieces${skipSummary ? ` (skipped ${skipSummary})` : ""}`);
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
    try {
      if (!fs.existsSync(SCREENSHOT_DIR)) return;
      for (const name of fs.readdirSync(SCREENSHOT_DIR)) {
        if (!/^(?:x-reply-failed|login-error|x-unavailable)-.+\.png$/.test(name)) continue;
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

  // ---- Replies under other people's posts (xReplies.js) ----

  // Our own handle, from the side bar's profile link (on any loaded X page), kept once read.
  async ownHandle() {
    if (this._ownHandle) return this._ownHandle;
    const href = await withTimeout(this.driver.executeScript(
      "const a = document.querySelector('a[data-testid=\"AppTabBar_Profile_Link\"]'); return a ? a.href : '';"), 10000, "reading our handle").catch(() => "");
    this._ownHandle = String(href || "").replace(/\/$/, "").split("/").pop() || "";
    return this._ownHandle;
  }

  // The posts on one timeline (the home page's "For you" or "Following" tab, or a list) as readPosts reads them,
  // over a few screens of scrolling. Read-only: a tab is chosen by clicking it, nothing else is touched.
  async scanTimeline({ url, tab = "" }, maxScrolls = 8) {
    await this.checkRateLimit();
    await withTimeout(this.driver.get(url), 60000, `loading ${url}`);
    const urlProblem = classifyXUrl(await this.currentUrl());
    if (urlProblem) throw xUnavailable(`${urlProblem} while opening ${url}`);
    if (tab) {
      await this.driver.wait(async () => this.driver.executeScript(selectTimelineTab, tab), 15000)
        .catch(() => { throw new Error(`no "${tab}" tab on ${url}`); });
      await sleep(2500);
    }
    const articles = By.css('article[data-testid="tweet"]');
    await this.driver.wait(until.elementLocated(articles), 15000).catch(async () => {
      await this.assertXUsable(`reading ${tab || url}`);
      await this.driver.wait(until.elementLocated(articles), 15000);
    });
    const seen = new Map();
    for (let i = 0; i <= maxScrolls; i++) {
      for (const p of (await this.driver.executeScript(readPosts)) || []) if (!seen.has(p.tweetId)) seen.set(p.tweetId, p);
      await this.driver.executeScript("window.scrollBy(0, Math.round(window.innerHeight * 0.8));");
      await sleep(700);
    }
    return [...seen.values()];
  }

  // A post's own page: the post in full, the replies X shows under it, and whether one of them is ours (X lists
  // the viewer's own reply near the top). null when the post does not render.
  async openPost(post) {
    await this.checkRateLimit();
    await withTimeout(this.driver.get(post.url), 60000, `loading ${post.url}`);
    const urlProblem = classifyXUrl(await this.currentUrl());
    if (urlProblem) throw xUnavailable(`${urlProblem} while opening ${post.url}`);
    const read = async () => (await this.driver.executeScript(readPosts)) || [];
    let posts = [];
    for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(700)) {
      posts = await read();
      if (posts.some((p) => p.tweetId === post.tweetId)) break;
    }
    if (!posts.some((p) => p.tweetId === post.tweetId)) return null;
    // The replies load a moment after the post.
    await sleep(2000);
    posts = await read();
    const at = posts.findIndex((p) => p.tweetId === post.tweetId);
    if (at < 0) return null;
    // Above the post: the thread it answers; below it: the replies.
    const replies = posts.slice(at + 1).filter((p) => p.mainText).slice(0, 12);
    const own = await this.ownHandle();
    return { post: posts[at], replies, ours: replies.some((r) => sameHandle(r.handle, own)) };
  }

  // Replies to a post from its own page (open it with openPost first): its reply button opens the reply dialog,
  // the text is typed and checked, then sent. { status: "posted" } once our reply shows under the post;
  // "uncertain" when it was sent but not confirmed (never retried: it may be live); "failed" when nothing was
  // sent, with a reason ("no-composer": the dialog did not open, as on a post whose replies are limited).
  async replyToPost(post, text) {
    let submitted = false;
    // One line: an Enter is a new line in X's box, and ChromeDriver cannot type emoji.
    const typed = stripNonBmp(text).replace(/\s+/g, " ").trim();
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const dialogBox = By.css('[role="dialog"] [data-testid="tweetTextarea_0"]');
    try {
      const article = await this.driver.executeScript(findPostArticle, post.tweetId);
      if (!article) return { status: "failed", reason: "post not on the page" };
      const replyButton = await article.findElement(By.css('[data-testid="reply"]'));
      await this.driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", replyButton);
      await replyButton.click();
      const box = await this.driver.wait(until.elementLocated(dialogBox), 10000).catch(() => null);
      if (!box) return { status: "failed", reason: "no-composer" };
      await this.driver.wait(until.elementIsVisible(box), 10000);
      await box.sendKeys(typed);
      await sleep(1200);
      if (norm(await box.getText()) !== norm(typed)) throw new Error("the reply box does not hold the reply's text");
      const send = await this.driver.findElement(By.css('[role="dialog"] [data-testid="tweetButton"]'));
      await this.driver.wait(async () => (await send.getAttribute("aria-disabled")) !== "true", 10000)
        .catch(() => { throw new Error("the Reply button stayed disabled"); });
      submitted = true;
      await send.click();
      const closed = await this.driver.wait(async () => (await this.driver.findElements(dialogBox)).length === 0, 15000).then(() => true, () => false);
      if (!closed) throw new Error("the reply dialog is still open after sending");
      const own = await this.ownHandle();
      const head = typed.slice(0, 40);
      for (const deadline = Date.now() + 12000; Date.now() < deadline; await sleep(1000)) {
        const posts = (await this.driver.executeScript(readPosts)) || [];
        if (posts.some((p) => p.tweetId !== post.tweetId && sameHandle(p.handle, own) && norm(p.mainText).startsWith(head))) return { status: "posted" };
      }
      return { status: "uncertain", reason: "sent, but not seen under the post yet" };
    } catch (error) {
      // Logged out or a lost browser before the send: the caller's pass ends on it.
      if (!submitted && (error.code === "X_UNAVAILABLE" || isSessionError(error))) throw error;
      await this.saveFailureScreenshot("x-reply-failed");
      // Unsent text left in the dialog makes X ask "leave site?" on the next page load, and the dismissed prompt
      // keeps the tab here: every later load fails. Cleared and closed (never sent: no button is clicked).
      if (!submitted) {
        await withTimeout((async () => {
          for (const box of await this.driver.findElements(dialogBox)) await box.sendKeys(Key.chord(MOD_KEY, "a"), Key.BACK_SPACE);
          await this.driver.actions().sendKeys(Key.ESCAPE).perform();
        })(), 10000, "clearing the reply dialog").catch(() => { });
      }
      if (submitted) {
        logger.error(`X reply sent; X did not confirm it (${error.message}). It may be live: check the post.`);
        return { status: "uncertain", reason: error.message };
      }
      logger.error(`X reply not sent: ${error.message}`);
      return { status: "failed", reason: error.message };
    }
  }
}

const sameHandle = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// Runs in the page: selects the home timeline's tab by its label ("For you", "Following"); true once it is shown.
function selectTimelineTab(label) {
  const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((t) => (t.textContent || "").trim() === label);
  if (!tab) return false;
  if (tab.getAttribute("aria-selected") !== "true") tab.click();
  return true;
}

// Runs in the page: the article of one post (by the permalink around its first <time>, as readPosts reads it).
function findPostArticle(id) {
  return Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find((a) => {
    const time = a.querySelector("time");
    const link = time && time.closest('a[href*="/status/"]');
    return !!link && new RegExp("/status/" + id + "(?:$|[/?#])").test(link.href);
  }) || null;
}

module.exports = TwitterService;
TwitterService.isOfftopicTweet = isOfftopicTweet;
// What xReplies.js scores timeline posts with.
TwitterService.classifyTweetText = classifyTweetText;
TwitterService.engagementPerHour = engagementPerHour;
TwitterService.tweetAgeMs = tweetAgeMs;
TwitterService.sameHandle = sameHandle;
// Pure helpers for tests/twitter.test.js; not part of the runtime interface.
module.exports.__test = {
  classifyTweetText,
  isOfftopicTweet,
  snowflakeTime,
  isTooOld,
  pruneIds,
  loadIdStore,
  saveIdStore,
  classifyXUrl,
  engagementPerHour,
  readPosts,
  PROCESSED_IDS_PATH,
};
