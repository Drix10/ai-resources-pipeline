/**
 * Content factory orchestrator: article -> storyboard (Opus)
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
const { renderReel, renderReelStills, renderCarousel, contactSheet, ffmpeg } = require("./render");
const { gatherAssets } = require("./assets");
const { reviewFrames } = require("./qa");
const { makeHero } = require("./hero");
const sources = require("./sources");
const queue = require("./queue");
const opus = require("./opus");
const novelty = require("./novelty");
const editor = require("./editor");
const { withFactoryLock } = require("./lock");
const { InstagramPublisher, canPostNow, composeCaption } = require("./instagram");

const JOBS = path.join(queue.STATE_DIR, "jobs");
const WEEK = 7 * 24 * 3600 * 1000;

const stamp = () => new Date().toISOString().slice(0, 10);

/** Fills each "shot" slide with its screenshot (a small JPEG data URL) and the page's host. */
function withShots(sb, assets) {
  const slides = (sb.slides || []).map((s) => {
    if (s.type !== "shot") return s;
    // src/host only ever come from a real capture, never from the model.
    const { src, host, ...rest } = s;
    const a = assets.find((x) => x.id === s.asset);
    if (!a || !fs.existsSync(a.file)) throw new Error(`shot slide asset "${s.asset}" has no capture on disk`);
    const small = a.file.replace(/\.jpg$/, ".slide.jpg");
    if (!fs.existsSync(small)) ffmpeg(["-i", a.file, "-vf", "scale='min(1000,iw)':-2", "-q:v", "4", small], { timeoutMs: 60000 });
    return { ...rest, src: `data:image/jpeg;base64,${fs.readFileSync(small).toString("base64")}`, host: new URL(a.page || a.url).hostname };
  });
  return { ...sb, slides };
}

const withoutShots = (sb) => ({ ...sb, slides: (sb.slides || []).map(({ src, ...s }) => s) });

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
    // "Fail" with nothing concrete to fix is not worth a storyboard rewrite.
    if (pass || !issues.length) return null;
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

  // Real material first, so the storyboard knows which screenshots exist.
  const assets = await gatherAssets(article, dir);
  article = { ...article, assets };
  let sb = withShots(await writeStoryboard(article, format), assets);

  let files;
  let look = null;
  let mode = format === "reel" ? opts.mode || chooseReelMode() : "template";

  if (mode === "agent") {
    try {
      const hero = await makeHero({ storyboard: sb, article, outDir: dir, assets });
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
        const revised = await writeStoryboard(article, format, feedback, withoutShots(sb));
        sb = withShots(revised, assets);
        logger.info(`Factory: ${sb.id} revised after QA.`);
      } catch (e) {
        logger.warn(`Factory: QA revision rejected for ${sb.id} (${e.message}); keeping the first storyboard.`);
      }
    }
    if (format === "reel") files = await renderReel(sb, dir);
    else files = await renderCarousel(sb, dir);
  }

  // The piece is made: nothing optional below may throw it away.
  const visuals = format === "reel" ? [files.poster] : files.slides;
  let sheet = null;
  try { sheet = contactSheet(visuals, path.join(dir, "contact.jpg")); } catch (e) { logger.warn(`Factory: contact sheet skipped (${e.message}).`); }
  const caption = composeCaption(sb);
  try {
    fs.writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(withoutShots(sb), null, 2));
    fs.writeFileSync(path.join(dir, "caption.txt"), caption);
  } catch (e) { logger.warn(`Factory: review files not written (${e.message}).`); }

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
    // The topic fingerprint is the story itself, not the research appended to it.
    topicText: novelty.topicText({ ...article, text: article.baseText ?? article.text }),
    hook: format === "reel" ? sb.scenes[0]?.text : sb.slides[0]?.title,
    pattern: sb.pattern,
    look,
  });
  logger.info(`Factory: ${format} ready for review/posting: ${dir}`);
  return item;
}

/**
 * One factory pass, at the end of a pipeline run: take this run's new material, let the editor
 * pick the single best story, research it (deep dive into its links), make every configured
 * format from it, then post whatever the cap allows. FACTORY_PER_CYCLE = stories per pass.
 * @param {{extraSources?: object[], publish?: boolean, dryRun?: boolean}} opts
 */
async function runCycle(opts = {}) {
  return (await withFactoryLock("cycle", () => cycle(opts), { logger })) || [];
}

async function cycle({ extraSources = [], publish = config.instagram.post, dryRun = !config.instagram.post } = {}) {
  const made = [];
  const calls0 = opus.usage.calls;
  const cost0 = opus.usage.costUsd;
  const formats = config.factory.formats.length ? config.factory.formats : ["reel"];
  // Unmade stories on topics the channel has not covered yet.
  const recent = novelty.recent();
  const usable = (list) => novelty.orderForNovelty(list).filter((a) => formats.some((f) => !queue.has(a, f)) && novelty.isFreshTopic(a, recent));
  const { fresh } = editor.freshSources(extraSources);
  let open = usable(fresh);
  if (!open.length) {
    // Nothing new, or everything new is already made: fall back to the Insights archive.
    logger.info(`Factory: ${fresh.length ? "this run's stories are all made already" : "nothing new this run"}; using the Insights archive.`);
    open = usable(sources.listInsights());
  }
  const ranked = await editor.pickStory(open);
  // Opus runs are not free (plan limits): a story that fails moves on to the next, twice at most.
  let failures = 0;
  let stories = 0;
  for (const picked of ranked) {
    if (stories >= config.factory.perCycle || failures >= 2) break;
    const story = await editor.deepDive(picked);
    let ok = false;
    for (const format of formats) {
      if (queue.has(story, format)) continue;
      try {
        made.push(await produce(story, format));
        ok = true;
      } catch (e) {
        logger.error(`Factory: ${format} for "${story.title}" failed (non-fatal): ${e.message}`);
        if (e.code !== "ALREADY_POSTED") queue.add({ key: queue.key(story.origin, story.slug, format), format, status: "failed", error: e.message, title: story.title, origin: story.origin });
        if (e.code === "OPUS_UNAVAILABLE" || e.code === "FACTORY_RENDERER_MISSING") failures = 2;
      }
    }
    if (ok) stories++;
    else failures++;
  }
  const cost = opus.usage.costUsd - cost0;
  logger.info(`Factory: made ${made.length} piece(s) from ${stories} story(ies). Opus calls this cycle: ${opus.usage.calls - calls0}${cost ? `, plan-equivalent $${cost.toFixed(2)}` : ""}.`);
  if (publish) await publishNow({ dryRun });
  return made;
}

/** Posts the oldest rendered piece if the cap and spacing allow. */
async function publishNow({ dryRun = !config.instagram.post, id = null } = {}) {
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
  // Marked BEFORE the Share click: from then on the item may be live, so a crash, a timeout or a
  // missed confirmation can never post it a second time, and it counts toward the cap.
  const onBeforeShare = () => queue.update(item.key, { status: "sharing", shareClickedAt: new Date().toISOString() });
  try {
    const res = await publisher.publish({ format: item.format, files: item.upload, caption: item.caption }, { dryRun, onBeforeShare });
    if (res.shared) queue.update(item.key, { status: "posted", postedAt: new Date().toISOString() });
    else queue.update(item.key, { lastDryRun: new Date().toISOString(), dryRunShot: res.screenshot });
    return res;
  } catch (e) {
    if (publisher.shareClicked) {
      logger.error(`Instagram: Share was clicked for ${item.id} but not confirmed (${e.message}). Marked "unconfirmed": check the profile; it will not be posted again automatically.`);
      queue.update(item.key, { status: "unconfirmed", lastError: e.message });
    } else {
      const it = queue.publishFailed(item.key, e.message);
      logger.error(`Instagram publish failed for ${item.id} (attempt ${it?.publishAttempts}/${queue.MAX_PUBLISH_ATTEMPTS}, non-fatal): ${e.message}`);
    }
    return null;
  } finally {
    await publisher.cleanup();
  }
}

/** Posting from outside a cycle (CLI) takes the same lock, so it can never race a cycle. */
const publishDue = (opts) => withFactoryLock("publish", () => publishNow(opts), { logger });

module.exports = { produce, runCycle, publishDue, chooseReelMode };
