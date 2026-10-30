const { By } = require("selenium-webdriver");
const fs = require("fs");
const path = require("path");
const { logger, sleep, REPO_ROOT } = require("../utils/helpers");
const { attachDriver, releaseDriver, adoptTab } = require("../utils/chromeLauncher");

/**
 * HnService: Hacker News for hnComments.js. Reads the front page and threads from HN's public Algolia API (no
 * browser, no account), and posts a comment through the debug Chrome's logged-in HN session, in one window of
 * its own.
 *
 * The item page (read 2026-10-30): logged in, the top bar has a#me (the account name); the story's comment form is
 * form[action="comment"] with textarea[name="text"] and an input[type="submit"]; each comment is a
 * tr.athing.comtr with a.hnuser and .commtext. A refusal ("posting too fast", a ban, a login page) is HN_UNAVAILABLE.
 */

const SCREENSHOT_DIR = path.join(REPO_ROOT, "logs");
const BASE = "https://news.ycombinator.com";
const API = "https://hn.algolia.com/api/v1";
const unavailable = (why) => Object.assign(new Error(why), { code: "HN_UNAVAILABLE" });
const SESSION_ERROR_RE = /invalid session|no such window|chrome not reachable|session not created|session deleted|disconnected|target window already closed|web view not found|ECONNREFUSED|ECONNRESET|socket hang up|not connected to devtools/i;
const isSessionError = (error) => SESSION_ERROR_RE.test(String(error?.message || error || ""));
// HN telling the account to stop: no retry today.
const REFUSAL_RE = /posting too fast|slow down|you're submitting too fast|banned|rate limit|too many requests|sorry, we're not able to serve your requests/i;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// HN's HTML comment text to plain text, one blank line between paragraphs.
const plain = (html) => String(html || "")
  .replace(/<p>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
  .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&#x2F;/g, "/").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
  .trim();

async function getJson(url) {
  const res = await withTimeout(fetch(url, { headers: { Accept: "application/json" } }), 20000, `fetching ${url}`);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// The front page plus stories rising toward it (30+ points in the last 10 h), from HN's search API:
// [{ id, title, url, author, points, comments, created, text }].
async function frontPage() {
  const since = Math.floor(Date.now() / 1000) - 10 * 3600;
  const pages = await Promise.all([
    getJson(`${API}/search?tags=front_page&hitsPerPage=60`),
    getJson(`${API}/search_by_date?tags=story&numericFilters=points>30,created_at_i>${since}&hitsPerPage=100`),
  ]);
  const seen = new Set();
  return pages.flatMap((d) => d.hits || []).filter((h) => !seen.has(h.objectID) && seen.add(h.objectID)).map((h) => ({
    id: String(h.objectID || ""),
    title: h.title || "",
    url: h.url || "",
    author: h.author || "",
    points: Number(h.points) || 0,
    comments: Number(h.num_comments) || 0,
    created: h.created_at_i ? new Date(h.created_at_i * 1000).toISOString() : "",
    text: plain(h.story_text),
  })).filter((s) => s.id && s.title);
}

// A thread: the story, its first top-level comments, whether `me` commented anywhere in it, and whether it still
// takes comments (dead, deleted or past HN's two-week limit: no).
async function readThread(id, me = "") {
  const t = await getJson(`${API}/items/${encodeURIComponent(id)}`);
  const lower = String(me).toLowerCase();
  const ours = (kids) => (kids || []).some((c) => (lower && String(c.author || "").toLowerCase() === lower) || ours(c.children));
  const created = t.created_at_i ? new Date(t.created_at_i * 1000).toISOString() : "";
  return {
    id: String(t.id),
    title: t.title || "",
    url: t.url || "",
    author: t.author || "",
    points: Number(t.points) || 0,
    created,
    text: plain(t.text),
    top: (t.children || []).filter((c) => c.author && c.text).slice(0, 12).map((c) => ({ author: c.author, text: plain(c.text).slice(0, 800) })),
    ours: ours(t.children),
    open: t.type === "story" && !!created && Date.now() - Date.parse(created) < 13 * 24 * 3600 * 1000,
  };
}

// ---- Page scripts (run in the page) ----

function pageState() {
  const me = document.querySelector("a#me");
  const body = ((document.body && document.body.innerText) || "").slice(0, 2000);
  return {
    me: me ? me.innerText.trim() : "",
    form: !!document.querySelector('form[action="comment"] textarea[name="text"]'),
    body,
  };
}

// The texts of `me`'s comments on the page.
function ourComments(me) {
  const lower = String(me || "").toLowerCase();
  return Array.from(document.querySelectorAll("tr.athing.comtr"))
    .filter((c) => { const u = c.querySelector("a.hnuser"); return u && u.innerText.trim().toLowerCase() === lower; })
    .map((c) => ((c.querySelector(".commtext") || {}).innerText || ""));
}

class HnService {
  constructor() {
    this.driver = null;
    this.tabHandle = null;
    this._me = "";
  }

  async isDriverHealthy() {
    if (!this.driver) return false;
    try {
      await withTimeout(this.driver.getAllWindowHandles(), 10000, "WebDriver health probe");
      return true;
    } catch { return false; }
  }

  async ensureDriverConnected() {
    if (this.driver && (await this.isDriverHealthy())) return this.ensureTab();
    if (this.driver) await this.cleanup({ closeTab: false });
    this.driver = await attachDriver();
    try { await this.driver.manage().setTimeouts({ pageLoad: 60000, script: 30000 }); } catch { /* defaults */ }
    await this.ensureTab();
  }

  // The window this service opened if it is still there; else an HN tab an earlier run left open; else a new one.
  async ensureTab() {
    const handles = await withTimeout(this.driver.getAllWindowHandles(), 10000, "listing tabs");
    if (this.tabHandle && handles.includes(this.tabHandle)) {
      await withTimeout(this.driver.switchTo().window(this.tabHandle), 10000, "switching to the HN tab");
      return;
    }
    const left = await adoptTab(this.driver, /(?:^|\.)news\.ycombinator\.com$/i);
    if (left) {
      await withTimeout(this.driver.switchTo().window(left), 10000, "switching to the HN tab");
      this.tabHandle = left;
      return;
    }
    try {
      await withTimeout(this.driver.switchTo().newWindow("window"), 15000, "opening the HN tab");
    } catch (error) {
      if (!handles.length) throw error;
      await withTimeout(this.driver.switchTo().window(handles[0]), 10000, "anchoring on a tab");
      await withTimeout(this.driver.switchTo().newWindow("window"), 15000, "opening the HN tab");
    }
    this.tabHandle = await withTimeout(this.driver.getWindowHandle(), 10000, "reading the tab handle");
    logger.info("HnService: opened a dedicated HN tab");
  }

  async load(url) {
    await withTimeout(this.driver.get(url), 60000, `loading ${url}`);
    await sleep(2000);
    const s = await withTimeout(this.driver.executeScript(pageState), 10000, "page check");
    const refused = s.body.match(REFUSAL_RE);
    if (refused) {
      await this.saveFailureScreenshot("hn-unavailable");
      throw unavailable(`HN showed "${refused[0]}" on ${url}`);
    }
    if (!s.me) throw unavailable("logged out of Hacker News. Log in on news.ycombinator.com in the debug Chrome");
    this._me = s.me;
    return s;
  }

  // The logged-in account name, from HN's own top bar.
  async me() {
    if (!this._me) await this.load(`${BASE}/news`);
    return this._me;
  }

  // Comments on the story. { status: "posted" } once our comment shows on the page; "uncertain" when it was sent
  // but not seen (never retried); "failed" when nothing was sent ("no-form": the thread takes no comments), with
  // unavailable: true when HN refused the account.
  async postComment(story, text) {
    let submitted = false;
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    // ChromeDriver cannot type characters outside the BMP; HN wants a blank line between paragraphs.
    const body = String(text || "").replace(/[\u{10000}-\u{10FFFF}]/gu, "").split(/\n\s*\n/).map(norm).filter(Boolean).join("\n\n");
    try {
      const s = await this.load(`${BASE}/item?id=${encodeURIComponent(story.id)}`);
      if (!s.form) return { status: "failed", reason: "no-form" };
      const box = await this.driver.findElement(By.css('form[action="comment"] textarea[name="text"]'));
      await this.driver.executeScript("arguments[0].scrollIntoView({ block: 'center' }); arguments[0].focus();", box);
      await box.sendKeys(body);
      await sleep(800);
      if (norm(await box.getAttribute("value")) !== norm(body)) throw new Error("the comment box does not hold the comment's text");
      const send = await this.driver.findElement(By.css('form[action="comment"] input[type="submit"]'));
      submitted = true;
      await send.click();
      const head = norm(body).slice(0, 40);
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await sleep(1500)) {
        const st = await this.driver.executeScript(pageState).catch(() => null);
        if (!st) continue;
        const refused = st.body.match(REFUSAL_RE);
        if (refused) return { status: "failed", reason: `HN refused the comment: "${refused[0]}"`, unavailable: true };
        if (((await this.driver.executeScript(ourComments, this._me)) || []).some((m) => norm(m).startsWith(head))) return { status: "posted" };
      }
      await this.saveFailureScreenshot("hn-comment-unconfirmed");
      return { status: "uncertain", reason: "sent, but not seen on the page yet" };
    } catch (error) {
      if (!submitted && (error.code === "HN_UNAVAILABLE" || isSessionError(error))) throw error;
      await this.saveFailureScreenshot("hn-comment-failed");
      if (submitted) {
        logger.error(`HN comment sent; HN did not confirm it (${error.message}). It may be live: check ${BASE}/item?id=${story.id}.`);
        return { status: "uncertain", reason: error.message };
      }
      logger.error(`HN comment not sent: ${error.message}`);
      return { status: "failed", reason: error.message };
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
    } catch { /* evidence only */ }
  }

  // Closes our tab (unless closeTab is false, for a reattach) and stops chromedriver; Chrome stays as it was.
  async cleanup({ closeTab = true } = {}) {
    try {
      if (this.driver && closeTab && this.tabHandle) {
        const handles = await withTimeout(this.driver.getAllWindowHandles(), 5000, "listing tabs").catch(() => []);
        // Closing the last tab would close the user's browser window.
        if (handles.includes(this.tabHandle) && handles.length > 1) {
          await withTimeout(this.driver.switchTo().window(this.tabHandle), 5000, "switching to the HN tab");
          await withTimeout(this.driver.close(), 5000, "closing the HN tab");
        }
      }
    } catch (e) {
      logger.warn(`HnService: could not close the HN tab: ${e.message}`);
    } finally {
      if (this.driver) await releaseDriver(this.driver);
      this.driver = null;
      this._me = "";
      if (closeTab) this.tabHandle = null;
    }
  }
}

module.exports = HnService;
module.exports.frontPage = frontPage;
module.exports.readThread = readThread;
module.exports.__test = { plain, REFUSAL_RE };
