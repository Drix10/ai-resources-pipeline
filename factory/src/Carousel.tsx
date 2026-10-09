import React from 'react';
import { AbsoluteFill, Img } from 'remotion';
import { FONT, POST, THEMES, Theme } from './brand';
import { FieldBg, Grain } from './fx/fx';
import { fitSize } from './lib/anim';
import { FontGate } from './lib/FontGate';
import type { CarouselSlide, Storyboard } from './schema';

/**
 * One 1080×1350 (4:5) carousel slide. Rendered as a still per slide index, so
 * nothing here may animate: <FieldBg> is frame-driven but frame 0 is deterministic.
 */
const S = POST.safe;
const CW = POST.w - S.left - S.right;

const Chrome: React.FC<{ sb: Storyboard; theme: Theme; i: number; n: number; children: React.ReactNode; plate?: string }> = ({ sb, theme, i, n, children, plate }) => {
  const src = plate ? sb.plates.find((p) => p.id === plate)?.src : undefined;
  return (
    <AbsoluteFill style={{ background: theme.bg }}>
      {src ? (
        <>
          <Img src={src} style={{ position: 'absolute', width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: `linear-gradient(180deg, rgba(0,0,0,${theme.scrim * 0.4}) 0%, rgba(0,0,0,${theme.scrim}) 60%, rgba(0,0,0,${Math.min(0.9, theme.scrim + 0.25)}) 100%)` }} />
        </>
      ) : (
        <FieldBg theme={theme} seed={`slide${i}`} />
      )}
      <div style={{ position: 'absolute', top: S.top - 40, left: S.left, right: S.right, display: 'flex', justifyContent: 'space-between', fontFamily: FONT.mono, fontSize: 26, color: src ? 'rgba(255,255,255,0.7)' : theme.faint }}>
        <span>{sb.handle}</span>
        <span>
          {String(i + 1).padStart(2, '0')} / {String(n).padStart(2, '0')}
        </span>
      </div>
      <div style={{ position: 'absolute', left: S.left, top: S.top + 20, width: CW, bottom: S.bottom + 40, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 34 }}>{children}</div>
      {i < n - 1 ? (
        <div style={{ position: 'absolute', bottom: S.bottom - 50, right: S.right, fontFamily: FONT.mono, fontSize: 28, color: theme.accent }}>swipe →</div>
      ) : null}
      <div style={{ position: 'absolute', bottom: 0, left: 0, height: 10, width: `${((i + 1) / n) * 100}%`, background: theme.accent }} />
      <Grain opacity={0.05} />
    </AbsoluteFill>
  );
};

const H: React.FC<{ text: string; theme: Theme; max?: number; lines?: number; color?: string }> = ({ text, theme, max = 112, lines = 4, color }) => (
  <div style={{ fontFamily: FONT.display, fontWeight: 760, fontSize: fitSize(text, CW, lines, max, 48), lineHeight: 1.02, letterSpacing: '-0.035em', color: color ?? theme.ink }}>{text.replace(/(\w)-(\w)/g, '$1\u2011$2')}</div>
);

const Body: React.FC<{ text: string; theme: Theme; color?: string }> = ({ text, theme, color }) => (
  <div style={{ fontFamily: FONT.text, fontSize: text.length > 220 ? 38 : 44, lineHeight: 1.32, color: color ?? theme.body }}>{text}</div>
);

const SlideBody: React.FC<{ slide: CarouselSlide; theme: Theme; onPlate: boolean }> = ({ slide, theme, onPlate }) => {
  const ink = onPlate ? 'rgb(244 246 248)' : undefined;
  const body = onPlate ? 'rgb(214 220 228)' : undefined;
  switch (slide.type) {
    case 'cover':
      return (
        <>
          {slide.kicker ? <div style={{ fontFamily: FONT.mono, fontSize: 30, letterSpacing: '0.12em', textTransform: 'uppercase', color: theme.accent }}>{slide.kicker}</div> : null}
          <H text={slide.title} theme={theme} max={128} lines={5} color={ink} />
        </>
      );
    case 'point':
      return (
        <>
          {slide.n !== undefined ? <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: 150, lineHeight: 0.8, color: theme.accent }}>{String(slide.n).padStart(2, '0')}</div> : null}
          <H text={slide.title} theme={theme} max={84} lines={3} color={ink} />
          <Body text={slide.body} theme={theme} color={body} />
        </>
      );
    case 'code': {
      const lines = slide.code.replace(/\t/g, '  ').split('\n').slice(0, 18);
      const longest = Math.max(...lines.map((l) => l.length), 10);
      const size = Math.max(22, Math.min(38, Math.floor((CW - 80) / (longest * 0.62))));
      return (
        <>
          {slide.title ? <H text={slide.title} theme={theme} max={72} lines={2} /> : null}
          <pre style={{ margin: 0, background: theme.bg2, border: `2px solid ${theme.rule}`, borderRadius: 24, padding: '30px 36px', fontFamily: FONT.mono, fontSize: size, lineHeight: 1.5, color: theme.ink, whiteSpace: 'pre' }}>
            {lines.map((l, i) => (
              <div key={i} style={{ background: slide.highlight?.includes(i + 1) ? theme.accent.replace('rgb(', 'rgba(').replace(')', ' / 0.18)') : 'transparent', minHeight: '1.5em' }}>
                {l}
              </div>
            ))}
          </pre>
          {slide.caption ? <Body text={slide.caption} theme={theme} /> : null}
        </>
      );
    }
    case 'stat':
      return (
        <>
          <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: fitSize(slide.value, CW, 1, 280, 100, 0.6), lineHeight: 0.95, letterSpacing: '-0.05em', color: theme.accent }}>{slide.value}</div>
          <H text={slide.label} theme={theme} max={72} lines={3} />
          {slide.body ? <Body text={slide.body} theme={theme} /> : null}
        </>
      );
    case 'cta':
      return (
        <>
          <H text={slide.title} theme={theme} max={100} lines={4} />
          {slide.body ? <Body text={slide.body} theme={theme} /> : null}
          <div style={{ alignSelf: 'flex-start', fontFamily: FONT.display, fontWeight: 700, fontSize: 44, color: theme.onAccent, background: theme.accent, padding: '18px 44px', borderRadius: 999 }}>Save + follow</div>
        </>
      );
  }
};

export const CarouselSlideComp: React.FC<{ storyboard: Storyboard; slide: number }> = ({ storyboard: sb, slide }) => {
  const theme = THEMES[sb.theme] ?? THEMES.night;
  const s = sb.slides[slide] ?? sb.slides[0];
  const plate = 'plate' in s ? s.plate : undefined;
  return (
    <FontGate>
      <Chrome sb={sb} theme={theme} i={slide} n={sb.slides.length} plate={plate}>
        <SlideBody slide={s} theme={theme} onPlate={!!plate && !!sb.plates.find((p) => p.id === plate)?.src} />
      </Chrome>
    </FontGate>
  );
};
