import type { ThemeName } from './schema';

/**
 * Brand tokens, lifted from blogs.drix10.com (blog/app/globals.css + layout.tsx) so the
 * Instagram feed reads as the same publication: Bricolage Grotesque for display,
 * Newsreader for long text, JetBrains Mono for code, one blue accent.
 */
export type Theme = {
  bg: string;
  bg2: string;
  ink: string;
  body: string;
  faint: string;
  rule: string;
  accent: string;
  /** Text colour on top of an accent fill. */
  onAccent: string;
};

export const THEMES: Record<ThemeName, Theme> = {
  night: {
    bg: 'rgb(12 19 32)',
    bg2: 'rgb(19 28 45)',
    ink: 'rgb(233 238 245)',
    body: 'rgb(190 201 216)',
    faint: 'rgb(140 153 171)',
    rule: 'rgb(36 48 70)',
    accent: 'rgb(124 147 255)',
    onAccent: 'rgb(12 19 32)',
  },
  paper: {
    bg: 'rgb(241 243 240)',
    bg2: 'rgb(232 236 231)',
    ink: 'rgb(15 27 45)',
    body: 'rgb(52 66 85)',
    faint: 'rgb(88 101 116)',
    rule: 'rgb(203 210 204)',
    accent: 'rgb(23 54 245)',
    onAccent: 'rgb(241 243 240)',
  },
  // High-energy variant for hooks and launches: same ink, accent swapped to signal orange.
  signal: {
    bg: 'rgb(10 12 16)',
    bg2: 'rgb(22 25 31)',
    ink: 'rgb(244 244 240)',
    body: 'rgb(200 203 207)',
    faint: 'rgb(140 145 152)',
    rule: 'rgb(44 48 56)',
    accent: 'rgb(255 92 41)',
    onAccent: 'rgb(10 12 16)',
  },
};

export const FONT = {
  display: '"Bricolage Grotesque Variable", system-ui, sans-serif',
  text: '"Newsreader Variable", Georgia, serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
};

/** Instagram UI covers the edges of a reel; nothing that must be read goes outside this box. */
export const REEL = { w: 1080, h: 1920, fps: 30, safe: { top: 230, bottom: 400, left: 84, right: 150 } };
export const POST = { w: 1080, h: 1350, safe: { top: 96, bottom: 110, left: 96, right: 96 } };
