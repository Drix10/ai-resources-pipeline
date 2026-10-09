/**
 * The storyboard: Opus reads one story and writes the words, beats and arc (factory/src/schema.ts)
 * of a 9:16 reel or a 4:5 carousel, plus a spoken voiceover line per scene for narrated reels.
 * In agent mode it is copy only (the director and agent design everything); in template mode the
 * house templates draw it. It is then checked in code, the same way llm.js checks articles:
 * shape and field types, timing, Instagram copy limits, numbers and quotes that are not in the
 * source, hype vocabulary, emoji. A rejected storyboard goes back to Opus once with the reasons.
 */
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { BANNED_WORDS } = require("../services/llm");
const { stripTags, wordsOf, tagsOf, TAG, voiceAvailable } = require("./voice");
const opus = require("./opus");
const library = require("./library");
const novelty = require("./novelty");

const SCENE_TYPES = ["hook", "statement", "code", "stat", "list", "compare", "quote", "cta"];
const SLIDE_TYPES = ["cover", "point", "code", "stat", "shot", "cta"];
const THEMES = ["night", "paper", "signal"];

const REEL_SPEC = `REEL (1080x1920, 30fps). Durations are in BEATS at the storyboard's bpm (120 bpm: 1 beat = 0.5 s).
Total 34-56 beats (17-28 s). 4-7 scenes. First scene is a "hook" of 4-6 beats; last scene is a "cta" of 5-6 beats.
Scene types (all text is rendered live in code; NEVER put words in image prompts):
- hook   {beats, text <= 60 chars, emphasis?: [exact phrase(s) from text to colour], kicker?: "TOPIC / SUBTOPIC" <= 24 chars}
- statement {beats 4-7, headline <= 50 chars, sub?: <= 80 chars}             one big claim, a line under it
- code   {beats 8-12, code: <= 10 lines, <= 38 chars per line, lang?, caption?: <= 60 chars, highlight?: [1-based line numbers]}  types out
- stat   {beats 4-7, value: number, from?: number, prefix?, suffix?, label <= 90 chars, decimals?}  counts up
- list   {beats 2 per item + 3, title <= 40 chars, items: 2-4 strings <= 42 chars}
- compare{beats 6-8, title?, left:{label,value <= 18 chars,note? <= 60}, right:{…}, winner?: "left"|"right"}
- quote  {beats 6-8, text <= 140 chars, source?}  only for a real quote that is in the article
- cta    {beats 5-6, text <= 60 chars, sub?: <= 60 chars}`;

/** Spoken words per second the voice can carry without rushing (ElevenLabs reads ~2.5-3 w/s). */
const WORDS_PER_SECOND = 2.8;
const MAX_TAG = 40;

const VOICE_SPEC = `VOICEOVER (this reel is narrated; ElevenLabs Eleven v4 performs it). Every scene also gets
"voiceover": the line spoken during that scene. Write it to be HEARD, by one sharp engineer talking to another:
- It carries the story with the sound ON, while the screen carries it with the sound off: say more than the
  screen (the why, the turn, the stakes), never repeat the on-screen words verbatim, never claim more than them.
- Budget: at most ${WORDS_PER_SECOND} words per second of its scene (beats x 60 / bpm), contractions, short sentences,
  rhythm. The hook line lands in the first 2 seconds. Numbers as digits, exactly as the article has them.
- Audio tags in [square brackets] direct the performance, placed right before the words they colour: emotion
  [curious] [deadpan] [amused] [surprised] [serious], delivery [whispers] [slowly] [rushed] [emphatic]
  [low, steady voice], reactions [sighs] [exhales] [chuckles], timing [pause] [short pause] [long pause].
  At most 3 tags per scene, each under ${MAX_TAG} characters; ellipses (...) and dashes also shape pauses.
  No SSML, no <break>, no sound-effect tags (the music and effects are mixed separately).`;

const CAROUSEL_SPEC = `CAROUSEL (1080x1350, 4:5). 5-8 slides. First is "cover", last is "cta".
Slide types:
- cover {title <= 70 chars, kicker?: <= 24 chars}
- point {n?: step number 1-9, title <= 50 chars, body <= 260 chars}
- code  {title?: <= 40, code <= 12 lines and <= 42 chars per line, lang?, caption?: <= 120, highlight?: [line numbers]}
- stat  {value: string <= 8 chars e.g. "2x" "32 B" "87%", label <= 70 chars, body?: <= 200 chars}
- shot  {asset: id, title <= 50 chars, caption?: <= 120 chars}   a real screenshot of a page the article links to, in a browser frame (only ids listed under REAL SCREENSHOTS)
- cta   {title <= 60 chars, body?: <= 120 chars}`;

const SYSTEM = `You are the director of an Instagram channel for a hands-on systems/AI engineer. You turn one article into one short piece that a busy engineer would stop scrolling for, learn one concrete thing from, and save.

You do not write code or pixels. You write a STORYBOARD as JSON: the words, the beats and the arc of the piece, which is then built in code from it. Think like a motion designer: one idea per scene, every cut on the beat, the text carries the story with sound off.

Rules that are checked in code, and a storyboard that breaks one is rejected:
1. Facts: every number and every named product, company or person must appear in the article. Never invent results, benchmarks, quotes or dates.
2. Hook first: the hook states the surprising concrete claim in plain words. No questions like "Did you know". No clickbait the article cannot back.
3. Plain voice. No hype words (e.g. unlock, game-changer, revolutionary, delve, leverage, seamless, supercharge), no emojis in on-screen text.
4. Caption (Instagram shows only its first line before "more"): line 1 is a hook of <= 110 chars that opens a gap the video closes (a stake or a sharp claim, never a summary or a label). Then 1-2 short paragraphs (blank line between) that add one concrete detail the video does not show. Then one line that gives a reason to save or send it ("Save this for ..." / "Send this to the person who ..."), and last a specific question people can answer in a comment. <= 1200 chars in all. 3-6 lowercase hashtags, mostly specific (#cprogramming) with at most one broad one (#ai).
5. Respect every length limit in the spec. Short text reads better on a phone than complete text.

Return ONLY the JSON object, no prose.`;

/** Screenshots a carousel can show (the tall mobile captures do not fit a 4:5 frame). */
const shotAssets = (article) => (article.assets || []).filter((a) => a.kind === "card" || a.kind === "image");

/**
 * In agent mode nothing is templated: a motion designer builds the piece from scratch, so the
 * storyboard is the words and the arc only, and the type labels classify copy, not layouts.
 */
const AGENT_NOTE = {
  reel: `THIS PIECE IS DESIGNED FROM SCRATCH (no templates): a motion designer will build a whole visual world around your words, so your job is the WORDS and the ARC.
- Arc, not a list: SETUP (the surprising concrete claim) -> TENSION (why it bites, what goes wrong) -> REVEAL (the mechanism or the fix) -> PAYOFF (what to do, then the CTA). Each beat is one idea.
- The type label only classifies the copy (hook, statement, code, stat, compare, quote, list, cta); it is NOT a layout. Use "list" only if the article is truly a list, and "code" only for the single line that matters.
- Short, concrete lines that can live INSIDE an image (stamped, typed, printed, etched): nouns and verbs, no filler, no colon headings.`,
  carousel: `THIS CAROUSEL IS DESIGNED FROM SCRATCH (no templates): a designer will build every slide as part of one visual world, so your job is the WORDS and the ARC across the swipe.
- Arc, not a list: the cover makes the surprising concrete claim, the middle slides build TENSION then the REVEAL (the mechanism or the fix), the last slides give the PAYOFF and the CTA. One idea per slide.
- The slide type (cover, point, code, stat, shot, cta) only classifies the copy; it is NOT a layout. Use "code" only for the lines that matter, "shot" only when the real page makes the point.
- Short, concrete lines that can live INSIDE an image: nouns and verbs, no filler, no colon headings.`,
};

/** Narration is written for agent reels when a voice can actually be made (template reels have none). */
const narrated = (format, mode) => format === "reel" && mode === "agent" && voiceAvailable();

function buildPrompt({ article, format, feedback, patterns, avoid, mode }) {
  const spec = format === "reel" ? REEL_SPEC : CAROUSEL_SPEC;
  const shape = format === "reel" ? '"scenes": [...], "slides": []' : '"scenes": [], "slides": [...]';
  return [
    `FORMAT: ${format}`,
    spec,
    narrated(format, mode) ? `\n${VOICE_SPEC}` : "",
    mode === "agent" ? `\n${AGENT_NOTE[format] || AGENT_NOTE.reel}` : "",
    "",
    "JSON SHAPE:",
    `{"title": short internal title, "pattern": the pattern id you used or "new", "theme": one of ${THEMES.join("|")} (night = default; signal = launches/hot takes; paper = calm explainers), "bpm": 112-128, ${shape}, "caption": "...", "hashtags": ["#..."]}`,
    "",
    patterns ? `PROVEN PATTERNS FROM OUR LIBRARY (pick the one that fits, adapt freely):\n${patterns}\n` : "",
    avoid ? `RECENT PIECES ON THE CHANNEL (use a different hook shape and structure from these):\n${avoid}\n` : "",
    format === "carousel" && shotAssets(article).length
      ? `REAL SCREENSHOTS (captured from pages the article links to; show one on a "shot" slide when the real page makes the point land: the repo, the docs, the post):\n${shotAssets(article).map((a) => `- ${a.id}: ${a.title || a.url} (${a.url})`).join("\n")}\n`
      : "",
    `ARTICLE TITLE: ${article.title}`,
    "ARTICLE:",
    article.text.slice(0, PROMPT_CHARS),
    feedback ? `\nYOUR PREVIOUS STORYBOARD WAS REJECTED. Fix exactly these problems and keep everything else:\n- ${feedback.join("\n- ")}` : "",
  ].join("\n");
}

const norm = (s) => String(s || "").replace(/(\d),(?=\d)/g, "$1").replace(/[’‘]/g, "'").toLowerCase();

/** The prompt shows Opus this much of the article; the gate checks against exactly the same. */
const PROMPT_CHARS = 16000;

/**
 * What a claim may be checked against: the article and its research as shown to Opus, minus
 * URLs and the research page headers (a "github.com/org/repo/issues/8123" line is not a fact).
 */
const factSource = (article) => norm(String(article.text || "").slice(0, PROMPT_CHARS).replace(/https?:\/\/\S+/g, " ").replace(/^--- .*$/gm, " "));

/** The story itself, without research: hype words are only excused when the author used them. */
const storySource = (article) => norm(article.baseText ?? article.text);

/** Exactly what the reel stat scene draws (prefix + formatted value + suffix), see ReelScenes StatScene. */
const statText = (s) => `${s.prefix || ""}${Number(s.value).toLocaleString("en-US", { minimumFractionDigits: s.decimals || 0, maximumFractionDigits: s.decimals || 0 })}${s.suffix || ""}`;

/** Every string a viewer will read, for the fact and vocabulary gates. */
function visibleText(sb) {
  const out = [];
  const walk = (v, key) => {
    if (key === "type" || key === "id" || key === "asset" || key === "src" || key === "host" || key === "highlight" || key === "beats" || key === "decimals" || key === "voiceover") return;
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number") out.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  // A reel stat is checked as drawn, so a number split across prefix/value/suffix cannot hide.
  walk((sb.scenes || []).map((s) => (s && s.type === "stat" ? { label: s.label, shown: statText(s) } : s)));
  walk(sb.slides);
  return out;
}

const isStr = (v) => typeof v === "string";
const isStrArray = (v) => Array.isArray(v) && v.every(isStr);
const isIntArray = (v) => Array.isArray(v) && v.every((x) => Number.isInteger(x));
const escapeRe = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A banned word in any common inflection, hyphen or no hyphen ("unlocks", "game changer"). */
const bannedRe = (w) => new RegExp(`\\b${escapeRe(w).replace(/-/g, "[-\\s]?")}(s|es|ed|d|ing)?\\b`, "i");
// Pictographs, flags and keycaps; the trademark/copyright signs in product names are fine.
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣|[✓✔★☆➔➜]/u;
const hasEmoji = (t) => EMOJI.test(String(t).replace(/[©®™]/g, ""));
// Magnitudes written as words are claims too.
const WORD_NUMBERS = /\b(hundred|thousand|million|billion|trillion|dozen|twice|tenfold|hundredfold)s?\b/gi;
// A number glued to letters ("40s", "5000qps", "64KiB") is a magnitude; so is one followed by a unit word.
const NUMBER = /(?<![\d.])(\d+(?:\.\d+)?)(?:([a-z%×]+)|\s*(k|m|b|bn|x|×|%|ms|s|sec|seconds|min|minutes|hours|gb|mb|tb|kb|kib|mib|gib|million|billion|thousand|times|percent|users|requests)\b)?/g;

/** Voiceover rules: text, word budget for its scene, well-formed audio tags. */
function checkVoiceover(s, at, bpm, errors) {
  if (s.voiceover === undefined || s.voiceover === null) return;
  if (!isStr(s.voiceover)) return errors.push(`${at}: voiceover must be text.`);
  const budget = Math.ceil(((Number(s.beats) || 0) * 60 / (Number(bpm) || 120)) * WORDS_PER_SECOND) + 1;
  const words = wordsOf(s.voiceover).length;
  if (words > budget) errors.push(`${at}: voiceover is ${words} words; this scene can carry ${budget}. Cut words or lengthen the scene.`);
  const tags = tagsOf(s.voiceover);
  if (tags.length > 3) errors.push(`${at}: at most 3 audio tags per scene.`);
  for (const t of tags) {
    if (!t || t.length > MAX_TAG) errors.push(`${at}: audio tag [${t.slice(0, 50)}] must be 1-${MAX_TAG} characters.`);
    if (/\d/.test(t)) errors.push(`${at}: audio tag [${t}] may not contain numbers.`);
  }
  if (/<\s*\/?\s*(break|speak|prosody|emphasis)\b/i.test(s.voiceover) || /[[\]]/.test(s.voiceover.replace(TAG, ""))) errors.push(`${at}: voiceover has SSML or a broken [tag]; use audio tags like [pause].`);
}

/** Returns a list of problems; empty means the storyboard can be rendered. */
function validate(sb, article, format, { mode = "template" } = {}) {
  const errors = [];
  if (!sb || typeof sb !== "object") return ["Reply was not a JSON object."];
  const len = (s, max, label) => { if (isStr(s) && s.length > max) errors.push(`${label} is ${s.length} chars; limit ${max}.`); };
  const req = (v, label) => { if (!isStr(v) || !v.trim()) errors.push(`${label} is required (non-empty text).`); };
  const opt = (v, label, max) => { if (v === undefined || v === null) return; if (!isStr(v)) errors.push(`${label} must be text.`); else len(v, max, label); };
  if (!THEMES.includes(sb.theme)) errors.push(`theme must be one of ${THEMES.join(", ")}.`);
  if (!(sb.bpm >= 100 && sb.bpm <= 140)) errors.push("bpm must be between 100 and 140.");

  if (format === "reel") {
    const scenes = Array.isArray(sb.scenes) ? sb.scenes : [];
    if (!Array.isArray(sb.scenes)) errors.push("scenes must be an array.");
    if (scenes.length < 4 || scenes.length > 7) errors.push("A reel needs 4-7 scenes.");
    const total = scenes.reduce((a, s) => a + (Number(s?.beats) || 0), 0);
    if (total < 34 || total > 56) errors.push(`Total beats is ${total}; must be 34-56.`);
    if (scenes[0]?.type !== "hook") errors.push("The first scene must be a hook.");
    if (scenes[scenes.length - 1]?.type !== "cta") errors.push("The last scene must be a cta.");
    scenes.forEach((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return errors.push(`Scene ${i + 1} must be an object.`);
      const at = `Scene ${i + 1} (${s.type})`;
      if (!SCENE_TYPES.includes(s.type)) return errors.push(`${at}: unknown type.`);
      if (!(Number.isInteger(s.beats) && s.beats >= 2 && s.beats <= 14)) errors.push(`${at}: beats must be a whole number 2-14.`);
      if (s.type === "hook") {
        req(s.text, `${at} text`); len(s.text, 60, `${at} text`); opt(s.kicker, `${at} kicker`, 24);
        if (s.emphasis !== undefined && !isStrArray(s.emphasis)) errors.push(`${at}: emphasis must be a list of phrases.`);
        else for (const e of s.emphasis || []) if (!String(s.text).toLowerCase().includes(e.toLowerCase())) errors.push(`${at}: emphasis "${e}" is not in the text.`);
      }
      if (s.type === "statement") { req(s.headline, `${at} headline`); len(s.headline, 50, `${at} headline`); opt(s.sub, `${at} sub`, 80); }
      if (s.type === "code") {
        req(s.code, `${at} code`);
        const lines = String(s.code || "").split("\n");
        if (lines.length > 10) errors.push(`${at}: code has ${lines.length} lines; limit 10.`);
        if (lines.some((l) => l.length > 38)) errors.push(`${at}: a code line is longer than 38 chars; shorten or wrap.`);
        opt(s.caption, `${at} caption`, 60);
        if (s.lang !== undefined && !(isStr(s.lang) && /^[a-z0-9+#.-]{1,16}$/i.test(s.lang))) errors.push(`${at}: lang must be a short language name like "c" or "ts".`);
        if (s.highlight !== undefined && !isIntArray(s.highlight)) errors.push(`${at}: highlight must be a list of line numbers.`);
      }
      if (s.type === "stat") {
        if (typeof s.value !== "number" || !Number.isFinite(s.value)) errors.push(`${at}: value must be a number.`);
        if (s.decimals !== undefined && !(Number.isInteger(s.decimals) && s.decimals >= 0 && s.decimals <= 3)) errors.push(`${at}: decimals must be 0-3.`);
        else if (typeof s.value === "number" && Number(s.value.toFixed(s.decimals || 0)) !== s.value) errors.push(`${at}: value ${s.value} would display rounded; set decimals to show it exactly.`);
        for (const k of ["prefix", "suffix"]) { opt(s[k], `${at} ${k}`, 6); if (isStr(s[k]) && /\d/.test(s[k])) errors.push(`${at}: ${k} may not contain digits.`); }
        if (s.from !== undefined && typeof s.from !== "number") errors.push(`${at}: from must be a number.`);
        req(s.label, `${at} label`); len(s.label, 90, `${at} label`);
      }
      if (s.type === "list") {
        req(s.title, `${at} title`); len(s.title, 40, `${at} title`);
        if (!isStrArray(s.items) || s.items.length < 2 || s.items.length > 4) errors.push(`${at}: 2-4 text items.`);
        else s.items.forEach((it, k) => { req(it, `${at} item ${k + 1}`); len(it, 42, `${at} item ${k + 1}`); });
      }
      if (s.type === "compare") {
        opt(s.title, `${at} title`, 40);
        for (const side of ["left", "right"]) {
          const v = s[side];
          if (!v || typeof v !== "object") { errors.push(`${at}: ${side} must be {label, value, note?}.`); continue; }
          req(v.label, `${at} ${side}.label`); req(v.value, `${at} ${side}.value`); len(v.label, 24, `${at} ${side}.label`); len(v.value, 18, `${at} ${side}.value`); opt(v.note, `${at} ${side}.note`, 60);
        }
        if (s.winner !== undefined && s.winner !== "left" && s.winner !== "right") errors.push(`${at}: winner must be "left" or "right".`);
      }
      if (s.type === "quote") {
        req(s.text, `${at} text`); len(s.text, 140, `${at} text`); opt(s.source, `${at} source`, 40);
        // Word-bounded, Unicode-aware: a quote must be a run of at least 3 whole words of the article.
        const squash = (t) => ` ${norm(t).replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;
        const body = squash(storySource(article));
        const q = squash(s.text);
        if (q.trim().split(" ").filter(Boolean).length < 3 || !body.includes(q)) errors.push(`${at}: a quote must be verbatim from the article (3+ words).`);
        if (s.source !== undefined && (!isStr(s.source) || !body.includes(squash(s.source)))) errors.push(`${at}: quote source must be named in the article.`);
      }
      if (s.type === "cta") { req(s.text, `${at} text`); len(s.text, 60, `${at} text`); opt(s.sub, `${at} sub`, 60); }
      checkVoiceover(s, at, sb.bpm, errors);
    });
    if (narrated(format, mode)) {
      if (!isStr(scenes[0]?.voiceover) || !wordsOf(scenes[0].voiceover).length) errors.push("The hook needs a voiceover line (this reel is narrated).");
      const total = scenes.reduce((a, s) => a + (isStr(s?.voiceover) ? wordsOf(s.voiceover).length : 0), 0);
      if (total < 12) errors.push(`The voiceover has ${total} words; a narrated reel needs at least 12.`);
    }
  } else {
    const slides = Array.isArray(sb.slides) ? sb.slides : [];
    if (!Array.isArray(sb.slides)) errors.push("slides must be an array.");
    if (slides.length < 5 || slides.length > 8) errors.push("A carousel needs 5-8 slides.");
    if (slides[0]?.type !== "cover") errors.push("The first slide must be a cover.");
    if (slides[slides.length - 1]?.type !== "cta") errors.push("The last slide must be a cta.");
    slides.forEach((s, i) => {
      if (!s || typeof s !== "object" || Array.isArray(s)) return errors.push(`Slide ${i + 1} must be an object.`);
      const at = `Slide ${i + 1} (${s.type})`;
      if (!SLIDE_TYPES.includes(s.type)) return errors.push(`${at}: unknown type.`);
      if (s.type === "cover") { req(s.title, `${at} title`); len(s.title, 70, `${at} title`); opt(s.kicker, `${at} kicker`, 24); }
      if (s.type === "point") {
        req(s.title, `${at} title`); req(s.body, `${at} body`); len(s.title, 50, `${at} title`); len(s.body, 260, `${at} body`);
        if (s.n !== undefined && !(Number.isInteger(s.n) && s.n >= 1 && s.n <= 9)) errors.push(`${at}: n is the step number, 1-9.`);
      }
      if (s.type === "code") {
        req(s.code, `${at} code`);
        const lines = String(s.code || "").split("\n");
        if (lines.length > 12 || lines.some((l) => l.length > 42)) errors.push(`${at}: code must be <= 12 lines of <= 42 chars.`);
        opt(s.title, `${at} title`, 40); opt(s.caption, `${at} caption`, 120);
        if (s.lang !== undefined && !(isStr(s.lang) && /^[a-z0-9+#.-]{1,16}$/i.test(s.lang))) errors.push(`${at}: lang must be a short language name.`);
        if (s.highlight !== undefined && !isIntArray(s.highlight)) errors.push(`${at}: highlight must be a list of line numbers.`);
      }
      if (s.type === "stat") { req(s.value, `${at} value`); req(s.label, `${at} label`); len(s.value, 8, `${at} value`); len(s.label, 70, `${at} label`); opt(s.body, `${at} body`, 200); }
      if (s.type === "shot") { req(s.title, `${at} title`); len(s.title, 50, `${at} title`); opt(s.caption, `${at} caption`, 120); if (!shotAssets(article).some((a) => a.id === s.asset)) errors.push(`${at}: asset "${s.asset}" is not one of the REAL SCREENSHOTS.`); }
      if (s.type === "cta") { req(s.title, `${at} title`); len(s.title, 60, `${at} title`); opt(s.body, `${at} body`, 120); }
    });
  }

  if (!isStr(sb.caption) || !sb.caption.trim()) errors.push("caption is required.");
  len(sb.caption, 1200, "caption");
  if (isStr(sb.caption) && sb.caption.trim().split("\n")[0].length > 110) errors.push("caption line 1 (the hook Instagram shows before \"more\") must be <= 110 chars.");
  if (!isStrArray(sb.hashtags) || sb.hashtags.length < 3 || sb.hashtags.length > 6) errors.push("Use 3-6 hashtags.");
  else if (sb.hashtags.some((h) => !/^#[a-z0-9_]{2,40}$/.test(h))) errors.push("Hashtags must be lowercase #words with no spaces.");
  if (errors.length) return errors; // the content gates below assume the shapes above

  // Display type animates word by word and cannot wrap inside a word: a URL or path-length token
  // would run off the frame.
  const strip = (list) => list.map(({ code, ...s }) => s);
  const longWord = visibleText({ scenes: strip(sb.scenes || []), slides: strip(sb.slides || []) }).join(" ").split(/\s+/).find((w) => w.length > 24);
  if (longWord) errors.push(`"${longWord.slice(0, 40)}" is too long for on-screen type (max 24 characters per word).`);

  // Fact gate: every number a viewer reads (screen, caption, hashtags) must be in the article or
  // its research. Code is exempt (quoted or minimal illustration), and so are bare whole numbers
  // 0-10 used for counting; a decimal or a number with a unit is always a claim.
  const source = factSource(article);
  // The voice is held to the same facts as the screen (tags stripped: they are directions, not words).
  const spoken = (sb.scenes || []).map((x) => (x && isStr(x.voiceover) ? stripTags(x.voiceover) : "")).filter(Boolean);
  const shown = [...visibleText({ scenes: strip(sb.scenes || []), slides: strip(sb.slides || []) }), sb.caption, ...sb.hashtags.map((h) => h.slice(1)), ...spoken].join("\n");
  const said = norm(shown);
  const nums = [...said.matchAll(NUMBER)]
    .filter((m) => m[2] || m[3] || m[1].includes(".") || Number(m[1]) > 10)
    .map((m) => m[1]);
  const missing = [...new Set(nums.filter((n) => !new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?!\\d|\\.\\d)`).test(source)))];
  if (missing.length) errors.push(`These numbers are not in the article: ${missing.slice(0, 6).join(", ")}. Use only numbers from the article.`);
  const words = [...new Set((said.match(WORD_NUMBERS) || []).map((w) => w.toLowerCase()))].filter((w) => !new RegExp(`\\b${w}\\b`).test(source));
  if (words.length) errors.push(`These amounts are not in the article: ${words.join(", ")}.`);

  const story = storySource(article);
  const banned = BANNED_WORDS.filter((w) => bannedRe(w).test(said) && !bannedRe(w).test(story));
  if (banned.length) errors.push(`Remove these words: ${banned.slice(0, 6).join(", ")}.`);
  if (hasEmoji(visibleText(sb).join(" "))) errors.push("No emojis in on-screen text.");
  if (spoken.some(hasEmoji)) errors.push("No emojis in the voiceover.");
  if (hasEmoji(sb.caption) || sb.hashtags.some(hasEmoji)) errors.push("No emojis in the caption.");
  return errors;
}

/** Fills defaults the templates rely on and drops fields the model should not set. */
function finalize(raw, { article, format }) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) raw = {};
  const id = `${format}-${article.slug}`.slice(0, 80);
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    id,
    format,
    title: String(raw.title || article.title).slice(0, 120),
    pattern: String(raw.pattern || "new").slice(0, 40),
    theme: THEMES.includes(raw.theme) ? raw.theme : "night",
    bpm: Math.round(Number(raw.bpm) || 120),
    handle: config.factory.handle,
    author: config.factory.author,
    scenes: format === "reel" ? list(raw.scenes) : [],
    // src/host of a shot slide are filled from the real capture by the pipeline, never by the model.
    slides: format === "carousel" ? list(raw.slides).map((s) => {
      if (!s || typeof s !== "object") return s;
      const { src, host, ...rest } = s;
      return rest.type === "stat" && rest.value !== undefined ? { ...rest, value: String(rest.value) } : rest;
    }) : [],
    caption: isStr(raw.caption) ? raw.caption.trim() : "",
    hashtags: (isStr(raw.hashtags) ? raw.hashtags.split(/[\s,]+/) : list(raw.hashtags)).filter(Boolean).map((h) => String(h).trim().toLowerCase()),
    sourceUrl: article.url || "",
  };
}

/**
 * @param {{title:string,text:string,slug:string,url?:string,tags?:string[]}} article
 * @param {"reel"|"carousel"} format
 * @param {string[]} [extraFeedback] e.g. vision-QA findings on a previous render
 */
async function writeStoryboard(article, format, extraFeedback = null, previous = null, { mode = "template" } = {}) {
  const patterns = library.patternsFor(article, format);
  const avoid = novelty.storyboardsToAvoid();
  let feedback = extraFeedback;
  let last = previous;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let prompt = buildPrompt({ article, format, feedback, patterns, avoid, mode });
    if (feedback && last) prompt += `\n\nPREVIOUS STORYBOARD:\n${JSON.stringify(last)}`;
    const reply = await opus.ask({ system: SYSTEM, prompt, maxTokens: 6000, temperature: 0.8 });
    let raw;
    try {
      raw = opus.parseJson(reply);
    } catch (e) {
      feedback = [`Your reply was not valid JSON (${e.message}). Return only the JSON object.`];
      continue;
    }
    // A malformed reply goes back to Opus as feedback; it must never crash the cycle.
    let sb;
    let errors;
    try {
      sb = finalize(raw, { article, format });
      errors = validate(sb, article, format, { mode });
    } catch (e) {
      feedback = [`Your JSON did not match the shape (${e.message}). Follow the JSON SHAPE and field types exactly.`];
      continue;
    }
    if (errors.length === 0) {
      logger.info(`Factory: storyboard ok for ${sb.id} (attempt ${attempt}).`);
      return sb;
    }
    logger.warn(`Factory: storyboard for ${article.slug} rejected (attempt ${attempt}): ${errors.join(" | ")}`);
    feedback = errors;
    last = sb;
  }
  const err = new Error(`Storyboard for ${article.slug} failed the gates twice: ${feedback.join(" | ")}`);
  err.code = "STORYBOARD_REJECTED";
  throw err;
}

module.exports = { writeStoryboard, validate, finalize, buildPrompt, SYSTEM };
