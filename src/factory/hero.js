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
const assetsLib = require("./assets");

const browserFlag = () => (config.factory.browserExecutable ? ` --browser-executable=${config.factory.browserExecutable}` : "");

function engineBlock(engine) {
  if (engine === "hyperframes") {
    return `ENGINE: HyperFrames (HeyGen). If the hyperframes skill is installed, invoke it first and follow it.
- Create the project here: npx hyperframes init film  (then work inside ./film)
- Root composition: data-width="1080" data-height="1920", 30 fps, GSAP timelines paused and registered on window.__timelines.
- Load every font from local files or @fontsource (npm install it); never rely on system fonts.
- Check stills, then render with npx hyperframes render, and write the result without audio to out/hero.muted.mp4 (ffmpeg -i <render>.mp4 -an -c:v copy out/hero.muted.mp4).`;
  }
  return `ENGINE: Remotion. You are inside a copy of our Remotion package. src/ holds house templates (brand.ts, lib/anim.ts, fx/fx.tsx, lib/FontGate.tsx): raw material you may borrow helpers from, NOT a look to repeat. Install any extra @fontsource or @remotion/* package you need with npm install --ignore-scripts: node_modules is a shared install, and adding to it is expected. The Remotion skills, if installed, apply.
- Put the film in src/hero/ with its own index.ts that calls registerRoot and registers a composition with id "Hero" (1080x1920, 30 fps).
- Check stills: npx remotion still src/hero/index.ts Hero out/check-N.png --frame=F${browserFlag()}
- Render: npx remotion render src/hero/index.ts Hero out/hero.muted.mp4 --muted --crf=18${browserFlag()}`;
}

// Headless run: anything outside this list is refused, so the prompt spells it out for the agent.
const ALLOWED_TOOLS = [
  "Read", "Write", "Edit", "Glob", "Grep", "Skill",
  "Bash(npx remotion:*)", "Bash(npx hyperframes:*)", "Bash(npx tsc:*)", "Bash(npm install --ignore-scripts:*)",
  "Bash(ffmpeg:*)", "Bash(ffprobe:*)", "Bash(node shot.cjs:*)", "Bash(ls:*)", "Bash(mkdir:*)", "Bash(cp:*)",
];
// Not a sandbox: ffmpeg/cp can still touch any path the user can. What it does rule out is
// running arbitrary code (no bare node, no npm lifecycle scripts) if third-party text in the
// prompt (articles, linked pages, scraped gallery prompts) tries to steer the agent.
const allowedCommands = ALLOWED_TOOLS.filter((t) => t.startsWith("Bash(")).map((t) => t.slice(5, -3)).join(", ");

const PROMPT_INLINE = 15000;
const clip = (text, file) => (text.length > PROMPT_INLINE ? `${text.slice(0, PROMPT_INLINE)}\n... (continues: read ${file})` : text);

const SHOT_TOOL = path.resolve(__dirname, "shot.js");

/** The REAL MATERIAL block: captures of the pages the article links to, and how to use them. */
function materialBlock(assets, engine, hosts) {
  const where = engine === "remotion" ? `public/assets/<id>.jpg, loaded with staticFile("assets/<id>.jpg")` : "assets/<id>.jpg here; copy what you use into the film project";
  const list = assets.map((a) => `- ${a.id} (${a.kind}, ${a.width}x${a.height}) ${a.title ? `"${a.title.slice(0, 80)}" ` : ""}${a.url}`).join("\n");
  return `REAL MATERIAL (captured from the pages this article links to; files at ${where})
${list || "- none captured"}
desktop = 1440-wide viewport (dark scheme), card = 900-wide close-up whose text reads at phone size, mobile = full-length phone page to scroll through, image = the page's own share image.
A film that shows the real thing beats a pure abstraction: when the subject has a real page (a repo, docs, the blog post), show it. Put it in a browser or phone frame you draw, push in on the exact region that matters (crop by pixel coordinates), scroll a mobile capture, light up one line, or cut a mask from it, and mix it with designed motion. Screenshot text is texture: anything the viewer must read is set in your own type from FIXED WORDING. Never fake a UI, never alter what a capture shows, and never zoom into a number (stars, counts) as if it were a claim.
More captures: node shot.cjs <url> out/<name>.jpg [--mobile] [--card] [--light] (only these hosts: ${hosts.join(", ")}).`;
}

function heroPrompt({ storyboard, article, references, catalog = "", assets = [], engine, skills, avoid }) {
  const seconds = Math.round((storyboard.scenes.reduce((a, s) => a + s.beats, 0) * 60) / storyboard.bpm);
  const copy = storyboard.scenes
    .map((s, i) => {
      const { type, beats, ...rest } = s;
      return `${i + 1}. [${type}, ~${beats} beats] ${JSON.stringify(rest)}`;
    })
    .join("\n");
  const refs = references
    .map((r) => `- ${r.title}: ${r.why || ""}${r.repoDir || r.srcDir ? `\n  Code you may read for technique: ${r.repoDir || r.srcDir}` : ""}\n  Prompt it came from:\n${clip(r.prompt, r.promptFile).split("\n").map((l) => `    ${l}`).join("\n")}`)
    .join("\n");
  return `You are a top-tier motion designer and engineer. Make one Instagram Reel as a film rendered in code, mixing designed motion with real material from the article's sources.
${skills.length ? `\nSKILLS: before building, invoke these if they are installed: ${skills.join(", ")}.\n` : ""}
GOAL
A ~${seconds}-second reel that teaches one concrete thing from the article below to engineers, readable with sound off.
It must look like NO other film on this channel. Invent a look for THIS subject: one visual idea drawn from the subject itself (a relay object handed between shots, a physical metaphor, a single impossible camera move, a diagram that builds itself, a material or texture), its own palette, its own type pairing, and its own signature technique (for example SVG line-drawing, a WebGL shader field, isometric 3D, paper cut-out, terminal/ASCII, a data-viz morph, kinetic type only, photographic textures you build in code). Carry the idea through every cut.

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

${materialBlock(assets, engine, assetsLib.allowedHosts(article))}

TIMING
${storyboard.bpm} bpm, cuts on beats. Every frame is a pure function of the frame number: no CSS transitions, no timers, no unseeded randomness. Springs and named easings only.

BANNED
Stock imagery, robots/brains/circuit-board clichés, purple-blue neon, glassmorphism, spinning logos, fake dashboards or invented UI, your own text smaller than 34 px, more than 3 colours plus neutrals, anything that copies a recent film above.

REFERENCE LIBRARY (read access: ${library.LIB})
Every film from motionpromptgallery.com and prompt-motion.com plus our own reference repos. Each entry has its full prompt, a 3x3 contact sheet of frames, often the video itself and sometimes the full source code. Study before you design: read the closest prompts below in full, then open at least 3 more entries from the catalog whose craft could serve THIS subject, Read their contact sheets, and read repo code for any technique you borrow (timeline files, scene modules, post-processing). Pull extra frames from a library video with ffmpeg into out/ if you need a closer look. Borrow techniques and structure, never a whole look. Name the entries you drew on in out/treatment.md.

Closest prompts, in full:
${refs || "- (none yet)"}

Full catalog, one line per film: slug | title [model, engine] (what exists): the reusable idea.
Files for a slug: ${library.LIB}/videos/<slug>/prompt.md, contact.jpg, video.mp4. Every path, including repo code, is in LIBRARY.md here.
${catalog || "- (empty)"}

${engineBlock(engine)}

COMMANDS
Use the Bash tool, one command per call, from the workspace root: no cd, no &&/; chains, no PowerShell. Those need approval nobody is there to give. Allowed: ${allowedCommands}.
The reference library is read-only: never write inside it.
Fonts: npm install --ignore-scripts @fontsource/<name> or @fontsource-variable/<name>. Never use a system font (Arial, Bahnschrift, Segoe, Helvetica...): the film must render the same on any machine.

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
${article.text.slice(0, 16000)}`;
}

function prepareWorkspace(workDir, engine) {
  fs.mkdirSync(workDir, { recursive: true });
  // A same-day retry reuses the job dir: never let a previous attempt's film or render leak in.
  for (const stale of ["out", "src/hero", "film"]) fs.rmSync(path.join(workDir, stale), { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  if (engine === "remotion") {
    for (const entry of ["src", "package.json", "package-lock.json", "tsconfig.json", "remotion.config.ts"]) {
      if (fs.existsSync(path.join(FACTORY_DIR, entry))) fs.cpSync(path.join(FACTORY_DIR, entry), path.join(workDir, entry), { recursive: true });
    }
    // Shared install keeps a run fast. A junction needs no admin rights or Developer Mode on Windows.
    const nm = path.join(workDir, "node_modules");
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(FACTORY_DIR, "node_modules"), nm, process.platform === "win32" ? "junction" : "dir");
  }
  fs.mkdirSync(path.join(workDir, "out"), { recursive: true });
  // The only node the agent may run: this launcher for the screenshot tool (see ALLOWED_TOOLS).
  fs.writeFileSync(path.join(workDir, "shot.cjs"), `require(${JSON.stringify(SHOT_TOOL)});\n`);
}

const ENGINE_STATE = path.join(require("./queue").STATE_DIR, "engine.json");

/** Alternates engines by the last ATTEMPT (not the last success), so a failing engine never repeats forever. */
function pickEngine() {
  if (config.factory.heroEngine !== "auto") return config.factory.heroEngine;
  let last = null;
  try { last = JSON.parse(fs.readFileSync(ENGINE_STATE, "utf8")).last; } catch { last = novelty.recent().find((r) => r.look)?.look?.engine || null; }
  const next = last === "remotion" ? "hyperframes" : "remotion";
  try { fs.mkdirSync(path.dirname(ENGINE_STATE), { recursive: true }); fs.writeFileSync(ENGINE_STATE, JSON.stringify({ last: next, at: new Date().toISOString() })); } catch { /* best effort */ }
  return next;
}

/** The library is read-only for the agent: snapshot it with git and restore anything it changed. */
function guardLibrary() {
  const git = (args) => spawnSync("git", ["-C", path.resolve(library.LIB, "../.."), ...args], { encoding: "utf8", timeout: 60000 });
  const scope = ["--", "factory/library/videos", "factory/library/patterns.json"];
  const cleanBefore = git(["status", "--porcelain", ...scope]).stdout === "";
  return () => {
    if (!cleanBefore) return;
    if (git(["status", "--porcelain", ...scope]).stdout === "") return;
    logger.warn("Factory agent changed the reference library; restoring it from git.");
    git(["checkout", "--", ...scope.slice(1)]);
    git(["clean", "-fdq", ...scope]);
  };
}

/** Real duration of a video in seconds, or 0 when it cannot be read. */
function probeSeconds(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 30000 });
  const s = Number(String(out.stdout || "").trim());
  return Number.isFinite(s) && s > 0 ? s : 0;
}

/** @returns {Promise<{video:string, poster:string, look:object, costUsd:number}>} */
async function makeHero({ storyboard, article, outDir, assets = [] }) {
  const engine = pickEngine();
  const workDir = path.join(outDir, `agent-${engine}`);
  prepareWorkspace(workDir, engine);
  const assetDir = path.join(workDir, engine === "remotion" ? "public/assets" : "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  for (const a of assets) if (fs.existsSync(a.file)) fs.copyFileSync(a.file, path.join(assetDir, `${a.id}.jpg`));
  const refs = library.heroReferences(article);
  fs.writeFileSync(path.join(workDir, "LIBRARY.md"), `# Reference library\n\n${library.catalog()}\n`);
  const prompt = heroPrompt({ storyboard, article, references: refs, catalog: library.catalog({ compact: true }), assets, engine, skills: config.factory.heroSkills, avoid: novelty.looksToAvoid() });
  fs.writeFileSync(path.join(outDir, "agent-prompt.md"), prompt);

  const args = claudeArgs(["--permission-mode", "acceptEdits", "--allowedTools", ...ALLOWED_TOOLS, "--add-dir", library.LIB, ...(engine === "remotion" ? ["--add-dir", path.join(FACTORY_DIR, "node_modules")] : [])]);

  logger.info(`Factory agent: Opus (${config.factory.claudeEffort}) is building ${storyboard.id} with ${engine} in ${workDir} ...`);
  const started = Date.now();
  // stream-json streams the transcript into agent.log while the agent works (tail -f it).
  const logFile = path.join(outDir, "agent.log");
  const restoreLibrary = guardLibrary();
  let text;
  let raw;
  try {
    ({ text, raw } = await runClaude(args, { input: prompt, cwd: workDir, timeoutMs: config.factory.heroTimeoutMs, logFile, stream: true, env: { FACTORY_SHOT_HOSTS: assetsLib.allowedHosts(article).join(",") } }));
  } finally {
    restoreLibrary();
  }
  logger.info(`Factory agent: finished in ${Math.round((Date.now() - started) / 60000)} min: ${text.slice(0, 120)}`);
  const verdict = text.replace(/[*_`#>]/g, "");
  if (/^\s*FAILED\b/im.test(verdict)) throw new Error(`Agent gave up: ${text.slice(0, 300)}`);

  // The film itself is the proof: it must exist and be a readable video of a sane length.
  const muted = path.join(workDir, "out/hero.muted.mp4");
  if (!fs.existsSync(muted)) throw new Error(`Agent finished without out/hero.muted.mp4: ${text.slice(0, 200)}`);
  const seconds = probeSeconds(muted);
  if (seconds < 5 || seconds > 180) throw new Error(`out/hero.muted.mp4 is ${seconds ? `${seconds.toFixed(1)} s` : "unreadable"}; expected a 5-180 s film.`);
  if (!/^\s*DONE\b/im.test(verdict)) logger.warn(`Factory agent: no DONE line, but the film is valid (${seconds.toFixed(1)} s); using it.`);
  let cues = {};
  try { cues = JSON.parse(fs.readFileSync(path.join(workDir, "out/cues.json"), "utf8")); } catch { /* fall back below */ }
  // Length comes from the real file: a wrong cues.seconds must never cut the end of the film.
  const wav = path.join(outDir, "soundtrack.wav");
  renderSoundtrack(wav, { bpm: Number(cues.bpm) || storyboard.bpm, seconds, cuts: Array.isArray(cues.cuts) ? cues.cuts : [], seed: Date.now() % 100000 });
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
  try { look = { ...JSON.parse(fs.readFileSync(path.join(workDir, "out/look.json"), "utf8")), engine }; } catch { /* optional */ }
  return { video, poster, look, costUsd: raw?.total_cost_usd || 0 };
}

module.exports = { makeHero, heroPrompt };
