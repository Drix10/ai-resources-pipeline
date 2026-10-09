import { Easing, interpolate, spring, SpringConfig } from 'remotion';

// Easing + spring vocabulary adapted from Leonxlnx/claude-launchvideo (MIT): named after how
// they feel, not the math. Every animation in the templates is a pure function of the frame.

export const E = {
  out: Easing.bezier(0.16, 1, 0.3, 1), // arrivals, reveals
  outSoft: Easing.bezier(0.22, 1, 0.36, 1), // gentle settles
  in: Easing.bezier(0.7, 0, 0.84, 0), // departures
  inOut: Easing.bezier(0.87, 0, 0.13, 1), // whips
  smooth: Easing.bezier(0.65, 0, 0.35, 1), // drifts
  linear: (t: number) => t,
};

type Ease = (t: number) => number;

export const tw = (frame: number, from: number, to: number, a: number, b: number, ease: Ease = E.out) =>
  interpolate(frame, [from, to], [a, b], { easing: ease, extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

export const prog = (frame: number, from: number, to: number, ease: Ease = E.out) => tw(frame, from, to, 0, 1, ease);

export const SPR: Record<string, Partial<SpringConfig>> = {
  snap: { damping: 18, stiffness: 260, mass: 0.7 },
  pop: { damping: 11, stiffness: 180, mass: 0.6 },
  soft: { damping: 26, stiffness: 120, mass: 1 },
};

export const spr = (frame: number, start: number, fps: number, cfg: Partial<SpringConfig> = SPR.snap) =>
  spring({ frame: frame - start, fps, config: cfg });

/** Attack-decay envelope for hits on the beat. */
export const hitPulse = (t: number, attack = 2, tau = 5) =>
  t <= 0 || t > attack + 6 * tau ? 0 : t < attack ? Math.sin((t / attack) * (Math.PI / 2)) : Math.exp(-(t - attack) / tau);

/** Frames per beat at a given bpm/fps. 120 bpm @ 30 fps = 15 frames. */
export const beatFrames = (bpm: number, fps: number) => (60 / bpm) * fps;

export const rand = (seed: number | string) => {
  let h = typeof seed === 'number' ? seed * 2654435761 : 0;
  if (typeof seed === 'string') for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

/**
 * Display size for a headline that must fit `maxLines` lines of `width` px.
 * Bricolage averages ~0.52em per glyph at weight 700; err small rather than clip.
 */
export const fitSize = (text: string, width: number, maxLines: number, max: number, min = 40, em = 0.56) => {
  const words = text.split(/\s+/).filter(Boolean);
  for (let size = max; size > min; size -= 2) {
    const cpl = width / (size * em);
    let lines = 1;
    let cur = 0;
    let ok = true;
    for (const w of words) {
      if (w.length > cpl) { ok = false; break; }
      const need = cur === 0 ? w.length : cur + 1 + w.length;
      if (need > cpl) { lines++; cur = w.length; } else cur = need;
    }
    if (ok && lines <= maxLines) return size;
  }
  return min;
};
