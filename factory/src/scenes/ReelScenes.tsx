import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { FONT, REEL, Theme } from '../brand';
import { FieldBg, Kicker, Words } from '../fx/fx';
import { E, fitSize, hitPulse, prog, spr, SPR, tw } from '../lib/anim';
import type { ReelScene, Storyboard } from '../schema';

export type SceneProps<T extends ReelScene['type']> = {
  scene: Extract<ReelScene, { type: T }>;
  sb: Storyboard;
  theme: Theme;
  dur: number; // frames
  beat: number; // frames per beat
  index: number;
};

const S = REEL.safe;
const CW = REEL.w - S.left - S.right; // content width inside the Instagram-safe box


const Box: React.FC<{ children: React.ReactNode; justify?: 'center' | 'flex-end' | 'flex-start'; gap?: number }> = ({ children, justify = 'center', gap = 36 }) => (
  <div
    style={{
      position: 'absolute',
      left: S.left,
      top: S.top,
      width: CW,
      height: REEL.h - S.top - S.bottom,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: justify,
      gap,
    }}
  >
    {children}
  </div>
);

export const Hook: React.FC<SceneProps<'hook'>> = ({ scene, sb, theme, dur, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const size = fitSize(scene.text, CW, 6, 132, 64);
  const slam = spr(frame, 0, fps, SPR.pop);
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`h${index}`} />
      <Box>
        {scene.kicker ? <Kicker text={scene.kicker} theme={theme} start={2} /> : null}
        <div
          style={{
            fontFamily: FONT.display,
            fontWeight: 760,
            fontSize: size,
            lineHeight: 1.0,
            letterSpacing: '-0.035em',
            color: theme.ink,
            transform: `scale(${0.92 + 0.08 * slam})`,
            transformOrigin: 'left center',
          }}
        >
          <Words text={scene.text} start={0} stagger={2} dur={12} theme={theme} emphasis={scene.emphasis} />
        </div>
      </Box>
    </AbsoluteFill>
  );
};

/** One big claim and an optional line under it, over the field background. */
export const StatementScene: React.FC<SceneProps<'statement'>> = ({ scene, theme, index }) => {
  const size = fitSize(scene.headline, CW, 4, 104, 56);
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`p${index}`} />
      <Box gap={28}>
        <div style={{ fontFamily: FONT.display, fontWeight: 720, fontSize: size, lineHeight: 1.02, letterSpacing: '-0.03em', color: theme.ink }}>
          <Words text={scene.headline} start={3} theme={theme} />
        </div>
        {scene.sub ? (
          <div style={{ fontFamily: FONT.text, fontSize: 46, lineHeight: 1.25, color: theme.body }}>
            <Words text={scene.sub} start={10} stagger={2} theme={theme} />
          </div>
        ) : null}
      </Box>
    </AbsoluteFill>
  );
};

/** Tiny tokenizer: enough colour to read as code, never wrong enough to mislead. */
const KW = /\b(const|let|var|function|return|if|else|for|while|struct|int|char|long|float|double|void|class|def|import|from|async|await|new|typeof|export|public|private|static|true|false|null|None|fn|pub|impl|use|let|mut|type|interface)\b/;
const tokenColor = (tok: string, theme: Theme) => {
  if (/^\/\/|^#(?!include)/.test(tok)) return theme.faint;
  if (/^["'`]/.test(tok)) return 'rgb(152 214 160)';
  if (/^\d/.test(tok)) return 'rgb(255 190 120)';
  if (KW.test(tok)) return theme.accent;
  return undefined;
};
const tokenize = (line: string) => line.split(/(\/\/.*$|#.*$|"[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|\b\w+\b)/).filter((t) => t !== '');

export const CodeScene: React.FC<SceneProps<'code'>> = ({ scene, theme, dur, index }) => {
  const frame = useCurrentFrame();
  const lines = scene.code.replace(/\t/g, '  ').split('\n').slice(0, 16);
  const longest = Math.max(...lines.map((l) => l.length), 10);
  const size = Math.max(26, Math.min(44, Math.floor((CW - 80) / (longest * 0.62))));
  const total = scene.code.length;
  const typed = Math.floor(tw(frame, 4, Math.max(8, dur * 0.6), 0, total, E.linear));
  let budget = typed;
  const card = prog(frame, 0, 10);
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`c${index}`} />
      <Box gap={40}>
        {scene.lang ? <Kicker text={scene.lang} theme={theme} start={0} /> : null}
        <div
          style={{
            background: theme.bg2,
            border: `2px solid ${theme.rule}`,
            borderRadius: 28,
            padding: '30px 40px 40px',
            opacity: card,
            transform: `translateY(${(1 - card) * 40}px)`,
            boxShadow: '0 40px 80px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ display: 'flex', gap: 14, marginBottom: 26 }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
              <span key={c} style={{ width: 20, height: 20, borderRadius: 10, background: c, opacity: 0.9 }} />
            ))}
          </div>
          <pre style={{ margin: 0, fontFamily: FONT.mono, fontSize: size, lineHeight: 1.5, color: theme.ink, whiteSpace: 'pre' }}>
            {lines.map((line, li) => {
              const show = Math.max(0, Math.min(line.length, budget));
              budget -= line.length + 1;
              const hl = scene.highlight?.includes(li + 1) && typed >= total;
              let used = 0;
              return (
                <div key={li} style={{ background: hl ? theme.accent.replace('rgb(', 'rgba(').replace(')', ' / 0.18)') : 'transparent', margin: '0 -16px', padding: '0 16px', borderRadius: 8, minHeight: '1.5em' }}>
                  {tokenize(line).map((tok, ti) => {
                    const vis = tok.slice(0, Math.max(0, show - used));
                    used += tok.length;
                    return vis ? (
                      <span key={ti} style={{ color: tokenColor(tok, theme) }}>
                        {vis}
                      </span>
                    ) : null;
                  })}
                  {show > 0 && show < line.length ? <span style={{ background: theme.accent, color: theme.accent }}>▍</span> : null}
                </div>
              );
            })}
          </pre>
        </div>
        {scene.caption ? (
          <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: fitSize(scene.caption, CW, 3, 58, 40), lineHeight: 1.12, color: theme.ink }}>
            <Words text={scene.caption} start={Math.round(dur * 0.55)} theme={theme} />
          </div>
        ) : null}
      </Box>
    </AbsoluteFill>
  );
};

export const StatScene: React.FC<SceneProps<'stat'>> = ({ scene, theme, dur, beat, index }) => {
  const frame = useCurrentFrame();
  const from = scene.from ?? 0;
  const v = tw(frame, 2, Math.min(dur - 4, beat * 3), from, scene.value, E.outSoft);
  const dec = scene.decimals ?? (Number.isInteger(scene.value) && Number.isInteger(from) ? 0 : 1);
  const txt = `${scene.prefix ?? ''}${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${scene.suffix ?? ''}`;
  const finalTxt = `${scene.prefix ?? ''}${scene.value.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}${scene.suffix ?? ''}`;
  const size = fitSize(finalTxt, CW, 1, 300, 120, 0.6);
  const landed = frame - Math.min(dur - 4, beat * 3);
  const pulse = hitPulse(landed, 2, 6);
  const bar = prog(frame, 2, Math.min(dur - 4, beat * 3), E.outSoft);
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`s${index}`} />
      <Box gap={30}>
        <div style={{ fontFamily: FONT.display, fontWeight: 800, fontSize: size, lineHeight: 0.95, letterSpacing: '-0.05em', color: theme.accent, transform: `scale(${1 + pulse * 0.05})`, transformOrigin: 'left center', fontVariantNumeric: 'tabular-nums' }}>
          {txt}
        </div>
        <div style={{ height: 10, width: CW, background: theme.rule, borderRadius: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${bar * 100}%`, background: theme.accent }} />
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 600, fontSize: fitSize(scene.label, CW, 4, 72, 42), lineHeight: 1.1, color: theme.ink }}>
          <Words text={scene.label} start={6} theme={theme} />
        </div>
      </Box>
    </AbsoluteFill>
  );
};

export const ListScene: React.FC<SceneProps<'list'>> = ({ scene, theme, beat, dur, index }) => {
  const frame = useCurrentFrame();
  const items = scene.items.slice(0, 5);
  // First item on beat 1, the rest spread evenly so the last lands with >= 1.5 beats to read.
  const span = Math.max(beat, dur - beat * 2.5 - beat);
  const step = items.length > 1 ? span / (items.length - 1) : 0;
  const longestItem = items.reduce((a, b) => (b.length > a.length ? b : a), '');
  const itemSize = fitSize(longestItem, CW - 130, 2, 60, 38);
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`l${index}`} />
      <Box gap={44}>
        <div style={{ fontFamily: FONT.display, fontWeight: 760, fontSize: fitSize(scene.title, CW, 3, 96, 56), lineHeight: 1.02, letterSpacing: '-0.03em', color: theme.ink }}>
          <Words text={scene.title} start={0} theme={theme} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
          {items.map((it, i) => {
            const t0 = beat + i * step;
            const p = prog(frame, t0, t0 + 10);
            return (
              <div key={i} style={{ display: 'flex', gap: 28, alignItems: 'flex-start', opacity: p, transform: `translateX(${(1 - p) * 60}px)` }}>
                <span style={{ fontFamily: FONT.mono, fontSize: itemSize * 0.72, color: theme.onAccent, background: theme.accent, borderRadius: 14, minWidth: itemSize * 1.25, textAlign: 'center', lineHeight: 1.45, fontWeight: 700 }}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span style={{ fontFamily: FONT.display, fontWeight: 560, fontSize: itemSize, lineHeight: 1.15, color: theme.ink }}>{it}</span>
              </div>
            );
          })}
        </div>
      </Box>
    </AbsoluteFill>
  );
};

export const CompareScene: React.FC<SceneProps<'compare'>> = ({ scene, theme, beat, index }) => {
  const frame = useCurrentFrame();
  const card = (side: 'left' | 'right', start: number) => {
    const d = scene[side];
    const p = prog(frame, start, start + 12);
    const win = scene.winner === side && frame > beat * 3;
    return (
      <div
        style={{
          background: theme.bg2,
          border: `3px solid ${win ? theme.accent : theme.rule}`,
          borderRadius: 30,
          padding: '36px 44px',
          opacity: p,
          transform: `translateY(${(1 - p) * 50}px)`,
        }}
      >
        <div style={{ fontFamily: FONT.mono, fontSize: 30, letterSpacing: '0.08em', textTransform: 'uppercase', color: win ? theme.accent : theme.faint }}>{d.label}</div>
        <div style={{ fontFamily: FONT.display, fontWeight: 780, fontSize: fitSize(d.value, CW - 90, 2, 110, 54), lineHeight: 1.0, letterSpacing: '-0.03em', color: theme.ink, marginTop: 12 }}>{d.value}</div>
        {d.note ? <div style={{ fontFamily: FONT.text, fontSize: 38, lineHeight: 1.25, color: theme.body, marginTop: 14 }}>{d.note}</div> : null}
      </div>
    );
  };
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`v${index}`} />
      <Box gap={30}>
        {scene.title ? (
          <div style={{ fontFamily: FONT.display, fontWeight: 740, fontSize: fitSize(scene.title, CW, 2, 84, 50), lineHeight: 1.04, color: theme.ink, marginBottom: 10 }}>
            <Words text={scene.title} start={0} theme={theme} />
          </div>
        ) : null}
        {card('left', beat * 0.5)}
        <div style={{ fontFamily: FONT.mono, fontSize: 34, color: theme.faint, textAlign: 'center', opacity: prog(frame, beat, beat + 8) }}>vs</div>
        {card('right', beat * 1.5)}
      </Box>
    </AbsoluteFill>
  );
};

export const QuoteScene: React.FC<SceneProps<'quote'>> = ({ scene, theme, index }) => {
  const frame = useCurrentFrame();
  const mark = prog(frame, 0, 12);
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`q${index}`} />
      <Box gap={24}>
        <div style={{ fontFamily: FONT.text, fontSize: 260, lineHeight: 0.6, color: theme.accent, opacity: mark, height: 130 }}>“</div>
        <div style={{ fontFamily: FONT.text, fontStyle: 'italic', fontSize: fitSize(scene.text, CW, 7, 86, 46, 0.5), lineHeight: 1.18, color: theme.ink }}>
          <Words text={scene.text} start={4} stagger={2} theme={theme} />
        </div>
        {scene.source ? <div style={{ fontFamily: FONT.mono, fontSize: 30, color: theme.faint, opacity: prog(frame, 20, 32) }}>— {scene.source}</div> : null}
      </Box>
    </AbsoluteFill>
  );
};

export const CtaScene: React.FC<SceneProps<'cta'>> = ({ scene, sb, theme, beat, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spr(frame, 0, fps, SPR.pop);
  const pill = spr(frame, beat * 1.5, fps, SPR.pop);
  const beatPulse = hitPulse(frame % Math.round(beat * 2), 1, 4) * (frame > beat * 2 ? 1 : 0);
  const initials = sb.author.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <AbsoluteFill>
      <FieldBg theme={theme} seed={`e${index}`} />
      <Box gap={40}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 30, transform: `scale(${0.8 + 0.2 * a})`, transformOrigin: 'left center', opacity: Math.min(1, a * 1.4) }}>
          <div style={{ width: 150, height: 150, borderRadius: 75, background: theme.accent, color: theme.onAccent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.display, fontWeight: 800, fontSize: 64 }}>{initials}</div>
          <div>
            <div style={{ fontFamily: FONT.display, fontWeight: 720, fontSize: 58, color: theme.ink }}>{sb.author}</div>
            <div style={{ fontFamily: FONT.mono, fontSize: 36, color: theme.faint }}>{sb.handle}</div>
          </div>
        </div>
        <div style={{ fontFamily: FONT.display, fontWeight: 760, fontSize: fitSize(scene.text, CW, 4, 96, 54), lineHeight: 1.04, letterSpacing: '-0.03em', color: theme.ink }}>
          <Words text={scene.text} start={6} theme={theme} />
        </div>
        {scene.sub ? <div style={{ fontFamily: FONT.text, fontSize: 44, lineHeight: 1.25, color: theme.body, opacity: prog(frame, 14, 26) }}>{scene.sub}</div> : null}
        <div
          style={{
            alignSelf: 'flex-start',
            fontFamily: FONT.display,
            fontWeight: 700,
            fontSize: 46,
            color: theme.onAccent,
            background: theme.accent,
            padding: '20px 48px',
            borderRadius: 999,
            transform: `scale(${pill * (1 + beatPulse * 0.04)})`,
            transformOrigin: 'left center',
          }}
        >
          Follow {sb.handle}
        </div>
      </Box>
    </AbsoluteFill>
  );
};

export const SCENES: Record<ReelScene['type'], React.FC<any>> = {
  hook: Hook,
  statement: StatementScene,
  code: CodeScene,
  stat: StatScene,
  list: ListScene,
  compare: CompareScene,
  quote: QuoteScene,
  cta: CtaScene,
};
