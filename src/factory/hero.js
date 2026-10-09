/**
 * Agent pieces: your LOCAL Claude Code (Opus 5.5, --effort xhigh, your Claude sign-in, no API
 * key) builds every reel AND every carousel as a one-off piece in code, the way the
 * motionpromptgallery / prompt-motion pieces and the reference repos were made.
 *
 * The brief is a director's prompt written for this story (director.js): references picked
 * from the whole library, their techniques remixed around one concept from the subject, held to
 * THE BAR (P(doom) and Tessel show the level, not a template). Every piece records its form and
 * look in out/look.json, and the next one is told not to reuse them.
 *
 * Engines (FACTORY_HERO_ENGINE), for reels; carousels are always Remotion stills:
 *  - remotion    a throwaway copy of factory/ (brand, anim lib, templates as raw material)
 *  - hyperframes HeyGen HyperFrames (HTML + GSAP -> MP4); needs the hyperframes plugin/CLI
 *  - auto        alternate between the two
 * Skills: FACTORY_HERO_SKILLS lists slash skills to invoke when installed in your Claude Code.
 *
 * Guardrails that keep it a pipeline step:
 *  - Runs in a per-piece workspace under the job dir, never in the repo.
 *  - Fixed wording: on-screen words come from a storyboard that already passed the fact gates.
 *  - Tools limited to file edits plus remotion / hyperframes / ffmpeg and the screenshot tool.
 *  - Sound is ours: music from factory/library/music (chosen and beat-mapped before the build),
 *    code-synthesized SFX from the agent's cue file, the voice, captions; mixed in mix.js.
 *  - Time-boxed (FACTORY_HERO_TIMEOUT_MS); the library is restored if the agent touches it.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");
const library = require("./library");
const { FACTORY_DIR, ffmpeg } = require("./render");
const { renderSoundtrack } = require("./soundtrack");
const { musicBlock } = require("./music");
const { renderSfx, normalizeEvents, KINDS: SFX_KINDS } = require("./sfx");
const { mixReel, speechWindows, accentFrom } = require("./mix");
const { THEME_NOTE } = require("./theme-note");
const { runClaude, claudeArgs } = require("./opus");
const novelty = require("./novelty");
const assetsLib = require("./assets");
const { CRAFT_BAR, copyLines, voiceBlock, filmSeconds } = require("./director");

const browserFlag = () => (config.factory.browserExecutable ? ` --browser-executable=${config.factory.browserExecutable}` : "");

function engineBlock(engine, format, slides) {
  if (format === "carousel") {
    return `ENGINE: Remotion stills. You are inside a copy of our Remotion package. src/ holds house templates (brand.ts, lib/anim.ts, fx/fx.tsx, lib/FontGate.tsx): raw material you may borrow helpers from, NOT a look to repeat. Install any extra @fontsource, @remotion/* or three package you need with npm install --ignore-scripts: node_modules is a shared install, and adding to it is expected. The Remotion skills, if installed, apply.
- Put the carousel in src/slides/ with its own index.ts that calls registerRoot and registers a composition with id "Slides": 1080x1350, fps 30, durationInFrames ${slides}. Frame i is slide i+1; each slide is a still, fully deterministic.
- Render every slide: npx remotion still src/slides/index.ts Slides out/slide-01.png --frame=0${browserFlag()} (then --frame=1 to out/slide-02.png, and so on, through out/slide-${String(slides).padStart(2, "0")}.png).`;
  }
  if (engine === "hyperframes") {
    return `ENGINE: HyperFrames (HeyGen). If the hyperframes skill is installed, invoke it first and follow it.
- Create the project here: npx hyperframes init film. Edit its files at ./film/...; you never need cd: every command takes the project path.
- Root composition: data-width="1080" data-height="1920", 30 fps, GSAP timelines paused and registered on window.__timelines.
- Load every font from local files or @fontsource (npm install --ignore-scripts); never rely on system fonts.
- Check frames: npx hyperframes check ./film --at <seconds,...>. Render: npx hyperframes render ./film --output out/film.mp4, then strip audio: ffmpeg -i out/film.mp4 -an -c:v copy out/hero.muted.mp4`;
  }
  return `ENGINE: Remotion. You are inside a copy of our Remotion package. src/ holds house templates (brand.ts, lib/anim.ts, fx/fx.tsx, lib/FontGate.tsx): raw material you may borrow helpers from, NOT a look to repeat. Install any extra @fontsource, @remotion/* (e.g. @remotion/three, @remotion/paths, @remotion/noise) or three package you need with npm install --ignore-scripts: node_modules is a shared install, and adding to it is expected. The Remotion skills, if installed, apply.
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

const SHOT_TOOL = path.resolve(__dirname, "shot.js");
// The films we hold up as the level to reach (never as a look to copy).
const GOLD = ["pdoom-music-video", "tessel-launch"];

/** The REAL MATERIAL block: captures of the pages the article links to, and how to use them. */
function materialBlock(assets, engine, hosts) {
  const where = engine === "remotion" ? `public/assets/<id>.jpg, loaded with staticFile("assets/<id>.jpg")` : "assets/<id>.jpg here; copy what you use into the film project";
  const list = assets.map((a) => `- ${a.id} (${a.kind}, ${a.width}x${a.height}) ${a.title ? `"${a.title.slice(0, 80)}" ` : ""}${a.url}`).join("\n");
  return `REAL MATERIAL (captured from the pages this article links to; files at ${where})
${list || "- none captured"}
desktop = 1440-wide viewport (dark scheme), card = 900-wide close-up whose text reads at phone size, mobile = full-length phone page to scroll through, image = the page's own share image.
When the subject has a real page (a repo, docs, the blog post), showing the real thing beats an abstraction: frame it inside the world you build (a screen, a printout, a device, a wall), push in on the exact region that matters (crop by pixel coordinates), scroll a mobile capture, light up one line, or cut a mask from it. Screenshot text is texture: anything the viewer must read is set in your own type from FIXED WORDING. Never fake a UI, never alter what a capture shows, and never zoom into a number (stars, counts) as if it were a claim.
More captures: node shot.cjs <url> out/<name>.jpg [--mobile] [--card] [--light] (only these hosts: ${hosts.join(", ")}).`;
}

/** One line per reference with every file the agent can open for it. */
function referenceLines(refs) {
  return refs.map((r) => {
    const files = [r.promptFile && `prompt ${r.promptFile}`, r.contact && `frames ${r.contact}`, r.video && `video ${r.video}`, (r.repoDir || r.srcDir) && `code ${r.repoDir || r.srcDir}`].filter(Boolean).join(" | ");
    return `- ${r.slug}: ${r.title}${r.steal ? `\n  TAKE: ${r.steal}` : ""}\n  ${files}`;
  }).join("\n");
}

/** Sound design and captions: what the agent hands the mix (out/cues.json). */
function soundBlock(voice) {
  return `SOUND DESIGN (you design it; we synthesize and mix it, so render the film muted)
- In out/cues.json list an "sfx" event wherever your motion lands: {"t": <seconds>, "kind": "${SFX_KINDS.join("|")}", "weight": 0..1}. whoosh = a camera move, slide or wipe (peaks on t); impact = a slam, stamp or hard cut; boom = the one big reveal; riser / swell = a build that ENDS on t; tick = counters or typing beats; pop = an element appearing; glitch = a glitch cut; shutter = a screenshot or capture; type = a keystroke. Fewer, well-placed sounds beat a sound on everything: 6-20 for a 30 s film.${voice ? `
- CAPTIONS: viewers watch muted, so the spoken words must be on screen. Either build them into the film (2-4 words at a time from voice.json, the spoken word lit, styled as part of your design, inside the safe area, never over the key visual) and set "captions": true, or set "captions": false and keep the band y 1260..1480 free of anything important: we burn standard word-by-word captions there.` : ""}`;
}

function heroPrompt({ storyboard, article, references = [], director = null, assets = [], engine, skills, avoid, voice = null, music = null }) {
  const format = storyboard.format === "carousel" ? "carousel" : "reel";
  const slides = storyboard.slides.length;
  const seconds = format === "reel" ? filmSeconds(storyboard, voice) : 0;
  const gold = library.videos().filter((v) => GOLD.includes(v.slug));
  const what = format === "reel" ? `one Instagram Reel: a ~${seconds}-second film` : `one Instagram carousel: ${slides} designed slides`;
  const steps = format === "reel"
    ? `1. Read the director's prompt, then the references' prompts, frames and code for every technique it names. Write out/treatment.md (your plan: form, through-line, sections with frame numbers, techniques and where each comes from) and out/look.json:
   {"form": "<one line>", "idea": "<one line>", "palette": ["#hex", "..."], "fonts": ["Display face", "Text face"], "technique": "<one line>", "engine": "${engine}"}
2. Build it.
3. Render one still per section and LOOK at every one against THE BAR and the director's CHECKS. Anything that reads as text on a background, a card, a list or a centred stat is a failure: rebuild that section. Fix clipped or cramped text, contrast, orphan words, empty frames. Repeat until every still would stop a scroll.
4. Render the muted film to out/hero.muted.mp4.
5. Write out/cues.json: {"bpm": ${storyboard.bpm}, "seconds": <exact duration>, "cuts": [<every cut time in seconds>], "sfx": [<events, see SOUND DESIGN>]${voice ? `, "captions": true|false` : ""}}. Music, voice and effects are mixed from it.
6. Your final reply is one line: DONE, or FAILED: <reason>.`
    : `1. Read the director's prompt, then the references' prompts, frames and code for every technique it names. Write out/treatment.md (your plan: form, through-line, slide by slide, techniques and where each comes from) and out/look.json:
   {"form": "<one line>", "idea": "<one line>", "palette": ["#hex", "..."], "fonts": ["Display face", "Text face"], "technique": "<one line>", "engine": "remotion"}
2. Build it.
3. Render all ${slides} slides and LOOK at every one against THE BAR and the director's CHECKS. Slide 1 must stop a scroll on its own. Anything that reads as text on a background, a card, a list or a centred stat is a failure: rebuild that slide. Fix clipped or cramped text, contrast and orphan words. Repeat until every slide is worth saving.
4. Leave exactly out/slide-01.png .. out/slide-${String(slides).padStart(2, "0")}.png (1080x1350).
5. Your final reply is one line: DONE, or FAILED: <reason>.`;
  return `You are a world-class motion designer and engineer. Build ${what}, in code, to the director's prompt below.
${skills.length ? `\nSKILLS: before building, invoke these if they are installed: ${skills.join(", ")}.\n` : ""}
DIRECTOR'S PROMPT (your brief: build THIS. Where your own stills show a better choice, improve it, but keep its concept, form, palette and message)
${director || "(none this time: before building, write your own director's prompt to THE BAR into out/treatment.md: concept, form, through-line, palette, type system, sections, techniques credited to the references)"}

${CRAFT_BAR}

CONTRACT (not negotiable)
FIXED WORDING (use these words and numbers exactly; ${format === "reel" ? "you may split lines across beats and drop at most one non-hook line" : "one slide per entry, in this order, none dropped or added"}; never add claims, numbers or names. The type label only says what each line is: it is NOT a layout):
${copyLines(storyboard)}
- Format: ${format === "reel" ? "1080x1920, 30 fps. All text inside x 84..930, y 230..1520 (Instagram UI covers the rest). The last frame loops cleanly into the first." : "1080x1350 stills. All text inside x 72..1008, y 96..1250."}
- End on a follow lockup: ${storyboard.author}, ${storyboard.handle}.
- Your own type is crisp, large (>= 34 px) and high-contrast.
- No stock imagery except the VISUAL LIBRARY's clips, used the way it says. No robots/brains/circuit boards, purple-blue neon, glassmorphism, spinning logos, invented UI or fake dashboards, emoji. No copying a reference or a recent piece.
- House defaults you MAY use only if they suit this piece: ${THEME_NOTE}

RECENT PIECES ON THE CHANNEL (do not reuse their form, idea, palette, type pairing or technique):
${avoid}

${materialBlock(assets, format === "carousel" ? "remotion" : engine, assetsLib.allowedHosts(article))}
${format === "reel" ? `\n${library.visualsBlock((slug) => `visuals/${slug}.mp4`)}\nTo use a clip, ffmpeg only the part you need into your project, trimmed, scaled and silent (e.g. ffmpeg -ss 2 -t 3 -i visuals/<slug>.mp4 -vf scale=1080:-2 -an ${engine === "remotion" ? "public" : "film"}/<slug>.mp4); never copy the whole folder.\n` : ""}
${voice && format === "reel" ? `\n${voiceBlock(voice)}\n- Word-by-word timings: voice.json here. Do NOT put the voice in the film (it is mixed in afterwards); render the film muted.\n` : ""}${format === "reel" ? `\n${music ? musicBlock(music.track, music.plan) : `TIMING\n${storyboard.bpm} bpm, cuts on beats.`}\nEvery frame is a pure function of the frame number: no CSS transitions, no timers, no unseeded randomness. Springs and named easings only.\n\n${soundBlock(voice)}\n` : ""}
REFERENCES (read access: ${library.LIB}). The director picked these for this piece; open their prompts, frames and code for every technique you use:
${referenceLines(references) || "- (none: browse LIBRARY.md)"}
THE STANDARD (read for the level of craft, never to copy their look): ${referenceLines(gold).replace(/^- /gm, "")}
Every other film in the library, with all its paths: LIBRARY.md here.

${engineBlock(engine, format, slides)}

COMMANDS
Use the Bash tool, one command per call, from the workspace root: no cd, no &&/; chains, no PowerShell. Those need approval nobody is there to give. Allowed: ${allowedCommands}.
The reference library is read-only: never write inside it.
Fonts: npm install --ignore-scripts @fontsource/<name> or @fontsource-variable/<name>. Never use a system font (Arial, Bahnschrift, Segoe, Helvetica...): the piece must render the same on any machine.

PROCESS
${steps}

ARTICLE (source of truth, for context)
${article.title}
${article.text.slice(0, 16000)}`;
}

function prepareWorkspace(workDir, engine) {
  fs.mkdirSync(workDir, { recursive: true });
  // A same-day retry reuses the job dir: never let a previous attempt's piece or render leak in.
  for (const stale of ["out", "src/hero", "src/slides", "film"]) fs.rmSync(path.join(workDir, stale), { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
  if (engine === "remotion") {
    for (const entry of ["src", "package.json", "package-lock.json", "tsconfig.json", "remotion.config.ts"]) {
      if (fs.existsSync(path.join(FACTORY_DIR, entry))) fs.cpSync(path.join(FACTORY_DIR, entry), path.join(workDir, entry), { recursive: true });
    }
    // Shared install keeps a run fast. A junction needs no admin rights or Developer Mode on Windows.
    const nm = path.join(workDir, "node_modules");
    if (!fs.existsSync(nm)) fs.symlinkSync(path.join(FACTORY_DIR, "node_modules"), nm, process.platform === "win32" ? "junction" : "dir");
  }
  fs.mkdirSync(path.join(workDir, "out"), { recursive: true });
  // The visual library's clips, hard-linked (free on the same disk; a copy otherwise). Outside the
  // project's public/ so a bundle never copies all of them: the agent ffmpegs in what it uses.
  const vis = path.join(workDir, "visuals");
  fs.mkdirSync(vis, { recursive: true });
  for (const v of library.visuals()) {
    if (!v.clip) continue;
    const dest = path.join(vis, `${v.slug}.mp4`);
    if (fs.existsSync(dest)) continue;
    try { fs.linkSync(v.clip, dest); } catch { try { fs.copyFileSync(v.clip, dest); } catch { /* the brief marks it missing */ } }
  }
  // The only node the agent may run: this launcher for the screenshot tool (see ALLOWED_TOOLS).
  fs.writeFileSync(path.join(workDir, "shot.cjs"), `require(${JSON.stringify(SHOT_TOOL)});\n`);
}

const ENGINE_STATE = path.join(require("./queue").STATE_DIR, "engine.json");

/** Alternates engines by the last ATTEMPT (not the last success), so a failing engine never repeats forever. */
function pickEngine() {
  if (config.factory.heroEngine !== "auto") return config.factory.heroEngine;
  let last = null;
  try { last = JSON.parse(fs.readFileSync(ENGINE_STATE, "utf8")).last; } catch { last = novelty.recent().find((r) => r.look && r.format !== "carousel")?.look?.engine || null; }
  const next = last === "remotion" ? "hyperframes" : "remotion";
  try { fs.mkdirSync(path.dirname(ENGINE_STATE), { recursive: true }); fs.writeFileSync(ENGINE_STATE, JSON.stringify({ last: next, at: new Date().toISOString() })); } catch { /* best effort */ }
  return next;
}

/**
 * The library is read-only for the agent. Only what changed DURING the run is touched afterwards:
 * tracked files are restored from git, and new untracked files are moved to a quarantine folder,
 * never deleted (an entry you add yourself while a film runs is not lost).
 */
function guardLibrary() {
  const root = path.resolve(library.LIB, "../..");
  const git = (args) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout: 60000 });
  const scope = ["--", "factory/library/videos", "factory/library/patterns.json"];
  const status = () => {
    const out = git(["status", "--porcelain", "-z", "--untracked-files=all", ...scope]);
    if (out.status !== 0) return null;
    return new Map(String(out.stdout).split("\0").filter(Boolean).map((l) => [l.slice(3), l.slice(0, 2)]));
  };
  const before = status();
  return () => {
    const after = status();
    if (!before || !after) return;
    const changed = [...after].filter(([p, s]) => before.get(p) !== s);
    if (!changed.length) return;
    logger.warn(`Factory agent changed ${changed.length} reference-library path(s); restoring them.`);
    const tracked = changed.filter(([, s]) => s !== "??").map(([p]) => p);
    if (tracked.length) git(["checkout", "--", ...tracked]);
    const quarantine = path.join(require("./queue").STATE_DIR, "library-quarantine", String(Date.now()));
    for (const [p] of changed.filter(([, s]) => s === "??")) {
      try {
        const dest = path.join(quarantine, p);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.renameSync(path.join(root, p), dest);
      } catch (e) { logger.warn(`Could not move ${p} out of the library (${e.message}).`); }
    }
  };
}

/** Real duration of a video in seconds, or 0 when it cannot be read. */
function probeSeconds(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 30000 });
  const s = Number(String(out.stdout || "").trim());
  return Number.isFinite(s) && s > 0 ? s : 0;
}

function probeSize(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 15000 });
  const [width, height] = String(out.stdout || "").trim().split(",").map(Number);
  return { width: width || 0, height: height || 0 };
}

/**
 * Builds one reel or carousel with the local agent.
 * @returns {Promise<{video?:string, poster:string, slides?:string[], look:object, costUsd:number}>}
 */
async function makeHero({ storyboard, article, outDir, assets = [], director = null, references = null, voice = null, engine: chosen = null, music = null }) {
  const format = storyboard.format === "carousel" ? "carousel" : "reel";
  // The engine is chosen once per piece (before the director writes for it) and passed in.
  const engine = format === "carousel" ? "remotion" : chosen || pickEngine();
  const workDir = path.join(outDir, `agent-${format === "carousel" ? "slides" : engine}`);
  prepareWorkspace(workDir, engine);
  const assetDir = path.join(workDir, engine === "remotion" ? "public/assets" : "assets");
  fs.mkdirSync(assetDir, { recursive: true });
  for (const a of assets) if (fs.existsSync(a.file)) fs.copyFileSync(a.file, path.join(assetDir, `${a.id}.jpg`));
  const refs = references || library.heroReferences(article);
  fs.writeFileSync(path.join(workDir, "LIBRARY.md"), `# Reference library\n\n${library.catalog()}\n`);
  if (format !== "reel") voice = null;
  if (voice) fs.copyFileSync(voice.manifestFile, path.join(workDir, "voice.json"));
  const prompt = heroPrompt({ storyboard, article, references: refs, director, assets, engine, skills: config.factory.heroSkills, avoid: novelty.looksToAvoid(), voice, music });
  fs.writeFileSync(path.join(outDir, "agent-prompt.md"), prompt);

  const args = claudeArgs(["--permission-mode", "acceptEdits", "--allowedTools", ...ALLOWED_TOOLS, "--add-dir", library.LIB, ...(engine === "remotion" ? ["--add-dir", path.join(FACTORY_DIR, "node_modules")] : [])]);

  logger.info(`Factory agent: Opus (${config.factory.claudeEffort}) is building ${storyboard.id} (${format}) with ${engine} in ${workDir} ...`);
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

  for (const f of ["treatment.md", "look.json"]) {
    const src = path.join(workDir, "out", f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(outDir, f));
  }
  let look = { engine };
  try { look = { ...JSON.parse(fs.readFileSync(path.join(workDir, "out/look.json"), "utf8")), engine }; } catch { /* optional */ }
  const costUsd = raw?.total_cost_usd || 0;

  if (format === "carousel") {
    // The slides themselves are the proof: exactly one 1080x1350 image per storyboard slide.
    const n = storyboard.slides.length;
    const slides = [];
    for (let i = 1; i <= n; i++) {
      const png = path.join(workDir, "out", `slide-${String(i).padStart(2, "0")}.png`);
      if (!fs.existsSync(png)) throw new Error(`Agent finished without ${path.basename(png)} (${n} slides expected): ${text.slice(0, 200)}`);
      const { width, height } = probeSize(png);
      // Any exact 4:5 render is fine (e.g. 2160x2700 at --scale=2): it is scaled down below.
      if (!width || width < 1080 || width * 5 !== height * 4) throw new Error(`${path.basename(png)} is ${width}x${height}; expected 1080x1350 (4:5).`);
      const jpg = path.join(outDir, `slide-${String(i).padStart(2, "0")}.jpg`);
      // Flattened onto black (transparent pixels would otherwise come out as noise), then scaled.
      ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=1080x1350", "-i", png, "-filter_complex", "[1:v]scale=1080:1350:flags=lanczos[s];[0:v][s]overlay=shortest=1", "-frames:v", "1", "-q:v", "2", jpg], { timeoutMs: 60000 });
      slides.push(jpg);
    }
    if (!/^\s*DONE\b/im.test(verdict)) logger.warn(`Factory agent: no DONE line, but all ${n} slides are valid; using them.`);
    return { slides, poster: slides[0], look, costUsd };
  }

  // The film itself is the proof: it must exist and be a readable video of a sane length.
  const muted = path.join(workDir, "out/hero.muted.mp4");
  if (!fs.existsSync(muted)) throw new Error(`Agent finished without out/hero.muted.mp4: ${text.slice(0, 200)}`);
  let seconds = probeSeconds(muted);
  if (seconds < 5 || seconds > 180) throw new Error(`out/hero.muted.mp4 is ${seconds ? `${seconds.toFixed(1)} s` : "unreadable"}; expected a 5-180 s film.`);
  if (!/^\s*DONE\b/im.test(verdict)) logger.warn(`Factory agent: no DONE line, but the film is valid (${seconds.toFixed(1)} s); using it.`);
  let film = muted;
  if (voice && fs.existsSync(voice.file) && seconds < voice.seconds + 0.5) {
    // Never cut the narration (and with it the CTA): hold the last frame until the voice is done.
    const hold = voice.seconds + 0.8 - seconds;
    logger.warn(`Factory agent: the film (${seconds.toFixed(1)} s) is shorter than the voice (${voice.seconds.toFixed(1)} s); holding its last frame ${hold.toFixed(1)} s.`);
    film = path.join(workDir, "out/hero.extended.mp4");
    ffmpeg(["-i", muted, "-vf", `tpad=stop_mode=clone:stop_duration=${hold.toFixed(2)}`, "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-an", film]);
    seconds = probeSeconds(film) || seconds + hold;
  }
  let cues = {};
  try { cues = JSON.parse(fs.readFileSync(path.join(workDir, "out/cues.json"), "utf8")) || {}; } catch { /* fall back below */ }
  const video = path.join(outDir, "reel.mp4");
  const sound = mixHero({ film, cues, seconds, outDir, storyboard, voice, music, palette: look.palette });
  try { fs.writeFileSync(path.join(outDir, "sound.json"), JSON.stringify(sound, null, 2)); } catch { /* review file only */ }
  const poster = path.join(outDir, "cover.jpg");
  ffmpeg(["-ss", String(Math.min(2.5, seconds / 4)), "-i", video, "-frames:v", "1", "-q:v", "3", poster]);
  return { video, poster, look, costUsd };
}

/**
 * Sound for an agent film: the planned music window (or the synth when the library is empty),
 * the agent's SFX (or whooshes on its cuts), the voice, and captions unless the film has its own.
 * Length comes from the real file: a wrong cues.seconds must never cut the end of the film.
 */
function mixHero({ film, cues, seconds, outDir, storyboard, voice, music, palette }) {
  const hasVoice = !!(voice && fs.existsSync(voice.file));
  const words = hasVoice ? voice.words || [] : [];
  const events = normalizeEvents(cues, seconds, { dropAt: music?.plan?.dropAt ?? null });
  let sfx = null;
  try { sfx = renderSfx(path.join(outDir, "sfx.wav"), { seconds, events, speech: speechWindows(words), seed: Date.now() % 100000 })?.file || null; } catch (e) { logger.warn(`Factory: SFX skipped (${e.message}).`); }
  let fallbackWav = null;
  if (!music) {
    logger.warn("Factory: no track from the music library; using the synth soundtrack.");
    fallbackWav = path.join(outDir, "soundtrack.wav");
    renderSoundtrack(fallbackWav, { bpm: Number(cues.bpm) || storyboard.bpm, seconds, cuts: Array.isArray(cues.cuts) ? cues.cuts : [], seed: Date.now() % 100000 });
  }
  const captions = hasVoice && cues.captions !== true;
  // A film longer than planned must not run past the end of the track into silence: move the
  // window back by whole bars (the beat phase holds; the drop lands that many bars later).
  let start = music ? music.plan.start : 0;
  if (music) {
    const bar = 240 / (music.plan.bpm || 120);
    while (start + seconds > music.track.duration - 0.3 && start - bar >= 0) start -= bar;
    if (start !== music.plan.start) logger.warn(`Factory: the film (${seconds.toFixed(1)} s) is longer than planned; music starts ${(music.plan.start - start).toFixed(1)} s earlier.`);
  }
  const out = mixReel({
    film, out: path.join(outDir, "reel.mp4"), seconds,
    music: music ? { file: music.track.file, start, refDb: music.track.refDb, vocals: music.track.vocals } : null,
    sfx, voice: hasVoice ? { file: voice.file, words } : null, captions, accent: accentFrom(palette), fallbackWav, workDir: outDir,
  });
  return {
    music: music ? { id: music.track.id, title: music.track.title, artist: music.track.artist, start: music.plan.start, bpm: music.plan.bpm, dropAt: music.plan.dropAt } : null,
    sfx: events, captions: out.captions ? "burned" : hasVoice ? "in film" : "none", speech: out.windows,
  };
}

module.exports = { makeHero, heroPrompt, pickEngine, mixHero, soundBlock };
