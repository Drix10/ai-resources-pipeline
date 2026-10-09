/**
 * Agent mode (the default): your LOCAL Claude Code (Opus 5.5, --effort xhigh, your Claude sign-in,
 * no API key) writes a one-off film in code for every reel, the way the motionpromptgallery /
 * prompt-motion pieces and the two reference repos were made.
 *
 * Every film gets its own look: the agent is shown the looks of the recent films (novelty.js)
 * and must invent a different visual idea, palette, type pairing and technique, then record
 * its choice in out/look.json for the next film to avoid.
 *
 * Engines (FACTORY_HERO_ENGINE):
 *  - remotion    (default) a throwaway copy of factory/ (brand, anim lib, templates as raw material)
 *  - hyperframes HeyGen HyperFrames (HTML + GSAP -> MP4); needs the hyperframes plugin/CLI
 *  - auto        alternate between the two
 * Skills: FACTORY_HERO_SKILLS lists slash skills to invoke when installed in your Claude Code.
 *
 * Guardrails that keep it a pipeline step:
 *  - Runs in a per-piece workspace under the job dir, never in the repo.
 *  - Fixed wording: on-screen words come from a storyboard that already passed the fact gates.
 *  - Tools limited to file edits plus remotion / hyperframes / ffmpeg / node commands.
 *  - Our soundtrack synth scores it from the agent's cue file, so audio stays original.
 *  - Time-boxed (FACTORY_HERO_TIMEOUT_MS).
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const library = require("./library");
const { FACTORY_DIR, ffmpeg } = require("./render");
const { renderSoundtrack } = require("./soundtrack");
const { THEME_NOTE } = require("./theme-note");
const { runClaude, claudeArgs } = require("./opus");
const novelty = require("./novelty");

const browserFlag = () => (config.factory.browserExecutable ? ` --browser-executable=${config.factory.browserExecutable}` : "");

function engineBlock(engine) {
  if (engine === "hyperframes") {
    return `ENGINE: HyperFrames (HeyGen). If the hyperframes skill is installed, invoke it first and follow it.
- Create the project here: npx hyperframes init film  (then work inside ./film)
- Root composition: data-width="1080" data-height="1920", 30 fps, GSAP timelines paused and registered on window.__timelines.
- Plates (if any) are in ./public/plates; copy them into the project's assets.
- Load every font from local files or @fontsource; never rely on system fonts.
- Check stills, then render with npx hyperframes render, and write the result without audio to out/hero.muted.mp4 (ffmpeg -i <render>.mp4 -an -c:v copy out/hero.muted.mp4).`;
  }
  return `ENGINE: Remotion. You are inside a copy of our Remotion package. src/ holds house templates (brand.ts, lib/anim.ts, fx/fx.tsx, lib/FontGate.tsx): raw material you may borrow helpers from, NOT a look to repeat. Install any extra @fontsource or @remotion/* package you need with npm install. The Remotion skills, if installed, apply.
- Put the film in src/hero/ with its own index.ts that calls registerRoot and registers a composition with id "Hero" (1080x1920, 30 fps).
- Plate images (if any) are in public/plates/; load them with staticFile("plates/<id>.jpg").
- Check stills: npx remotion still src/hero/index.ts Hero out/check-N.png --frame=F${browserFlag()}
- Render: npx remotion render src/hero/index.ts Hero out/hero.muted.mp4 --muted --crf=18${browserFlag()}`;
}

function heroPrompt({ storyboard, article, references, engine, skills, avoid }) {
  const seconds = Math.round((storyboard.scenes.reduce((a, s) => a + s.beats, 0) * 60) / storyboard.bpm);
  const copy = storyboard.scenes
    .map((s, i) => {
      const { type, beats, plate, ...rest } = s;
      return `${i + 1}. [${type}, ~${beats} beats${plate ? `, plate ${plate}` : ""}] ${JSON.stringify(rest)}`;
    })
    .join("\n");
  const plates = storyboard.plates.filter((p) => p.src).map((p) => `- ${p.id}: ${p.prompt}`).join("\n");
  const refs = references
    .map((r) => `- ${r.title}: ${r.why || ""}${r.srcDir ? `\n  Code you may read for technique: ${r.srcDir}` : ""}\n  Prompt it came from:\n${r.prompt.split("\n").map((l) => `    ${l}`).join("\n")}`)
    .join("\n");
  return `You are a top-tier motion designer and engineer. Make one Instagram Reel as a code-rendered film.
${skills.length ? `\nSKILLS: before building, invoke these if they are installed: ${skills.join(", ")}.\n` : ""}
GOAL
A ~${seconds}-second reel that teaches one concrete thing from the article below to engineers, readable with sound off.
It must look like NO other film on this channel. Invent a look for THIS subject: one visual idea drawn from the subject itself (a relay object handed between shots, a physical metaphor, a single impossible camera move, a diagram that builds itself, a material or texture), its own palette, its own type pairing, and its own signature technique (for example SVG line-drawing, a WebGL shader field, isometric 3D, paper cut-out, terminal/ASCII, a data-viz morph, kinetic type only, photo plates with masks). Carry the idea through every cut.

FORMAT
1080x1920, 30 fps. All text inside x 84..930, y 230..1520 (Instagram UI covers the rest). The last frame should loop cleanly into the first.

BRAND ANCHORS (the only fixed parts)
- End on a follow lockup: ${storyboard.author}, ${storyboard.handle}.
- Text must be crisp, large (>= 34 px) and high-contrast. Everything else is yours to choose.
House defaults you MAY use if they suit this subject (do not reach for them out of habit):
${THEME_NOTE}

RECENT FILMS ON THE CHANNEL: do not reuse their visual idea, palette, type pairing or signature technique.
${avoid}

FIXED WORDING (use these words and numbers exactly; you may split lines across beats and drop at most one non-hook line; never add claims, numbers or names):
${copy}

PLATES (generated stills, textless; use as backgrounds or textures, or ignore)
${plates || "- none"}

TIMING
${storyboard.bpm} bpm, cuts on beats. Every frame is a pure function of the frame number: no CSS transitions, no timers, no unseeded randomness. Springs and named easings only.

BANNED
Stock imagery, robots/brains/circuit-board clichés, purple-blue neon, glassmorphism, spinning logos, fake dashboards, text baked into images, text smaller than 34 px, more than 3 colours plus neutrals, anything that copies a recent film above.

REFERENCES FROM OUR LIBRARY
${refs || "- (none yet)"}

${engineBlock(engine)}

PROCESS
1. Write out/treatment.md (the one visual idea and a beat sheet with frame numbers) and out/look.json:
   {"idea": "<one line>", "palette": ["#hex", "..."], "fonts": ["Display face", "Text face"], "technique": "<one line>", "engine": "${engine}"}
2. Build it.
3. Render one still per beat-sheet line and LOOK at every one. Fix clipped or cramped text, contrast, orphan words, empty frames. Repeat until clean.
4. Render the muted film to out/hero.muted.mp4.
5. Write out/cues.json: {"bpm": ${storyboard.bpm}, "seconds": <exact duration>, "cuts": [<every cut time in seconds>]}. The soundtrack is synthesized from it.
6. Your final reply is one line: DONE, or FAILED: <reason>.

ARTICLE (source of truth, for context)
${article.title}
${article.text.slice(0, 6000)}`;
}

function prepareWorkspace(workDir, engine) {
  fs.mkdirSync(workDir, { recursive: true });
  if (engine === "remotion") {
    for (const entry of ["src", "package.json", "tsconfig.json", "remotion.config.ts"]) {
      fs.cpSync(path.join(FACTORY_DIR, entry), path.join(workDir, entry), { recursive: true });
    }
    // Shared install keeps a run fast; the agent may still npm install extras (they land in the shared tree).
    const nm = path.join(workDir, "node_modules");
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(FACTORY_DIR, "node_modules"), nm, "dir");
  }
  // A same-day retry reuses the job dir: never let a previous attempt's render pass for this one.
  fs.rmSync(path.join(workDir, "out"), { recursive: true, force: true });
  fs.mkdirSync(path.join(workDir, "out"), { recursive: true });
  fs.mkdirSync(path.join(workDir, "public/plates"), { recursive: true });
}

function pickEngine() {
  if (config.factory.heroEngine !== "auto") return config.factory.heroEngine;
  // Alternate engines so consecutive films come from different toolkits.
  const last = novelty.recent().find((r) => r.look)?.look?.engine;
  return last === "remotion" ? "hyperframes" : "remotion";
}

/** @returns {Promise<{video:string, poster:string, look:object, costUsd:number}>} */
async function makeHero({ storyboard, article, outDir }) {
  const engine = pickEngine();
  const workDir = path.join(outDir, `agent-${engine}`);
  prepareWorkspace(workDir, engine);
  for (const p of storyboard.plates) {
    if (p.file && fs.existsSync(p.file)) fs.copyFileSync(p.file, path.join(workDir, "public/plates", `${p.id}.jpg`));
  }
  const refs = library.heroReferences(article);
  const prompt = heroPrompt({ storyboard, article, references: refs, engine, skills: config.factory.heroSkills, avoid: novelty.looksToAvoid() });
  fs.writeFileSync(path.join(outDir, "agent-prompt.md"), prompt);

  const allowed = [
    "Read", "Write", "Edit", "Glob", "Grep", "Skill",
    "Bash(npx remotion:*)", "Bash(npx hyperframes:*)", "Bash(npm install:*)", "Bash(ffmpeg:*)", "Bash(ffprobe:*)",
    "Bash(node:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cp:*)",
  ];
  const addDirs = refs.map((r) => r.srcDir).filter(Boolean);
  const args = claudeArgs(["--permission-mode", "acceptEdits", "--allowedTools", ...allowed, ...(addDirs.length ? ["--add-dir", ...addDirs] : [])]);

  logger.info(`Factory agent: Opus (${config.factory.claudeEffort}) is building ${storyboard.id} with ${engine} in ${workDir} ...`);
  const started = Date.now();
  // stream-json streams the transcript into agent.log while the agent works (tail -f it).
  const logFile = path.join(outDir, "agent.log");
  const { text, raw } = await runClaude(args, { input: prompt, cwd: workDir, timeoutMs: config.factory.heroTimeoutMs, logFile, stream: true });
  logger.info(`Factory agent: finished in ${Math.round((Date.now() - started) / 60000)} min: ${text.slice(0, 120)}`);
  if (/^\s*FAILED\b/m.test(text) || !/^\s*DONE\b/m.test(text)) throw new Error(`Agent did not finish: ${text.slice(0, 300)}`);

  const muted = path.join(workDir, "out/hero.muted.mp4");
  if (!fs.existsSync(muted)) throw new Error("Agent reported DONE but out/hero.muted.mp4 is missing.");
  let cues = {};
  try { cues = JSON.parse(fs.readFileSync(path.join(workDir, "out/cues.json"), "utf8")); } catch { /* fall back below */ }
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", muted], { encoding: "utf8" });
  const seconds = Number(cues.seconds) || Number(probe.stdout) || 20;
  const wav = path.join(outDir, "soundtrack.wav");
  renderSoundtrack(wav, { bpm: Number(cues.bpm) || storyboard.bpm, seconds, cuts: (cues.cuts || []).map(Number).filter(Number.isFinite), seed: Date.now() % 100000 });
  const video = path.join(outDir, "reel.mp4");
  // Re-encode to Instagram's sweet spot whatever the engine produced (1080x1920, 30 fps, yuv420p).
  ffmpeg(["-i", muted, "-i", wav, "-map", "0:v", "-map", "1:a", "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", video]);
  const poster = path.join(outDir, "cover.jpg");
  ffmpeg(["-ss", String(Math.min(2.5, seconds / 4)), "-i", video, "-frames:v", "1", "-q:v", "3", poster]);
  for (const f of ["treatment.md", "look.json"]) {
    const src = path.join(workDir, "out", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
  }
  let look = { engine };
  try { look = { engine, ...JSON.parse(fs.readFileSync(path.join(workDir, "out/look.json"), "utf8")) }; } catch { /* optional */ }
  return { video, poster, look, costUsd: raw?.total_cost_usd || 0 };
}

module.exports = { makeHero, heroPrompt };
