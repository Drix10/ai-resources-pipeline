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
const { synthesizeVoice, voiceAvailable } = require("./voice");
const { fetchStock, creditsOf } = require("./stock");
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
const music = require("./music");

const JOBS = path.join(queue.STATE_DIR, "jobs");
const WEEK = 7 * 24 * 3600 * 1000;

const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * Caption credits: where the story comes from and what the stock licences ask for. The source is
 * written as a link, never an @handle: on Instagram that would tag whoever owns the name there.
 */
function creditLines(article, assets) {
  const out = [];
  if (article.post && article.post.user) out.push(`Source: x.com/${article.post.user}`);
  const cc = creditsOf(assets);
  if (cc.length) out.push(`Photos: ${cc.join("; ")}`);
  const stock = [...new Set((assets || []).map((a) => ({ pexels: "Pexels", pixabay: "Pixabay", mixkit: "Mixkit" })[a && a.provider]).filter(Boolean))];
  if (stock.length) out.push(`Stock footage: ${stock.join(", ")}`);
  return out;
}

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

// Tracks of the last pieces are not used again (32 tracks: about a week and a half of reels).
const MUSIC_MEMORY = 8;

const recentMusic = () => novelty.recent(MUSIC_MEMORY * 2).map((it) => it.music?.id).filter(Boolean).slice(0, MUSIC_MEMORY);

/** The music library for the director, with the recently used tracks marked. Never throws. */
function musicLines() {
  try {
    const recent = new Set(recentMusic());
    return music.catalogLines(music.catalog({ log: (m) => logger.info(m) })).split("\n").filter(Boolean)
      .map((l) => (recent.has(l.slice(2).split(" | ")[0]) ? `${l} | used recently` : l)).join("\n");
  } catch (e) {
    logger.warn(`Factory: music library unavailable (${e.message}).`);
    return "";
  }
}

/**
 * The track and the part of it a reel of `seconds` uses: the director's pick when it fits, else
 * the best fit for the story's mood. Its drop is planned onto the climax (~60% in). Never throws:
 * without the library the reel falls back to the synth.
 */
function pickMusic({ sb, article, voice = null, brief = null, seconds }) {
  try {
    const tracks = music.catalog({ log: (m) => logger.info(m) });
    if (!tracks.length) return null;
    const climaxAt = Math.round(seconds * 0.62 * 10) / 10;
    const mood = music.moodFor(`${article.title}\n${JSON.stringify(sb.scenes || sb.slides || [])}`);
    const track = music.chooseTrack({ tracks, mood, seconds, climaxAt, narrated: !!voice, recent: recentMusic(), director: brief });
    if (!track) return null;
    const plan = music.planWindow(track, { seconds, climaxAt });
    logger.info(`Factory: music "${track.title}"${track.artist ? ` by ${track.artist}` : ""} from ${plan.start.toFixed(1)} s, ${plan.bpm} bpm${plan.dropAt !== null ? `, drop at ${plan.dropAt.toFixed(1)} s` : ""}.`);
    return { track, plan };
  } catch (e) {
    logger.warn(`Factory: music skipped (${e.message}).`);
    return null;
  }
}

const musicRecord = (m) => (m ? { id: m.track.id, title: m.track.title, artist: m.track.artist, mood: m.track.mood, start: m.plan.start, bpm: m.plan.bpm, dropAt: m.plan.dropAt } : null);

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
  let assets = await gatherAssets(article, dir);
  article = { ...article, assets };
  let files;
  let look = null;
  let mode = ["agent", "template"].includes(opts.mode) ? opts.mode : format === "reel" ? chooseReelMode() : config.factory.carouselMode;
  let sb = withShots(await writeStoryboard(article, format, null, null, { mode }), assets);
  // Saved now (rewritten at the end), so a piece that fails later can still be read.
  try { fs.writeFileSync(path.join(dir, "storyboard.json"), JSON.stringify(withoutShots(sb), null, 2)); } catch { /* review file only */ }
  let chosenMusic = null;

  if (mode === "agent") {
    try {
      // The stock footage and photos the scenes asked for, next to the captures.
      if (format === "reel") {
        assets = await fetchStock(sb, dir, assets);
        article = { ...article, assets };
      }
      // The narration is spoken first, so the brief and the film are timed to its words.
      const voice = format === "reel" ? await synthesizeVoice(sb, dir) : null;
      // A narrated storyboard never becomes a silent reel: the piece is retried next cycle instead.
      if (format === "reel" && !voice && voiceAvailable()) throw Object.assign(new Error("no voiceover was produced; a reel is never posted silent"), { code: "VOICE_FAILED" });
      // The director picks references from the whole library and writes this piece's brief.
      const engine = format === "carousel" ? "remotion" : pickEngine();
      const avoid = novelty.looksToAvoid();
      // A reel's brief is its storyboard's shot plan: the separate director (~20 min of thinking)
      // only runs for carousels, or for reels with FACTORY_REEL_DIRECTOR=true.
      const directed = format !== "reel" || config.factory.reelDirector;
      const references = directed ? await director.selectReferences(article, format, { avoid }) : [];
      const brief = directed ? await director.writeDirectorPrompt({ story: article, storyboard: sb, refs: references, assets, avoid, voice, engine, music: format === "reel" ? musicLines() : "" }) : null;
      // The music is chosen and beat-mapped BEFORE the build, so the film is cut to it.
      if (format === "reel") {
        chosenMusic = pickMusic({ sb, article, voice, brief, seconds: director.filmSeconds(sb, voice) });
        if (chosenMusic) sb = { ...sb, bpm: Math.round(chosenMusic.plan.bpm) };
      }
      try {
        fs.writeFileSync(path.join(dir, "references.json"), JSON.stringify(references.map((r) => ({ slug: r.slug, title: r.title, steal: r.steal })), null, 2));
        if (brief) fs.writeFileSync(path.join(dir, "director-prompt.md"), brief);
        if (chosenMusic) fs.writeFileSync(path.join(dir, "music.json"), JSON.stringify({ ...musicRecord(chosenMusic), beats: chosenMusic.plan.beats, energy: chosenMusic.plan.energy }, null, 2));
      } catch { /* review files only */ }
      if (!brief && directed) logger.warn(`Factory: no director's prompt for ${sb.id}; the agent writes its own brief.`);
      const piece = await makeHero({ storyboard: sb, article, outDir: dir, assets, director: brief, references, voice, engine, music: chosenMusic });
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
    if (format === "reel") {
      files = await renderReel(sb, dir, { pickMusic: (seconds) => pickMusic({ sb, article, seconds }) });
      chosenMusic = files.music || null;
      if (files.bpm) sb = { ...sb, bpm: files.bpm };
    }
    else files = await renderCarousel(sb, dir);
  }

  // The piece is made: nothing optional below may throw it away.
  const visuals = format === "reel" ? [files.poster] : files.slides;
  let sheet = null;
  try { sheet = contactSheet(visuals, path.join(dir, "contact.jpg")); } catch (e) { logger.warn(`Factory: contact sheet skipped (${e.message}).`); }
  const caption = composeCaption({ ...sb, credits: creditLines(article, assets) });
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
    music: format === "reel" ? musicRecord(chosenMusic) : null,
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
  // A stop asked for before the pass began holds: resetting the abort here would undo it.
  if (stopped) return [];
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
        } else if (/^(agent\.log|agent-prompt\.md|soundtrack\.wav|sfx\.wav|reel\.video\.mp4)$/.test(sub)) {
          fs.rmSync(p, { force: true });
        }
      }
    }
  }
  const debug = path.join(queue.STATE_DIR, "ig-debug");
  if (fs.existsSync(debug)) for (const f of fs.readdirSync(debug)) if (old(path.join(debug, f), 14)) fs.rmSync(path.join(debug, f), { force: true });
}

/** Stops a running cycle: claude processes are killed and the cycle stops at its next step. */
// Set by stop() for the rest of the process: shutdown never starts a new pass.
let stopped = false;
function stop() {
  stopped = true;
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
  // Ideas, not ads: launches, announcements, demos and events never become reels.
  const ideas = fresh.filter((a) => !editor.isPromo(a));
  if (fresh.length > ideas.length) logger.info(`Factory: ${fresh.length - ideas.length} of ${fresh.length} fresh stories are launches or promos; skipped.`);
  const open = usable(ideas);
  let ranked = open.length ? await editor.pickStory(open) : [];
  if (!ranked.length) {
    const why = !fresh.length ? "nothing new this run" : open.length ? "no story this run makes an interesting reel" : "this run's stories are promos or made already";
    if (!config.factory.archiveFallback) {
      logger.info(`Factory: ${why}; no piece this time (FACTORY_ARCHIVE_FALLBACK=false).`);
      return made;
    }
    logger.info(`Factory: ${why}; using the Insights archive.`);
    ranked = await editor.pickStory(usable(sources.listInsights()));
  }
  const started = Date.now();
  // Opus runs are not free (plan limits): a story that fails moves on to the next, twice at most.
  let failures = 0;
  let stories = 0;
  for (const picked of ranked) {
    // A reel is held to ~30 min: after a failure, another story only when the pass is still young.
    if (stories >= config.factory.perCycle || failures >= 2 || opus.isAborted() || (failures && Date.now() - started > 8 * 60 * 1000)) break;
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
