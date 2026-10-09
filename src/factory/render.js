/**
 * Renders a validated storyboard with the Remotion templates in factory/.
 *
 *  reel:     Reel composition -> muted H.264 -> + synthesized soundtrack -> reel.mp4 (1080x1920, 30fps)
 *  carousel: Slide still per slide -> slide-01.jpg … (1080x1350)
 *
 * Remotion lives in factory/node_modules (its own package, like blog/), so it is loaded
 * from there and the pipeline's root dependencies stay small. The bundle is built once per
 * process and reused for every render.
 */
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");
const { spawnSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { renderSoundtrack } = require("./soundtrack");
const { FPS, reelTimeline, reelDuration } = require("./timeline");
const { planWindow } = require("./music");

const FACTORY_DIR = path.resolve(__dirname, "../../factory");
const ENTRY = path.join(FACTORY_DIR, "src/index.ts");

let bundlePromise = null;

function remotion() {
  const req = createRequire(path.join(FACTORY_DIR, "package.json"));
  try {
    return { bundler: req("@remotion/bundler"), renderer: req("@remotion/renderer") };
  } catch (e) {
    const err = new Error(`Remotion is not installed in factory/ (${e.message}). Run: cd factory && npm install`);
    err.code = "FACTORY_RENDERER_MISSING";
    throw err;
  }
}

function getBundle() {
  if (!bundlePromise) {
    const { bundler } = remotion();
    logger.info("Factory: bundling Remotion templates (once per process)...");
    bundlePromise = bundler.bundle({ entryPoint: ENTRY, onProgress: () => {} }).catch((e) => {
      bundlePromise = null;
      throw e;
    });
  }
  return bundlePromise;
}

const browserOpts = () => (config.factory.browserExecutable ? { browserExecutable: config.factory.browserExecutable } : {});

/** Synchronous ffmpeg with a hard time limit, so a bad input can never block the process for good. */
function ffmpeg(args, { timeoutMs = 15 * 60 * 1000 } = {}) {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 });
  if (res.error || res.status !== 0) throw new Error(`ffmpeg failed: ${res.error?.code === "ETIMEDOUT" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : res.error?.message || res.stderr}`);
}

async function selectComp(id, inputProps) {
  const { renderer } = remotion();
  const serveUrl = await getBundle();
  const composition = await renderer.selectComposition({ serveUrl, id, inputProps, ...browserOpts() });
  return { renderer, serveUrl, composition };
}

/** Renders the reel and muxes the soundtrack. Returns { video, poster, seconds }. */
/**
 * A track from the music library for a template reel, with the storyboard's tempo moved onto the
 * track's (half or double when that is closer to the templates' ~120 bpm), so every scene cut
 * lands on the music's beats. Returns {storyboard, music} (music null: keep the synth).
 */
function withLibraryMusic(storyboard, pickMusic) {
  const first = pickMusic ? pickMusic(reelDuration(storyboard) / FPS) : null;
  if (!first) return { storyboard, music: null };
  const bpm = [0.5, 1, 2].map((k) => first.plan.bpm * k).filter((b) => b >= 70 && b <= 160).sort((a, b) => Math.abs(a - 120) - Math.abs(b - 120))[0];
  if (!bpm) return { storyboard, music: null };
  const sb = { ...storyboard, bpm: Math.round(bpm * 100) / 100 };
  const seconds = reelDuration(sb) / FPS;
  if (first.track.duration < seconds + 2) return { storyboard, music: null };
  return { storyboard: sb, music: { track: first.track, plan: planWindow(first.track, { seconds, climaxAt: Math.round(seconds * 0.62 * 10) / 10 }) } };
}

async function renderReel(storyboard, outDir, { pickMusic = null } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  let music = null;
  try {
    ({ storyboard, music } = withLibraryMusic(storyboard, pickMusic));
  } catch (e) {
    logger.warn(`Factory: library music skipped for ${storyboard.id} (${e.message}); using the synth.`);
  }
  const inputProps = { storyboard };
  const { renderer, serveUrl, composition } = await selectComp("Reel", inputProps);
  const muted = path.join(outDir, "reel.muted.mp4");
  const video = path.join(outDir, "reel.mp4");
  const wav = path.join(outDir, "soundtrack.wav");

  logger.info(`Factory: rendering reel ${storyboard.id} (${composition.durationInFrames} frames)...`);
  let lastPct = -10;
  await renderer.renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    crf: 18,
    pixelFormat: "yuv420p",
    muted: true,
    outputLocation: muted,
    imageFormat: "jpeg",
    jpegQuality: 92,
    chromiumOptions: { gl: "angle" },
    ...browserOpts(),
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= lastPct + 10) { lastPct = pct; logger.info(`Factory: reel ${pct}%`); }
    },
  });

  const seconds = reelDuration(storyboard) / FPS;
  const cuts = reelTimeline(storyboard).map((s) => s.from / FPS);
  if (music) {
    // Library track on the cut grid, a whoosh on every cut and a riser into a boom on the drop.
    const { renderSfx, normalizeEvents } = require("./sfx");
    const { mixReel } = require("./mix");
    const events = normalizeEvents({ cuts }, seconds, { dropAt: music.plan.dropAt });
    const sfx = renderSfx(path.join(outDir, "sfx.wav"), { seconds, events, seed: hash(storyboard.id) })?.file || null;
    mixReel({ film: muted, out: video, seconds, music: { file: music.track.file, start: music.plan.start, refDb: music.track.refDb, vocals: music.track.vocals }, sfx, workDir: outDir });
  } else {
    renderSoundtrack(wav, { bpm: storyboard.bpm, seconds, cuts, seed: hash(storyboard.id) });
    // AAC 48k stereo + faststart: what Instagram's uploader re-encodes from with the least damage.
    ffmpeg(["-i", muted, "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", video]);
  }
  fs.rmSync(muted, { force: true });

  // Cover frame: the end of the hook, when the headline is fully on screen.
  const poster = path.join(outDir, "cover.jpg");
  const hookEnd = reelTimeline(storyboard)[0];
  await renderer.renderStill({ serveUrl, composition, inputProps, frame: Math.max(0, hookEnd.dur - 4), output: poster, imageFormat: "jpeg", jpegQuality: 92, ...browserOpts() });
  return { video, poster, seconds, music, bpm: storyboard.bpm };
}

/** Stills at the end of every scene (text fully revealed), for QA and contact sheets. */
async function renderReelStills(storyboard, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const inputProps = { storyboard };
  const { renderer, serveUrl, composition } = await selectComp("Reel", inputProps);
  const files = [];
  for (const [i, s] of reelTimeline(storyboard).entries()) {
    const file = path.join(outDir, `scene-${String(i + 1).padStart(2, "0")}.jpg`);
    await renderer.renderStill({ serveUrl, composition, inputProps, frame: Math.max(s.from, s.from + s.dur - 6), output: file, imageFormat: "jpeg", jpegQuality: 85, ...browserOpts() });
    files.push(file);
  }
  return files;
}

async function renderCarousel(storyboard, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const files = [];
  for (let i = 0; i < storyboard.slides.length; i++) {
    const inputProps = { storyboard, slide: i };
    const { renderer, serveUrl, composition } = await selectComp("Slide", inputProps);
    const file = path.join(outDir, `slide-${String(i + 1).padStart(2, "0")}.jpg`);
    await renderer.renderStill({ serveUrl, composition, inputProps, output: file, imageFormat: "jpeg", jpegQuality: 94, ...browserOpts() });
    files.push(file);
  }
  logger.info(`Factory: rendered ${files.length} carousel slides for ${storyboard.id}.`);
  return { slides: files };
}

/** Side-by-side contact sheet of stills (for the review queue and QA). */
function contactSheet(files, out, height = 640) {
  if (!files.length) return null;
  const inputs = files.flatMap((f) => ["-i", f]);
  const chain = files.map((_, i) => `[${i}]scale=-1:${height}[s${i}]`).join(";");
  const stack = files.map((_, i) => `[s${i}]`).join("") + `hstack=${files.length}`;
  ffmpeg([...inputs, "-filter_complex", files.length > 1 ? `${chain};${stack}` : `[0]scale=-1:${height}`, "-q:v", "3", out]);
  return out;
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

module.exports = { renderReel, renderReelStills, renderCarousel, contactSheet, ffmpeg, FACTORY_DIR };
