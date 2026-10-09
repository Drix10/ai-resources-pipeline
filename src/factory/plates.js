/**
 * Storyboard plates through OpenRouter's image endpoint (default: Nano Banana 2.1).
 * Plates are mood images only; the templates draw every word on top in code, so each
 * prompt is wrapped with a hard no-text rule and the house look.
 *
 * Output per plate: plates/<id>.png (original) + <id>.jpg (1080-wide, for the render),
 * and storyboard.plates[i].src becomes a data: URL so Remotion can load it offline.
 */
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");
const { ffmpeg } = require("./render");

const HOUSE_STYLE =
  "Cinematic editorial photograph or restrained 3D render, deep navy and graphite tones with one cool blue light, soft film grain, shallow depth of field, calm negative space for overlaid typography.";
const NO_TEXT =
  "Absolutely no text, letters, numbers, captions, signage, user interface, logos or watermarks anywhere in the image.";

const ASPECT = { reel: "9:16", carousel: "4:5" };
const SIZE = { reel: [1080, 1920], carousel: [1080, 1350] };

async function generateImage(prompt, aspect) {
  const { apiKey, baseUrl } = config.llm.openrouter;
  if (!apiKey) {
    const err = new Error("OPENROUTER_API_KEY is required for storyboard plates.");
    err.code = "OPENROUTER_UNAVAILABLE";
    throw err;
  }
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 180000);
    try {
      const res = await fetch(`${baseUrl}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "ai-resources-pipeline/factory" },
        body: JSON.stringify({ model: config.factory.imageModel, prompt, aspect_ratio: aspect, resolution: config.factory.imageResolution, n: 1 }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = new Error(`OpenRouter images ${res.status}: ${(await res.text()).slice(0, 300)}`);
        err.status = res.status;
        throw err;
      }
      const data = await res.json();
      const img = data?.data?.[0];
      if (!img?.b64_json) throw new Error("OpenRouter images returned no image data.");
      if (data.usage?.cost !== undefined) logger.info(`Factory: plate cost $${data.usage.cost}`);
      return { buffer: Buffer.from(img.b64_json, "base64"), mediaType: img.media_type || "image/png" };
    } catch (e) {
      last = e;
      const retryable = !e.status || e.status === 429 || e.status >= 500;
      if (!retryable || attempt === 3) break;
      logger.warn(`Factory: plate generation failed (${e.message}); retry ${attempt}/3...`);
      await sleep(5000 * attempt);
    } finally {
      clearTimeout(timer);
    }
  }
  throw last;
}

/**
 * Generates every plate in the storyboard. A plate that fails is dropped and the scenes
 * that used it fall back to the code-drawn field background (the templates handle a
 * missing src), so one bad image never blocks a piece.
 */
async function generatePlates(storyboard, outDir) {
  const dir = path.join(outDir, "plates");
  fs.mkdirSync(dir, { recursive: true });
  const aspect = ASPECT[storyboard.format];
  const [w, h] = SIZE[storyboard.format];
  for (const plate of storyboard.plates) {
    // Cache by prompt, so a QA rewrite of a plate prompt regenerates it and a re-run does not.
    const tag = require("crypto").createHash("sha1").update(`${config.factory.imageModel}|${aspect}|${plate.prompt}`).digest("hex").slice(0, 10);
    const jpg = path.join(dir, `${plate.id}-${tag}.jpg`);
    try {
      if (!fs.existsSync(jpg)) {
        const { buffer, mediaType } = await generateImage(`${plate.prompt.trim()}\n\nStyle: ${HOUSE_STYLE}\n${NO_TEXT}`, aspect);
        const orig = path.join(dir, `${plate.id}-${tag}.orig.${mediaType.includes("jpeg") ? "jpg" : "png"}`);
        fs.writeFileSync(orig, buffer);
        // Cover-crop to the exact frame and re-encode small: inputProps stay light and renders stay fast.
        ffmpeg(["-i", orig, "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`, "-q:v", "3", jpg]);
      }
      plate.src = `data:image/jpeg;base64,${fs.readFileSync(jpg).toString("base64")}`;
      plate.file = jpg;
      logger.info(`Factory: plate ${plate.id} ready.`);
    } catch (e) {
      logger.warn(`Factory: plate ${plate.id} failed (${e.message}); scenes using it fall back to the field background.`);
    }
  }
  return storyboard;
}

module.exports = { generatePlates, generateImage, HOUSE_STYLE, NO_TEXT };
