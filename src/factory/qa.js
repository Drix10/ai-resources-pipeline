/**
 * Vision QA, the galleries' "render stills -> fix -> render" step: Opus looks at one still
 * per scene (or every carousel slide) and lists only problems a viewer would notice.
 * The orchestrator sends real problems back to the storyboard writer once.
 */
const opus = require("./opus");
const { logger } = require("../utils/helpers");

const SYSTEM = `You are the final-frame checker for an Instagram channel. You see rendered frames (the last frame of each reel scene, or each carousel slide) in order.
Report ONLY problems a viewer would notice on a phone:
- text clipped, overlapping, cramped, orphaned single words on a line, or too small to read
- text with poor contrast against the image behind it
- a frame that reads as a generic template: text floating on an empty background, a lone card, a bullet list
- an image that does not fit the scene's message or is visually confusing
- a frame that looks empty or broken
Do not comment on taste if nothing is wrong. Return JSON only:
{"pass": true|false, "issues": [{"frame": 1-based index, "problem": "...", "fix": "a concrete storyboard change, e.g. shorten scene 3 headline to <= 30 chars"}]}`;

async function reviewFrames(storyboard, files) {
  const kind = storyboard.format === "reel" ? "reel scenes" : "carousel slides";
  const summary = storyboard.format === "reel"
    ? storyboard.scenes.map((s, i) => `${i + 1}. ${s.type}`).join("\n")
    : storyboard.slides.map((s, i) => `${i + 1}. ${s.type}`).join("\n");
  const reply = await opus.ask({
    system: SYSTEM,
    prompt: `These are the ${files.length} ${kind} of "${storyboard.title}", in order:\n${summary}\n\nCheck them.`,
    imageFiles: files,
    maxTokens: 1500,
    temperature: 0,
  });
  const verdict = opus.parseJson(reply);
  const issues = Array.isArray(verdict.issues) ? verdict.issues : [];
  logger.info(`Factory QA ${storyboard.id}: ${verdict.pass && issues.length === 0 ? "pass" : `${issues.length} issue(s)`}`);
  return { pass: !!verdict.pass && issues.length === 0, issues };
}

module.exports = { reviewFrames };
