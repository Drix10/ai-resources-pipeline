/**
 * The storyboard contract between Opus (the director) and the templates (the crew).
 *
 * Opus never writes pixels in template mode: it writes this JSON. Every field is
 * validated in the pipeline (src/factory/storyboard.js) before a render starts, so
 * the components can trust it. Durations are in BEATS, never seconds, so every cut
 * lands on the grid of the soundtrack (see lib/anim.ts).
 */

export type ThemeName = 'night' | 'paper' | 'signal';

export type ReelScene =
  | { type: 'hook'; beats: number; text: string; emphasis?: string[]; kicker?: string }
  | { type: 'statement'; beats: number; headline: string; sub?: string }
  | { type: 'code'; beats: number; code: string; lang?: string; caption?: string; highlight?: number[] }
  | { type: 'stat'; beats: number; value: number; from?: number; prefix?: string; suffix?: string; label: string; decimals?: number }
  | { type: 'list'; beats: number; title: string; items: string[] }
  | { type: 'compare'; beats: number; title?: string; left: { label: string; value: string; note?: string }; right: { label: string; value: string; note?: string }; winner?: 'left' | 'right' }
  | { type: 'quote'; beats: number; text: string; source?: string }
  | { type: 'cta'; beats: number; text: string; sub?: string };

export type CarouselSlide =
  | { type: 'cover'; title: string; kicker?: string }
  | { type: 'point'; n?: number; title: string; body: string }
  | { type: 'code'; title?: string; code: string; lang?: string; caption?: string; highlight?: number[] }
  | { type: 'stat'; value: string; label: string; body?: string }
  /** A real screenshot; `src` (data: URL) and `host` are filled by the pipeline from the asset id. */
  | { type: 'shot'; asset: string; title: string; caption?: string; src?: string; host?: string }
  | { type: 'cta'; title: string; body?: string };

export type Storyboard = {
  id: string;
  format: 'reel' | 'carousel';
  title: string;
  theme: ThemeName;
  bpm: number;
  handle: string;
  /** The person behind the account; drawn in the CTA lockup. */
  author: string;
  scenes: ReelScene[];
  slides: CarouselSlide[];
  caption: string;
  hashtags: string[];
  /** Article the piece was cut from (for provenance; never shown on screen). */
  sourceUrl?: string;
};
