/**
 * Content factory orchestrator: article -> storyboard (Opus) -> plates (OpenRouter image model)
 * -> video/slides (Remotion templates or a local Claude Code agent) -> vision QA -> queue -> Instagram.
 *
 * Everything here is non-fatal to the main pipeline: cron.js calls runCycle() inside try/catch.
 * Architecture and operations: docs/CONTENT_FACTORY.md
 */
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { writeStoryboard } = require("./storyboard");
const { generatePlates } = require("./plates");
const { renderReel, renderReelStills, renderCarousel, contactSheet } = require("./render");
const { reviewFrames } = require("./qa");
const { makeHero } = require("./hero");
const sources = require("./sources");
const queue = require("./queue");
const opus = require("./opus");
const novelty = require("./novelty");
const { InstagramPublisher, canPostNow, composeCaption } = require("./instagram");

const JOBS = path.join(queue.STATE_DIR, "jobs");
const WEEK = 7 * 24 * 3600 * 1000;

const stripSrc = (sb) => ({ ...sb, plates: sb.plates.map(({ src, file, ...p }) => p) });
const stamp = () => new Date().toISOString().slice(0, 10);

function chooseReelMode() {
  const mode = config.factory.videoMode;
  if (mode === "agent") return "agent";
  if (mode === "template") return "template";
  return queue.heroesSince(WEEK).length < config.factory.heroPerWeek ? "agent" : "template";
}

/** Renders stills, asks Opus to check them, and returns issues as storyboard feedback (or null). */
async function qaPass(sb, dir) {
  if (!config.factory.visionQa) return null;
  try {
    const files = sb.format === "reel" ? await renderReelStills(sb, path.join(dir, "qa")) : (await renderCarousel(sb, path.join(dir, "qa"))).slides;
    const { pass, issues } = await reviewFrames(sb, files);
    if (pass) return null;
    fs.writeFileSync(path.join(dir, "qa-issues.json"), JSON.stringify(issues, null, 2));
    return issues.map((i) => `Frame ${i.frame}: ${i.problem} -> ${i.fix}`);
  } catch (e) {
    logger.warn(`Factory QA skipped for ${sb.id} (${e.message}).`);
    return null;
  }
}

/**
 * Makes one piece. Returns the queue item.
 * @param {object} article  from sources.js
 * @param {"reel"|"carousel"} format
 * @param {{mode?: "agent"|"template"}} [opts]
 */
async function produce(article, format, opts = {}) {
  const dir = path.join(JOBS, `${stamp()}-${format}-${article.slug}`);
  fs.mkdirSync(dir, { recursive: true });
  const k = queue.key(article.origin, article.slug, format);
  fs.writeFileSync(path.join(dir, "source.md"), `# ${article.title}\n\n${article.text}\n`);

  let sb = await writeStoryboard(article, format);
  await generatePlates(sb, dir);

  let files;
  let look = null;
  let mode = format === "reel" ? opts.mode || chooseReelMode() : "template";

  if (mode === "agent") {
    try {
      const hero = await makeHero({ storyboard: sb, article, outDir: dir });
      files = { video: hero.video, poster: hero.poster };
      look = hero.look;
    } catch (e) {
      // Every posted reel should be one of a kind, so by default a failed film is retried
      // next cycle instead of being replaced by a templated one.
      if (!config.factory.templateFallback) throw e;
      logger.warn(`Factory: agent film failed for ${sb.id} (${e.message}); FACTORY_TEMPLATE_FALLBACK=true, using templates.`);
      mode = "template";
    }
  }

  if (mode === "template") {
    // Galleries' loop: render stills -> look -> fix -> render. One revision round.
    const feedback = await qaPass(sb, dir);
    if (feedback) {
      try {
        const revised = await writeStoryboard(article, format, feedback, sb);
        await generatePlates(revised, dir);
        sb = revised;
        logger.info(`Factory: ${sb.id} revised after QA.`);
      } catch (e) {
        logger.warn(`Factory: QA revision rejected for ${sb.id} (${e.message}); keeping the first storyboard.`);
      }
    }
    if (format === "reel") files = await renderReel(sb, dir);
    else files = await renderCarousel(sb, dir);
  }

  const visuals = format === "reel" ? [files.poster] : files.slides;
  const sheet = contactSheet(visuals, path.join(dir, "contact.jpg"));
  fs.writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(stripSrc(sb), null, 2));
  const caption = composeCaption(sb);
  fs.writeFileSync(path.join(dir, "caption.txt"), caption);

  const item = queue.add({
    key: k,
    id: sb.id,
    format,
    mode,
    status: "rendered",
    dir,
    upload: format === "reel" ? [files.video] : files.slides,
    cover: format === "reel" ? files.poster : files.slides[0],
    contact: sheet,
    caption,
    title: article.title,
    origin: article.origin,
    tags: article.tags || [],
    topicText: novelty.topicText(article),
    hook: format === "reel" ? sb.scenes[0]?.text : sb.slides[0]?.title,
    pattern: sb.pattern,
    look,
  });
  logger.info(`Factory: ${format} ready for review/posting: ${dir}`);
  return item;
}

/**
 * One factory pass: pick the most concrete unseen sources, make up to FACTORY_PER_CYCLE pieces,
 * then post whatever the cap allows.
 * @param {{extraSources?: object[], publish?: boolean, dryRun?: boolean}} opts
 */
async function runCycle({ extraSources = [], publish = config.instagram.post, dryRun = !config.instagram.post } = {}) {
  const made = [];
  // Opus runs are not free (plan limits): stop a cycle after a few failures instead of walking the whole pool.
  let failures = 0;
  const maxFailures = config.factory.perCycle + 2;
  // Best material first, then filtered and interleaved so every piece is a new topic.
  const pool = novelty.orderForNovelty(sources.rankSources([...extraSources, ...sources.listInsights()]));
  const formats = config.factory.formats.length ? config.factory.formats : ["reel"];
  outer: for (const article of pool) {
    for (const format of formats) {
      if (made.length >= config.factory.perCycle) break outer;
      if (queue.has(article, format)) continue;
      // Re-check against everything made so far, including earlier picks in this cycle
      // (a reel and a carousel of the same source is allowed; two sources on one topic is not).
      if (!novelty.isFreshTopic(article, novelty.recent())) continue;
      try {
        made.push(await produce(article, format));
      } catch (e) {
        logger.error(`Factory: ${format} for "${article.title}" failed (non-fatal): ${e.message}`);
        queue.add({ key: queue.key(article.origin, article.slug, format), format, status: "failed", error: e.message, title: article.title, origin: article.origin });
        if (e.code === "OPUS_UNAVAILABLE" || e.code === "FACTORY_RENDERER_MISSING" || ++failures >= maxFailures) break outer;
      }
    }
  }
  logger.info(`Factory: made ${made.length} piece(s). Opus calls: ${opus.usage.calls}${opus.usage.costUsd ? `, plan-equivalent $${opus.usage.costUsd.toFixed(2)}` : ""}.`);
  if (publish) await publishDue({ dryRun });
  return made;
}

/** Posts the oldest rendered piece if the cap and spacing allow. */
async function publishDue({ dryRun = !config.instagram.post, id = null } = {}) {
  const gate = canPostNow();
  if (!dryRun && !gate.ok) {
    logger.info(`Instagram: not posting (${gate.reason}).`);
    return null;
  }
  const item = id ? queue.load().items.find((x) => x.id === id && x.status === "rendered") : queue.nextToPost();
  if (!item) {
    logger.info("Instagram: nothing rendered and waiting.");
    return null;
  }
  const publisher = new InstagramPublisher();
  try {
    const res = await publisher.publish({ format: item.format, files: item.upload, caption: item.caption }, { dryRun });
    if (res.shared) queue.update(item.key, { status: "posted", postedAt: new Date().toISOString() });
    else queue.update(item.key, { lastDryRun: new Date().toISOString(), dryRunShot: res.screenshot });
    return res;
  } catch (e) {
    logger.error(`Instagram publish failed for ${item.id} (non-fatal): ${e.message}`);
    queue.update(item.key, { lastError: e.message });
    return null;
  } finally {
    await publisher.cleanup();
  }
}

module.exports = { produce, runCycle, publishDue, chooseReelMode };
