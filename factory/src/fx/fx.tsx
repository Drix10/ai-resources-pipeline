import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Theme } from '../brand';
import { E, prog, rand, tw } from '../lib/anim';

/**
 * Word-by-word reveal (rise + unblur), the house text move. Words listed in `emphasis`
 * are drawn in the accent colour, matching phrases case-insensitively.
 */
export const Words: React.FC<{
  text: string;
  start: number;
  stagger?: number;
  dur?: number;
  theme: Theme;
  emphasis?: string[];
  style?: React.CSSProperties;
}> = ({ text, start, stagger = 3, dur = 14, theme, emphasis = [], style }) => {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/).filter(Boolean);
  const hot = new Set<number>();
  const lower = words.map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}%$.-]/gu, ''));
  for (const phrase of emphasis) {
    const p = phrase.toLowerCase().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}%$.-]/gu, ''));
    for (let i = 0; i + p.length <= lower.length; i++) {
      if (p.every((w, j) => lower[i + j] === w)) for (let j = 0; j < p.length; j++) hot.add(i + j);
    }
  }
  return (
    <span style={{ ...style }}>
      {words.map((w, i) => {
        const p = prog(frame, start + i * stagger, start + i * stagger + dur, E.out);
        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translateY(${(1 - p) * 0.35}em)`,
              filter: `blur(${(1 - p) * 10}px)`,
              opacity: p,
              color: hot.has(i) ? theme.accent : undefined,
              marginRight: '0.24em',
            }}
          >
            {w}
          </span>
        );
      })}
    </span>
  );
};

/** Full-bleed generated plate with a slow push-in, scrim and vignette so type always reads. */
export const PlateBg: React.FC<{ src?: string; theme: Theme; dur: number; seed: string; scrim?: number }> = ({ src, theme, dur, seed, scrim }) => {
  const frame = useCurrentFrame();
  const s = tw(frame, 0, dur, 1.04, 1.12, E.linear);
  const dx = (rand(seed) - 0.5) * 40 * prog(frame, 0, dur, E.linear);
  const a = scrim ?? theme.scrim;
  return (
    <AbsoluteFill style={{ background: theme.bg, overflow: 'hidden' }}>
      {src ? (
        <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `translateX(${dx}px) scale(${s})` }} />
      ) : (
        <FieldBg theme={theme} seed={seed} />
      )}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(0,0,0,${a * 0.55}) 0%, rgba(0,0,0,${a * 0.35}) 35%, rgba(0,0,0,${a}) 75%, rgba(0,0,0,${Math.min(0.92, a + 0.2)}) 100%)`,
        }}
      />
    </AbsoluteFill>
  );
};

/** Plate-less background: a drifting accent glow on the theme ground plus a faint grid. */
export const FieldBg: React.FC<{ theme: Theme; seed: string }> = ({ theme, seed }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const x = 30 + rand(seed) * 40 + Math.sin(frame / 90) * 6;
  const y = 20 + rand(seed + 'y') * 30 + Math.cos(frame / 110) * 5;
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 45% at ${x}% ${y}%, ${theme.accent.replace('rgb(', 'rgba(').replace(')', ' / 0.22)')}, transparent 70%)`,
        }}
      />
      <svg width={width} height={height} style={{ position: 'absolute', opacity: 0.35 }}>
        <defs>
          <pattern id={`g-${seed}`} width="72" height="72" patternUnits="userSpaceOnUse">
            <path d="M72 0H0V72" fill="none" stroke={theme.rule} strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#g-${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** Static film grain (seeded per frame) to keep flat grounds from banding after H.264. */
export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.07 }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 2) % 8;
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', opacity, mixBlendMode: 'overlay' }}>
      <svg width="100%" height="100%">
        <filter id={`n${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={seed} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#n${seed})`} />
      </svg>
    </AbsoluteFill>
  );
};

/** A short accent kicker label: "SYSTEMS / C". */
export const Kicker: React.FC<{ text: string; theme: Theme; start: number; size?: number }> = ({ text, theme, start, size = 30 }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, start, start + 12);
  return (
    <div
      style={{
        fontFamily: '"JetBrains Mono Variable", monospace',
        fontSize: size,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: theme.accent,
        opacity: p,
        transform: `translateX(${(1 - p) * -24}px)`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
      }}
    >
      <span style={{ width: 44 * p, height: 4, background: theme.accent, display: 'inline-block' }} />
      {text}
    </div>
  );
};
