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
const { synthesizeVoice } = require("./voice");
const { reviewFrames } = require("./qa");
const { makeHero, pickEngine } = require("./hero");
const sources = require("./sources");
const queue = require("./queue");
const opus = require("./opus");
const novelty = require("./novelty");
const editor = require("./editor");
const director = require("./director");
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
  let files;
  let look = null;
  let mode = ["agent", "template"].includes(opts.mode) ? opts.mode : format === "reel" ? chooseReelMode() : config.factory.carouselMode;
  let sb = withShots(await writeStoryboard(article, format, null, null, { mode }), assets);

  if (mode === "agent") {
    try {
      // The narration is spoken first, so the brief and the film are timed to its words.
      const voice = format === "reel" ? await synthesizeVoice(sb, dir) : null;
      // The director picks references from the whole library and writes this piece's brief.
      const engine = format === "carousel" ? "remotion" : pickEngine();
      const avoid = novelty.looksToAvoid();
      const references = await director.selectReferences(article, format, { avoid });
      const brief = await director.writeDirectorPrompt({ story: article, storyboard: sb, refs: references, assets, avoid, voice, engine });
      try {
        fs.writeFileSync(path.join(dir, "references.json"), JSON.stringify(references.map((r) => ({ slug: r.slug, title: r.title, steal: r.steal })), null, 2));
        if (brief) fs.writeFileSync(path.join(dir, "director-prompt.md"), brief);
      } catch { /* review files only */ }
      if (!brief) logger.warn(`Factory: no director's prompt for ${sb.id}; the agent writes its own brief.`);
      const piece = await makeHero({ storyboard: sb, article, outDir: dir, assets, director: brief, references, voice, engine });
      files = format === "reel" ? { video: piece.video, poster: piece.poster } : { slides: piece.slides };
      look = piece.look;
    } catch (e) {
      // Every posted piece should be one of a kind, so by default a failed one is retried
      // next cycle instead of being replaced by a templated one.
      if (!config.factory.templateFallback) throw e;
      logger.warn(`Factory: agent ${format} failed for ${sb.id} (${e.message}); FACTORY_TEMPLATE_FALLBACK=true, using templates.`);
      mode = "template";
      // Template reels have no voice track: drop the narration so a QA revision is not held to it.
      sb = { ...sb, scenes: (sb.scenes || []).map(({ voiceover, ...s }) => s) };
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
  // This run's stories are saved before anything else: a pass that is skipped (lock held,
  // crash, Opus down) leaves them for the next one instead of losing them.
  try { editor.rememberRun(opts.extraSources || []); } catch (e) { logger.warn(`Factory: inbox not saved (${e.message}).`); }
  opus.resetAbort();
  return (await withFactoryLock("cycle", () => {
    try { pruneState(); } catch (e) { logger.warn(`Factory: pruning skipped (${e.message}).`); }
    return cycle(opts);
  }, { logger })) || [];
}

const DAY = 24 * 3600 * 1000;

/**
 * Keeps disk use bounded: job dirs older than 21 days lose their agent workspace and transcript
 * (the finished reel, slides, storyboard and caption stay), Instagram debug shots go after 14 days.
 * The workspace's node_modules is a junction to the shared install: it is unlinked first, because
 * a recursive delete through it would wipe factory/node_modules.
 */
function pruneState(now = Date.now()) {
  const old = (p, days) => { try { return now - fs.statSync(p).mtimeMs > days * DAY; } catch { return false; } };
  const unlinkLinks = (dir) => {
    for (const name of ["node_modules"]) {
      const p = path.join(dir, name);
      try { if (fs.lstatSync(p).isSymbolicLink()) fs.unlinkSync(p); } catch { /* none */ }
    }
  };
  if (fs.existsSync(JOBS)) {
    for (const job of fs.readdirSync(JOBS)) {
      const dir = path.join(JOBS, job);
      if (!old(dir, 21)) continue;
      for (const sub of fs.readdirSync(dir)) {
        const p = path.join(dir, sub);
        if (/^agent-/.test(sub)) {
          unlinkLinks(p);
          try { fs.rmSync(p, { recursive: true, force: true, maxRetries: 3 }); } catch { /* next time */ }
        } else if (/^(agent\.log|agent-prompt\.md|soundtrack\.wav|reel\.video\.mp4)$/.test(sub)) {
          fs.rmSync(p, { force: true });
        }
      }
    }
  }
  const debug = path.join(queue.STATE_DIR, "ig-debug");
  if (fs.existsSync(debug)) for (const f of fs.readdirSync(debug)) if (old(path.join(debug, f), 14)) fs.rmSync(path.join(debug, f), { force: true });
}

/** Stops a running cycle: claude processes are killed and the cycle stops at its next step. */
function stop() {
  opus.abortAll();
}

/**
 * Failures that say nothing about the story (Claude down, plan limit, shutting down, disk):
 * they must not use up the story's two attempts.
 */
const isInfraFailure = (e) => ["ABORTED", "OPUS_UNAVAILABLE", "FACTORY_RENDERER_MISSING", "NO_BROWSER"].includes(e?.code) || /usage limit|rate limit|quota|ENOSPC|EBUSY/i.test(String(e?.message || ""));

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
    const why = fresh.length ? "this run's stories are all made already" : "nothing new this run";
    if (!config.factory.archiveFallback) {
      logger.info(`Factory: ${why}; no piece this time (FACTORY_ARCHIVE_FALLBACK=false keeps the channel on fresh stories).`);
      return made;
    }
    logger.info(`Factory: ${why}; using the Insights archive.`);
    open = usable(sources.listInsights());
  }
  const ranked = await editor.pickStory(open);
  // Opus runs are not free (plan limits): a story that fails moves on to the next, twice at most.
  let failures = 0;
  let stories = 0;
  for (const picked of ranked) {
    if (stories >= config.factory.perCycle || failures >= 2 || opus.isAborted()) break;
    const story = await editor.deepDive(picked);
    let ok = false;
    for (const format of formats) {
      if (opus.isAborted()) break;
      if (queue.has(story, format)) continue;
      try {
        made.push(await produce(story, format));
        ok = true;
      } catch (e) {
        logger.error(`Factory: ${format} for "${story.title}" failed (non-fatal): ${e.message}`);
        if (e.code !== "ALREADY_POSTED" && !isInfraFailure(e) && !opus.isAborted()) queue.add({ key: queue.key(story.origin, story.slug, format), format, status: "failed", error: e.message, title: story.title, origin: story.origin });
        if (isInfraFailure(e) || opus.isAborted()) failures = 2;
      }
    }
    if (ok) stories++;
    else failures++;
  }
  const cost = opus.usage.costUsd - cost0;
  logger.info(`Factory: made ${made.length} piece(s) from ${stories} story(ies). Opus calls this cycle: ${opus.usage.calls - calls0}${cost ? `, plan-equivalent $${cost.toFixed(2)}` : ""}.`);
  // Post the story this run picked (the fresh, viral one); the backlog only when nothing was made.
  if (publish && !opus.isAborted()) await publishNow({ dryRun, id: made[0]?.id || null });
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
    } else if (dryRun) {
      // A rehearsal that fails (e.g. after an Instagram redesign) says nothing about the piece.
      logger.error(`Instagram dry run failed for ${item.id} (non-fatal): ${e.message}`);
      queue.update(item.key, { lastDryRunError: e.message, lastDryRun: new Date().toISOString() });
    } else {
      const it = queue.publishFailed(item.key, e.message);
      logger.error(`Instagram publish failed for ${item.id} (attempt ${it?.publishAttempts}/${queue.MAX_PUBLISH_ATTEMPTS}, non-fatal): ${e.message}`);
    }
    return null;
  } finally {
    await publisher.cleanup();
  }
}

const PIPELINE_LOCK = path.join(process.cwd(), ".pipeline.lock");
/** True while `npm start` is mid-run (its lock has a fresh heartbeat): it is using the shared Chrome. */
function pipelineRunning() {
  try {
    const lock = JSON.parse(fs.readFileSync(PIPELINE_LOCK, "utf8"));
    const beat = Date.parse(lock.heartbeatAt || lock.startedAt || "");
    return Number.isFinite(beat) && Date.now() - beat < 10 * 60 * 1000 && lock.pid !== process.pid;
  } catch {
    return false;
  }
}

/**
 * Posting from outside a cycle (CLI) takes the factory lock, so it never races a cycle, and waits
 * for a running pipeline: the X/LinkedIn bots drive the same Chrome and would pull the tab away.
 */
const publishDue = (opts) => {
  if (pipelineRunning()) {
    logger.warn("Factory: the pipeline is running and using Chrome; publish again when it is done.");
    return Promise.resolve(null);
  }
  return withFactoryLock("publish", () => publishNow(opts), { logger });
};

module.exports = { produce, runCycle, publishDue, chooseReelMode, stop, isInfraFailure, pruneState };
