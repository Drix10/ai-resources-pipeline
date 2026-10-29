const { By, Key, until } = require("selenium-webdriver");
const fs = require("fs");
const path = require("path");
const { logger, sleep, REPO_ROOT } = require("../utils/helpers");
const { attachDriver, releaseDriver, adoptTab, MOD_KEY } = require("../utils/chromeLauncher");

/**
 * RedditService: the debug Chrome's logged-in Reddit session (new Reddit, the shreddit web components), in one
 * tab of its own, for redditComments.js. Reads subreddit listings and threads from the page (Reddit's .json
 * endpoints answer 403 to the browser), and posts a comment through the thread's own composer.
 *
 * Selectors, read live on 2026-10-29 (logged in):
 *  - listing and thread: <shreddit-post> attributes (id t3_..., permalink, post-title, author, created-timestamp,
 *    comment-count, score, post-type, post-language, item-state); the body is [slot="text-body"]
 *  - comments: <shreddit-comment> attributes (author, depth, score, thingid); the text is [slot="comment"]
 *  - composer: comment-composer-host > faceplate-textarea-input[data-testid="trigger-button"] (the visible one)
 *    opens it; the editor is the light-DOM Lexical div[slot="rte"][contenteditable="true"]; the buttons are
 *    #comment-composer-submit-button ("Comment") and #comment-composer-cancel-button
 * Reddit refusing (logged out, suspended, blocked, rate limited, a captcha) is REDDIT_UNAVAILABLE.
 */

const SCREENSHOT_DIR = path.join(REPO_ROOT, "logs");
const BASE = "https://www.reddit.com";
const unavailable = (why) => Object.assign(new Error(why), { code: "REDDIT_UNAVAILABLE" });
const SESSION_ERROR_RE = /invalid session|no such window|chrome not reachable|session not created|session deleted|disconnected|target window already closed|web view not found|ECONNREFUSED|ECONNRESET|socket hang up|not connected to devtools/i;
const isSessionError = (error) => SESSION_ERROR_RE.test(String(error?.message || error || ""));
// Reddit telling the account to stop: no retry today.
const REFUSAL_RE = /you(?:'|’)re doing that too much|you are doing that too much|rate ?limit|try again in \d+|take a break|too many requests|blocked by network security|whoa there|account (?:has been |is )?suspended|verify (?:that )?you(?:'|’)?re (?:a )?human/i;

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ---- Page scripts (run in the page) ----

function readListing() {
  return Array.from(document.querySelectorAll("shreddit-post")).map((p) => ({
    id: p.getAttribute("id") || "",
    permalink: p.getAttribute("permalink") || "",
    title: p.getAttribute("post-title") || "",
    author: p.getAttribute("author") || "",
    created: p.getAttribute("created-timestamp") || "",
    comments: Number(p.getAttribute("comment-count")) || 0,
    score: Number(p.getAttribute("score")) || 0,
    type: p.getAttribute("post-type") || "",
    lang: p.getAttribute("post-language") || "",
    state: p.getAttribute("item-state") || "",
    sub: p.getAttribute("subreddit-name") || "",
  })).filter((p) => /^t3_/.test(p.id) && p.permalink);
}

// The thread on its own page: the post, its first top-level comments, whether one of the comments is ours, and
// whether it can be commented on (no composer: locked, archived, or the sub does not let us).
function readThread(me) {
  const p = document.querySelector("shreddit-post");
  if (!p) return null;
  const body = p.querySelector('[slot="text-body"]');
  const all = Array.from(document.querySelectorAll("shreddit-comment"));
  const lower = String(me || "").toLowerCase();
  return {
    id: p.getAttribute("id") || "",
    title: p.getAttribute("post-title") || "",
    author: p.getAttribute("author") || "",
    created: p.getAttribute("created-timestamp") || "",
    score: Number(p.getAttribute("score")) || 0,
    comments: Number(p.getAttribute("comment-count")) || 0,
    text: body ? body.innerText.trim() : "",
    top: all.filter((c) => c.getAttribute("depth") === "0").slice(0, 12).map((c) => ({
      author: c.getAttribute("author") || "",
      score: Number(c.getAttribute("score")) || 0,
      text: ((c.querySelector('[slot="comment"]') || {}).innerText || "").trim(),
    })).filter((c) => c.text),
    ours: !!lower && all.some((c) => String(c.getAttribute("author") || "").toLowerCase() === lower),
    composer: !!document.querySelector('comment-composer-host faceplate-textarea-input[data-testid="trigger-button"]'),
  };
}

// The texts of our comments in the thread.
function ourComments(me) {
  const lower = String(me || "").toLowerCase();
  return Array.from(document.querySelectorAll("shreddit-comment"))
    .filter((c) => String(c.getAttribute("author") || "").toLowerCase() === lower)
    .map((c) => ((c.querySelector('[slot="comment"]') || {}).innerText || ""));
}

// The composer's trigger that is shown (the page carries a hidden copy outside the host).
function findTrigger() {
  return Array.from(document.querySelectorAll('comment-composer-host faceplate-textarea-input[data-testid="trigger-button"]'))
    .find((t) => { const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) || null;
}

// What Reddit says around the composer and in toasts, without our own text in the editor; and whether a
// captcha challenge is showing.
function composerState() {
  const host = document.querySelector("comment-composer-host");
  const editor = host && host.querySelector('div[slot="rte"][contenteditable="true"]');
  const hostText = host ? String(host.innerText || "").replace(editor ? editor.innerText : "", "") : "";
  const toasts = Array.from(document.querySelectorAll("faceplate-toast, shreddit-toast, [role='alert']")).map((t) => t.innerText || "").join(" ");
  const captcha = Array.from(document.querySelectorAll('iframe[src*="recaptcha"]'))
    .some((f) => /bframe|challenge/i.test(f.src + " " + (f.title || "")) && f.getBoundingClientRect().height > 50);
  return { message: `${hostText} ${toasts}`.replace(/\s+/g, " ").trim().slice(0, 400), captcha };
}

// A blocked or error page in place of Reddit.
function pageProblem() {
  if (document.querySelector("shreddit-app")) return "";
  const t = ((document.body && document.body.innerText) || "").slice(0, 3000);
  const m = t.match(/blocked by network security|whoa there|too many requests|account (?:has been )?suspended/i);
  return m ? m[0] : "no Reddit app on the page";
}

class RedditService {
  constructor() {
    this.driver = null;
    // The one tab this service owns; the user's other tabs are never touched.
    this.tabHandle = null;
    this._me = null;
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

  // The tab this service opened if it is still there; else a Reddit tab an earlier run left open; else a new one.
  async ensureTab() {
    const handles = await withTimeout(this.driver.getAllWindowHandles(), 10000, "listing tabs");
    if (this.tabHandle && handles.includes(this.tabHandle)) {
      await withTimeout(this.driver.switchTo().window(this.tabHandle), 10000, "switching to the Reddit tab");
      return;
    }
    const left = await adoptTab(this.driver, /(?:^|\.)reddit\.com$/i);
    if (left) {
      await withTimeout(this.driver.switchTo().window(left), 10000, "switching to the Reddit tab");
      this.tabHandle = left;
      return;
    }
    try {
      await withTimeout(this.driver.switchTo().newWindow("tab"), 15000, "opening the Reddit tab");
    } catch (error) {
      if (!handles.length) throw error;
      await withTimeout(this.driver.switchTo().window(handles[0]), 10000, "anchoring on a tab");
      await withTimeout(this.driver.switchTo().newWindow("tab"), 15000, "opening the Reddit tab");
    }
    this.tabHandle = await withTimeout(this.driver.getWindowHandle(), 10000, "reading the tab handle");
    logger.info("RedditService: opened a dedicated Reddit tab");
  }

  async load(url) {
    await withTimeout(this.driver.get(url), 60000, `loading ${url}`);
    await sleep(3500);
    if (/\/login\b|\/register\b/.test(await withTimeout(this.driver.getCurrentUrl(), 10000, "reading the URL"))) throw unavailable("logged out of Reddit (login page)");
    const problem = await withTimeout(this.driver.executeScript(pageProblem), 10000, "page check").catch(() => "");
    if (problem) {
      await this.saveFailureScreenshot("reddit-unavailable");
      throw unavailable(`Reddit showed "${problem}" on ${url}`);
    }
  }

  // The logged-in account, from Reddit's own /api/me.json on the page: { name, karma, ageDays }. Throws
  // REDDIT_UNAVAILABLE when nobody is logged in or the account is suspended.
  async me() {
    if (this._me) return this._me;
    // The fetch carries the session only from a Reddit page (a new tab is about:blank).
    if (!/^https:\/\/(?:www\.)?reddit\.com\//.test(await withTimeout(this.driver.getCurrentUrl(), 10000, "reading the URL"))) await this.load(`${BASE}/`);
    const raw = await withTimeout(this.driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
      fetch('/api/me.json', { credentials: 'include' }).then((r) => r.text()).then(done).catch((e) => done(''));`), 20000, "reading the Reddit account");
    let data = {};
    try { data = (JSON.parse(raw) || {}).data || {}; } catch { /* HTML: logged out */ }
    if (!data.name) throw unavailable("logged out of Reddit (no account on /api/me.json). Log in on reddit.com in the debug Chrome");
    if (data.is_suspended) throw unavailable("Reddit account suspended");
    const karma = Number(data.total_karma ?? (Number(data.link_karma) || 0) + (Number(data.comment_karma) || 0));
    const ageDays = data.created_utc ? (Date.now() / 1000 - Number(data.created_utc)) / 86400 : NaN;
    this._me = { name: String(data.name), karma: Number.isFinite(karma) ? karma : NaN, ageDays };
    return this._me;
  }

  // A subreddit's fresh threads: /new and /rising, a couple of screens each.
  async listThreads(sub) {
    const seen = new Map();
    for (const view of ["new", "rising"]) {
      await this.load(`${BASE}/r/${sub}/${view}/`);
      for (let i = 0; i < 3; i++) {
        for (const t of (await this.driver.executeScript(readListing)) || []) if (!seen.has(t.id)) seen.set(t.id, t);
        await this.driver.executeScript("window.scrollBy(0, Math.round(window.innerHeight * 0.8));");
        await sleep(1200);
      }
    }
    return [...seen.values()];
  }

  // A thread's own page (see readThread), or null when it does not render.
  async openThread(thread) {
    const url = BASE + thread.permalink;
    await this.load(url);
    const me = (await this.me()).name;
    for (const deadline = Date.now() + 10000; Date.now() < deadline; await sleep(800)) {
      const t = await this.driver.executeScript(readThread, me);
      if (t && t.id === thread.id) {
        await sleep(1500); // comments land a moment after the post
        return { ...(await this.driver.executeScript(readThread, me)), url };
      }
    }
    return null;
  }

  // Comments on the thread open in the tab (openThread first). { status: "posted" } once our comment shows in the
  // thread; "uncertain" when it was sent but not seen (never retried: it may be live); "failed" when nothing was
  // sent, with a reason ("no-composer": the thread takes no comments) and unavailable: true when Reddit refused
  // the account (rate limit, captcha), which pauses the pass.
  async postComment(thread, text) {
    let submitted = false;
    // ChromeDriver cannot type characters outside the BMP; one paragraph per Enter.
    const paragraphs = String(text || "").replace(/[\u{10000}-\u{10FFFF}]/gu, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
    const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
    const editorSel = By.css('comment-composer-host div[slot="rte"][contenteditable="true"]');
    try {
      const trigger = await this.driver.executeScript(findTrigger);
      if (!trigger) return { status: "failed", reason: "no-composer" };
      await this.driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", trigger);
      await sleep(600);
      await trigger.click();
      const editor = await this.driver.wait(until.elementLocated(editorSel), 10000).catch(() => null);
      if (!editor) return { status: "failed", reason: "no-composer" };
      await this.driver.wait(until.elementIsVisible(editor), 10000);
      await this.driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", editor);
      await editor.click();
      for (const [i, p] of paragraphs.entries()) {
        if (i) await editor.sendKeys(Key.ENTER);
        await editor.sendKeys(p);
      }
      await sleep(1200);
      if (norm(await editor.getText()) !== norm(paragraphs.join(" "))) throw new Error("the comment box does not hold the comment's text");
      const send = await this.driver.findElement(By.css("#comment-composer-submit-button"));
      await this.driver.wait(async () => (await send.isEnabled()) && (await send.getAttribute("aria-disabled")) !== "true", 10000)
        .catch(() => { throw new Error("the Comment button stayed disabled"); });
      await this.driver.executeScript("arguments[0].scrollIntoView({ block: 'center' });", send);
      submitted = true;
      await send.click();
      const me = (await this.me()).name;
      const head = norm(paragraphs[0]).slice(0, 40);
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await sleep(1000)) {
        // Our comment lands in the tree with our name on it.
        const mine = await this.driver.executeScript(ourComments, me);
        if ((mine || []).some((m) => norm(m).startsWith(head))) return { status: "posted" };
        const state = await this.driver.executeScript(composerState);
        if (state.captcha) return { status: "failed", reason: "Reddit asked for a captcha", unavailable: true };
        const refused = state.message.match(REFUSAL_RE);
        if (refused) return { status: "failed", reason: `Reddit refused the comment: "${state.message.slice(0, 160)}"`, unavailable: true };
      }
      await this.saveFailureScreenshot("reddit-comment-unconfirmed");
      return { status: "uncertain", reason: "sent, but not seen in the thread yet" };
    } catch (error) {
      if (!submitted && (error.code === "REDDIT_UNAVAILABLE" || isSessionError(error))) throw error;
      await this.saveFailureScreenshot("reddit-comment-failed");
      // Unsent text left in the composer makes the next page load ask "leave site?", and the dismissed prompt keeps
      // the tab here: every later load fails. Cleared and cancelled (never sent: the submit is not clicked).
      if (!submitted) {
        await withTimeout((async () => {
          for (const ed of await this.driver.findElements(editorSel)) await ed.sendKeys(Key.chord(MOD_KEY, "a"), Key.BACK_SPACE);
          await this.driver.executeScript("const c = document.querySelector('#comment-composer-cancel-button'); if (c) c.click();");
        })(), 10000, "clearing the comment box").catch(() => {});
      }
      if (submitted) {
        logger.error(`Reddit comment sent; Reddit did not confirm it (${error.message}). It may be live: check ${thread.url || thread.permalink}.`);
        return { status: "uncertain", reason: error.message };
      }
      logger.error(`Reddit comment not sent: ${error.message}`);
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
          await withTimeout(this.driver.switchTo().window(this.tabHandle), 5000, "switching to the Reddit tab");
          await withTimeout(this.driver.close(), 5000, "closing the Reddit tab");
        }
      }
    } catch (e) {
      logger.warn(`RedditService: could not close the Reddit tab: ${e.message}`);
    } finally {
      if (this.driver) await releaseDriver(this.driver);
      this.driver = null;
      this._me = null;
      if (closeTab) this.tabHandle = null;
    }
  }
}

module.exports = RedditService;
module.exports.__test = { readListing, readThread, REFUSAL_RE };
