/**
 * Template mode director: Opus reads one article and writes a storyboard (factory/src/schema.ts)
 * for a 9:16 reel or a 4:5 carousel. The storyboard is then checked in code, the same way
 * llm.js checks articles: shape, timing, Instagram copy limits, numbers that are not in the
 * source, hype vocabulary. A rejected storyboard goes back to Opus once with the reasons.
 */
const config = require("../../config");
const { logger } = require("../utils/helpers");
const { BANNED_WORDS } = require("../services/llm");
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

const CAROUSEL_SPEC = `CAROUSEL (1080x1350, 4:5). 5-8 slides. First is "cover", last is "cta".
Slide types:
- cover {title <= 70 chars, kicker?: <= 24 chars}
- point {n?: number, title <= 50 chars, body <= 260 chars}
- code  {title?: <= 40, code <= 14 lines and <= 42 chars per line, lang?, caption?: <= 160, highlight?: [line numbers]}
- stat  {value: string <= 8 chars e.g. "2x" "32 B" "87%", label <= 70 chars, body?: <= 200 chars}
- shot  {asset: id, title <= 50 chars, caption?: <= 140 chars}   a real screenshot of a page the article links to, in a browser frame (only ids listed under REAL SCREENSHOTS)
- cta   {title <= 60 chars, body?: <= 120 chars}`;

const SYSTEM = `You are the director of an Instagram channel for a hands-on systems/AI engineer. You turn one article into one short piece that a busy engineer would stop scrolling for, learn one concrete thing from, and save.

You do not write code or pixels. You write a STORYBOARD as JSON that a library of code-rendered motion templates will animate. Think like a motion designer: one idea per scene, every cut on the beat, the text carries the story with sound off.

Rules that are checked in code, and a storyboard that breaks one is rejected:
1. Facts: every number and every named product, company or person must appear in the article. Never invent results, benchmarks, quotes or dates.
2. Hook first: the hook states the surprising concrete claim in plain words. No questions like "Did you know". No clickbait the article cannot back.
3. Plain voice. No hype words (e.g. unlock, game-changer, revolutionary, delve, leverage, seamless, supercharge), no emojis in on-screen text.
4. Caption: 1-3 short paragraphs (<= 1200 chars) that add one detail beyond the video, ending with a one-line question or a save prompt. 3-6 lowercase hashtags, specific not generic (#cprogramming, not #tech).
5. Respect every length limit in the spec. Short text reads better on a phone than complete text.

Return ONLY the JSON object, no prose.`;

/** Screenshots a carousel can show (the tall mobile captures do not fit a 4:5 frame). */
const shotAssets = (article) => (article.assets || []).filter((a) => a.kind === "card" || a.kind === "image");

function buildPrompt({ article, format, feedback, patterns, avoid }) {
  const spec = format === "reel" ? REEL_SPEC : CAROUSEL_SPEC;
  const shape = format === "reel" ? '"scenes": [...], "slides": []' : '"scenes": [], "slides": [...]';
  return [
    `FORMAT: ${format}`,
    spec,
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
    article.text.slice(0, 16000),
    feedback ? `\nYOUR PREVIOUS STORYBOARD WAS REJECTED. Fix exactly these problems and keep everything else:\n- ${feedback.join("\n- ")}` : "",
  ].join("\n");
}

const norm = (s) => String(s || "").replace(/(\d),(?=\d)/g, "$1").replace(/[’]/g, "'").toLowerCase();

/** Every string a viewer will read, for the fact and vocabulary gates. */
function visibleText(sb) {
  const out = [];
  const walk = (v, key) => {
    if (key === "type" || key === "id" || key === "lang" || key === "asset" || key === "src" || key === "host") return;
    if (typeof v === "string") out.push(v);
    else if (typeof v === "number" && key !== "beats" && key !== "n" && key !== "decimals" && key !== "highlight") out.push(String(v));
    else if (Array.isArray(v)) v.forEach((x) => walk(x, key === "highlight" ? "highlight" : undefined));
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => walk(x, k));
  };
  walk(sb.scenes);
  walk(sb.slides);
  return out;
}

/** Returns a list of problems; empty means the storyboard can be rendered. */
function validate(sb, article, format) {
  const errors = [];
  const len = (s, max, label) => { if (String(s || "").length > max) errors.push(`${label} is ${String(s).length} chars; limit ${max}.`); };
  const req = (v, label) => { if (typeof v !== "string" || !v.trim()) errors.push(`${label} is required (non-empty text).`); };
  if (!sb || typeof sb !== "object") return ["Reply was not a JSON object."];
  if (!THEMES.includes(sb.theme)) errors.push(`theme must be one of ${THEMES.join(", ")}.`);
  if (!(sb.bpm >= 100 && sb.bpm <= 140)) errors.push("bpm must be between 100 and 140.");

  if (format === "reel") {
    const scenes = Array.isArray(sb.scenes) ? sb.scenes : [];
    if (scenes.length < 4 || scenes.length > 7) errors.push("A reel needs 4-7 scenes.");
    const total = scenes.reduce((a, s) => a + (Number(s.beats) || 0), 0);
    if (total < 34 || total > 56) errors.push(`Total beats is ${total}; must be 34-56.`);
    if (scenes[0]?.type !== "hook") errors.push("The first scene must be a hook.");
    if (scenes[scenes.length - 1]?.type !== "cta") errors.push("The last scene must be a cta.");
    scenes.forEach((s, i) => {
      const at = `Scene ${i + 1} (${s.type})`;
      if (!SCENE_TYPES.includes(s.type)) return errors.push(`${at}: unknown type.`);
      if (!(s.beats >= 2 && s.beats <= 14)) errors.push(`${at}: beats must be 2-14.`);
      if (s.type === "hook") { req(s.text, `${at} text`); len(s.text, 60, `${at} text`); len(s.kicker, 24, `${at} kicker`); for (const e of s.emphasis || []) if (!String(s.text).toLowerCase().includes(String(e).toLowerCase())) errors.push(`${at}: emphasis "${e}" is not in the text.`); }
      if (s.type === "statement") { req(s.headline, `${at} headline`); len(s.headline, 50, `${at} headline`); len(s.sub, 80, `${at} sub`); }
      if (s.type === "code") {
        const lines = String(s.code || "").split("\n");
        req(s.code, `${at} code`);
        if (lines.length > 10) errors.push(`${at}: code has ${lines.length} lines; limit 10.`);
        if (lines.some((l) => l.length > 38)) errors.push(`${at}: a code line is longer than 38 chars; shorten or wrap.`);
        len(s.caption, 60, `${at} caption`);
      }
      if (s.type === "stat") { if (typeof s.value !== "number" || !Number.isFinite(s.value)) errors.push(`${at}: value must be a number.`); req(s.label, `${at} label`); len(s.label, 90, `${at} label`); }
      if (s.type === "list") { req(s.title, `${at} title`); (s.items || []).forEach((it, k) => req(it, `${at} item ${k + 1}`)); len(s.title, 40, `${at} title`); if (!Array.isArray(s.items) || s.items.length < 2 || s.items.length > 4) errors.push(`${at}: 2-4 items.`); (s.items || []).forEach((it, k) => len(it, 42, `${at} item ${k + 1}`)); }
      if (s.type === "compare") { for (const side of ["left", "right"]) { if (!s[side]?.label || !s[side]?.value) errors.push(`${at}: ${side} needs label and value.`); len(s[side]?.value, 18, `${at} ${side}.value`); len(s[side]?.note, 60, `${at} ${side}.note`); } }
      if (s.type === "quote") {
        req(s.text, `${at} text`);
        len(s.text, 140, `${at} text`);
        const squash = (t) => norm(t).replace(/[^a-z0-9]+/g, " ").trim();
        if (!squash(article.text).includes(squash(s.text))) errors.push(`${at}: a quote must be verbatim from the article.`);
        if (s.source && !squash(article.text).includes(squash(s.source))) errors.push(`${at}: quote source must be named in the article.`);
      }
      if (s.type === "cta") { req(s.text, `${at} text`); len(s.text, 60, `${at} text`); len(s.sub, 60, `${at} sub`); }
    });
  } else {
    const slides = Array.isArray(sb.slides) ? sb.slides : [];
    if (slides.length < 5 || slides.length > 8) errors.push("A carousel needs 5-8 slides.");
    if (slides[0]?.type !== "cover") errors.push("The first slide must be a cover.");
    if (slides[slides.length - 1]?.type !== "cta") errors.push("The last slide must be a cta.");
    slides.forEach((s, i) => {
      const at = `Slide ${i + 1} (${s.type})`;
      if (!SLIDE_TYPES.includes(s.type)) return errors.push(`${at}: unknown type.`);
      if (s.type === "cover") { req(s.title, `${at} title`); len(s.title, 70, `${at} title`); len(s.kicker, 24, `${at} kicker`); }
      if (s.type === "point") { req(s.title, `${at} title`); req(s.body, `${at} body`); len(s.title, 50, `${at} title`); len(s.body, 260, `${at} body`); }
      if (s.type === "code") { req(s.code, `${at} code`); const lines = String(s.code || "").split("\n"); if (lines.length > 14 || lines.some((l) => l.length > 42)) errors.push(`${at}: code must be <= 14 lines of <= 42 chars.`); len(s.caption, 160, `${at} caption`); }
      if (s.type === "stat") { req(s.value, `${at} value`); req(s.label, `${at} label`); len(s.value, 8, `${at} value`); len(s.label, 70, `${at} label`); len(s.body, 200, `${at} body`); }
      if (s.type === "shot") { req(s.title, `${at} title`); len(s.title, 50, `${at} title`); len(s.caption, 140, `${at} caption`); if (!shotAssets(article).some((a) => a.id === s.asset)) errors.push(`${at}: asset "${s.asset}" is not one of the REAL SCREENSHOTS.`); }
      if (s.type === "cta") { req(s.title, `${at} title`); len(s.title, 60, `${at} title`); len(s.body, 120, `${at} body`); }
    });
  }

  len(sb.caption, 1200, "caption");
  if (!Array.isArray(sb.hashtags) || sb.hashtags.length < 3 || sb.hashtags.length > 6) errors.push("Use 3-6 hashtags.");
  else if (sb.hashtags.some((h) => !/^#[a-z0-9_]{2,40}$/.test(h))) errors.push("Hashtags must be lowercase #words with no spaces.");

  // Fact gate: numbers on screen or in the caption must be in the article. Code is exempt
  // (it is quoted or minimal illustration), as are the small counting numbers 0-10.
  const source = norm(article.text);
  const text = [...visibleText({ scenes: (sb.scenes || []).map(({ code, ...s }) => s), slides: (sb.slides || []).map(({ code, ...s }) => s) }), sb.caption || ""].join("\n");
  // A small number with a magnitude ("5M", "3x", "8 GB") is a claim too, so only bare 0-10 are exempt.
  const nums = [...norm(text).matchAll(/(\d+(?:\.\d+)?)\s*(k|m|b|bn|x|×|%|ms|gb|mb|tb|kb|million|billion|times)?(?![a-z])/g)]
    .filter((m) => Number(m[1]) > 10 || m[2])
    .map((m) => m[1]);
  const missing = [...new Set(nums.filter((n) => !new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?!\\d|\\.\\d)`).test(source)))];
  if (missing.length) errors.push(`These numbers are not in the article: ${missing.slice(0, 6).join(", ")}. Use only numbers from the article.`);

  const lowered = text.toLowerCase();
  const banned = BANNED_WORDS.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lowered) && !new RegExp(`\\b${w}\\b`, "i").test(source));
  if (banned.length) errors.push(`Remove these words: ${banned.slice(0, 6).join(", ")}.`);
  if (/\p{Extended_Pictographic}/u.test(visibleText(sb).join(" "))) errors.push("No emojis in on-screen text.");
  return errors;
}

/** Fills defaults the templates rely on and drops fields the model should not set. */
function finalize(raw, { article, format }) {
  const id = `${format}-${article.slug}`.slice(0, 80);
  return {
    id,
    format,
    title: String(raw.title || article.title).slice(0, 120),
    pattern: String(raw.pattern || "new").slice(0, 40),
    theme: THEMES.includes(raw.theme) ? raw.theme : "night",
    bpm: Math.round(Number(raw.bpm) || 120),
    handle: config.factory.handle,
    author: config.factory.author,
    scenes: format === "reel" ? raw.scenes || [] : [],
    slides: format === "carousel" ? (raw.slides || []).map((s) => (s && s.type === "stat" && s.value !== undefined ? { ...s, value: String(s.value) } : s)) : [],
    caption: String(raw.caption || "").trim(),
    hashtags: (raw.hashtags || []).map((h) => String(h).trim().toLowerCase()),
    sourceUrl: article.url || "",
  };
}

/**
 * @param {{title:string,text:string,slug:string,url?:string,tags?:string[]}} article
 * @param {"reel"|"carousel"} format
 * @param {string[]} [extraFeedback] e.g. vision-QA findings on a previous render
 */
async function writeStoryboard(article, format, extraFeedback = null, previous = null) {
  const patterns = library.patternsFor(article, format);
  const avoid = novelty.storyboardsToAvoid();
  let feedback = extraFeedback;
  let last = previous;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let prompt = buildPrompt({ article, format, feedback, patterns, avoid });
    if (feedback && last) prompt += `\n\nPREVIOUS STORYBOARD:\n${JSON.stringify(last)}`;
    const reply = await opus.ask({ system: SYSTEM, prompt, maxTokens: 6000, temperature: 0.8 });
    let raw;
    try {
      raw = opus.parseJson(reply);
    } catch (e) {
      feedback = [`Your reply was not valid JSON (${e.message}). Return only the JSON object.`];
      continue;
    }
    const sb = finalize(raw, { article, format });
    const errors = validate(sb, article, format);
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
