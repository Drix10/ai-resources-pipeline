/** Brand description for prompts (mirrors factory/src/brand.ts). */
const THEME_NOTE = [
  "Fonts: Bricolage Grotesque (display, 700-800, tight tracking), Newsreader (long text), JetBrains Mono (code, labels). Already installed via @fontsource-variable; FontGate in src/lib/FontGate.tsx loads them.",
  "Night palette (default): ground rgb(12 19 32), raised rgb(19 28 45), ink rgb(233 238 245), body rgb(190 201 216), rule rgb(36 48 70), one accent rgb(124 147 255).",
  "Signal palette (launches): ground rgb(10 12 16), ink rgb(244 244 240), accent rgb(255 92 41).",
  "One accent only, used for the thing that matters right now.",
].join("\n");

module.exports = { THEME_NOTE };
