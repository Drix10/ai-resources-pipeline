/**
 * Instagram publisher over the logged-in Chrome on :9222 (same browser the X and LinkedIn
 * services attach to). Uses instagram.com's own "Create" flow: upload -> crop -> next ->
 * caption -> Share.
 *
 * Safety:
 *  - Nothing is shared unless IG_POST=true. A dry run walks the whole flow, types the caption,
 *    screenshots the final step, then discards the draft.
 *  - Daily cap (IG_DAILY_CAP) and minimum spacing (IG_MIN_GAP_MINUTES) come from the ledger.
 *  - Never fatal to the pipeline: every failure leaves a screenshot in factory/state/ig-debug/.
 *
 * The web UI changes; selectors are text/aria based and collected in SEL so a break is a
 * one-line fix. Run `node factory-run.js --publish --dry` after any Instagram redesign.
 */
const fs = require("fs");
const path = require("path");
const { By, until } = require("selenium-webdriver");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");
const { attachDriver, releaseDriver } = require("../utils/chromeLauncher");
const queue = require("./queue");

const DEBUG_DIR = path.join(queue.STATE_DIR, "ig-debug");

const SEL = {
  home: 'svg[aria-label="Home"]',
  create: ['svg[aria-label="New post"]', 'svg[aria-label="Create"]'],
  createMenuPost: ["Post"],
  fileInput: 'div[role="dialog"] input[type="file"], form input[type="file"][accept*="image"]',
  reelsNoticeOk: ["OK"],
  cropButton: ['svg[aria-label="Select crop"]', 'svg[aria-label="Select Crop"]'],
  cropOption: { reel: ["Original", "9:16"], carousel: ["4:5"] },
  next: ["Next"],
  caption: 'div[role="dialog"] div[contenteditable="true"][role="textbox"], div[aria-label^="Write a caption"]',
  share: ["Share"],
  shared: /(post|reel) (has been )?shared|your (post|reel) has been shared/i,
  discard: ["Discard"],
};

class InstagramPublisher {
  constructor() {
    this.driver = null;
  }

  async init() {
    if (!this.driver) this.driver = await attachDriver();
    await this.driver.get("https://www.instagram.com/");
    await sleep(3500);
    if ((await this.driver.findElements(By.css(SEL.home))).length > 0) return;
    logger.warn("Instagram login required: log in manually in the Chrome window (waiting up to 5 minutes)...");
    for (let i = 0; i < 60; i++) {
      await sleep(5000);
      if ((await this.driver.findElements(By.css(SEL.home))).length > 0) return logger.info("Instagram login detected.");
    }
    throw new Error("Instagram login timed out after 5 minutes.");
  }

  async shot(name) {
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const file = path.join(DEBUG_DIR, `${Date.now()}-${name}.png`);
      fs.writeFileSync(file, await this.driver.takeScreenshot(), "base64");
      return file;
    } catch {
      return null;
    }
  }

  /** Clicks the first visible clickable whose text is exactly one of `texts` (inside a dialog when present). */
  async clickText(texts, { timeoutMs = 15000, inDialog = true } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const clicked = await this.driver.executeScript(
        (wanted, dialogOnly) => {
          const roots = dialogOnly ? [...document.querySelectorAll('div[role="dialog"]')] : [];
          const scope = roots.length ? roots : [document];
          for (const root of scope) {
            const cands = root.querySelectorAll('button, div[role="button"], a[role="link"], span, div');
            for (const el of cands) {
              const t = (el.innerText || "").trim();
              if (!wanted.includes(t)) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              const target = el.closest('button, div[role="button"], a') || el;
              target.click();
              return true;
            }
          }
          return false;
        },
        texts,
        inDialog,
      );
      if (clicked) return true;
      await sleep(500);
    }
    return false;
  }

  async clickSvg(selectors, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      for (const sel of selectors) {
        const ok = await this.driver.executeScript((s) => {
          const svg = document.querySelector(s);
          const target = svg && (svg.closest('a, button, div[role="button"]') || svg.parentElement);
          if (!target) return false;
          target.click();
          return true;
        }, sel);
        if (ok) return true;
      }
      await sleep(500);
    }
    return false;
  }

  async typeCaption(text) {
    const box = await this.driver.wait(until.elementLocated(By.css(SEL.caption)), 20000);
    await box.click();
    await sleep(300);
    // The editor accepts insertText (including newlines); read back to verify it landed.
    await this.driver.executeScript((el, t) => { el.focus(); document.execCommand("insertText", false, t); }, box, text);
    await sleep(800);
    const got = await this.driver.executeScript((el) => el.innerText || "", box);
    const want = text.replace(/\s+/g, " ").slice(0, 40);
    if (!got.replace(/\s+/g, " ").includes(want)) {
      await box.sendKeys(text.replace(/\n/g, " "));
    }
  }

  async discard() {
    try {
      await this.driver.executeScript(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await sleep(800);
      await this.clickText(SEL.discard, { timeoutMs: 5000 });
    } catch { /* best effort */ }
  }

  /**
   * @param {{format:"reel"|"carousel", files:string[], caption:string}} piece
   * @param {{dryRun:boolean}} opts
   */
  async publish(piece, { dryRun }) {
    await this.init();
    const step = async (label, fn) => {
      const ok = await fn();
      if (!ok) {
        const shot = await this.shot(label);
        throw new Error(`Instagram step "${label}" failed${shot ? ` (screenshot: ${shot})` : ""}.`);
      }
    };

    await step("open-create", () => this.clickSvg(SEL.create));
    await sleep(1200);
    // Newer layouts open a small menu (Post / Live video / Ad) first.
    await this.clickText(SEL.createMenuPost, { timeoutMs: 3000, inDialog: false });
    await sleep(1200);

    const input = await this.driver.wait(until.elementLocated(By.css(SEL.fileInput)), 20000);
    await input.sendKeys(piece.files.map((f) => path.resolve(f)).join("\n"));
    await sleep(piece.format === "reel" ? 6000 : 3500);
    await this.clickText(SEL.reelsNoticeOk, { timeoutMs: 3000 });

    if (await this.clickSvg(SEL.cropButton, 6000)) {
      await sleep(600);
      await this.clickText(SEL.cropOption[piece.format], { timeoutMs: 4000 });
      await sleep(600);
    }
    await step("next-1", () => this.clickText(SEL.next));
    await sleep(2500);
    await step("next-2", () => this.clickText(SEL.next));
    await sleep(2500);
    await this.typeCaption(piece.caption);
    await sleep(1000);

    if (dryRun) {
      const shot = await this.shot("dry-run-ready");
      logger.info(`Instagram DRY RUN: ready to share (${piece.format}); not shared. Screenshot: ${shot}`);
      await this.discard();
      return { shared: false, dryRun: true, screenshot: shot };
    }

    await step("share", () => this.clickText(SEL.share));
    const deadline = Date.now() + (piece.format === "reel" ? 240000 : 90000);
    while (Date.now() < deadline) {
      const text = await this.driver.executeScript(() => document.body.innerText.slice(0, 5000));
      if (SEL.shared.test(text)) {
        logger.info(`Instagram: ${piece.format} shared.`);
        await sleep(1500);
        await this.clickSvg(['svg[aria-label="Close"]'], 3000);
        return { shared: true };
      }
      await sleep(3000);
    }
    const shot = await this.shot("share-timeout");
    throw new Error(`Instagram did not confirm the share in time (screenshot: ${shot}).`);
  }

  async cleanup() {
    if (this.driver) await releaseDriver(this.driver).catch(() => {});
    this.driver = null;
  }
}

/** Gatekeeper for posting: cap, spacing, and the IG_POST switch. */
function canPostNow() {
  const day = queue.postedSince(24 * 3600 * 1000);
  if (day.length >= config.instagram.dailyCap) return { ok: false, reason: `daily cap ${config.instagram.dailyCap} reached` };
  const recent = queue.postedSince(config.instagram.minGapMinutes * 60 * 1000);
  if (recent.length) return { ok: false, reason: `last post was under ${config.instagram.minGapMinutes} min ago` };
  return { ok: true };
}

/** Caption + hashtags as posted (Instagram limit 2,200 chars, 30 tags). */
function composeCaption(sb) {
  const tags = (sb.hashtags || []).slice(0, 6).join(" ");
  return `${sb.caption.trim()}\n\n${tags}`.slice(0, 2200);
}

module.exports = { InstagramPublisher, canPostNow, composeCaption, SEL };
