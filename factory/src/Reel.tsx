import React from 'react';
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion';
import { FONT, REEL, THEMES } from './brand';
import { Grain } from './fx/fx';
import { beatFrames, E, prog } from './lib/anim';
import { FontGate } from './lib/FontGate';
import { SCENES } from './scenes/ReelScenes';
import type { Storyboard } from './schema';

/** Frame windows for every scene, snapped to the beat grid. Shared with the audio cue export. */
export const reelTimeline = (sb: Storyboard, fps = REEL.fps) => {
  const beat = beatFrames(sb.bpm, fps);
  let t = 0;
  return sb.scenes.map((s) => {
    const from = Math.round(t);
    t += s.beats * beat;
    return { from, dur: Math.round(t) - from, scene: s };
  });
};

export const reelDuration = (sb: Storyboard, fps = REEL.fps) => {
  const tl = reelTimeline(sb, fps);
  const last = tl[tl.length - 1];
  return last ? last.from + last.dur : fps;
};

/** Accent shutter that sweeps across every cut (6 frames), so cuts read as intentional beats. */
const CutWipe: React.FC<{ at: number[]; color: string }> = ({ at, color }) => {
  const frame = useCurrentFrame();
  const hit = at.find((c) => frame >= c - 3 && frame < c + 4);
  if (hit === undefined || hit === 0) return null;
  const p = prog(frame, hit - 3, hit + 4, E.inOut);
  const x = -110 + p * 220; // percent
  return <AbsoluteFill style={{ background: color, transform: `translateX(${x}%) skewX(-8deg)`, width: '120%', left: '-10%' }} />;
};

const Progress: React.FC<{ total: number; color: string; track: string }> = ({ total, color, track }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', top: 196, left: REEL.safe.left, width: REEL.w - REEL.safe.left - REEL.safe.right, height: 6, background: track, borderRadius: 3, overflow: 'hidden' }}>
      <div style={{ width: `${(frame / total) * 100}%`, height: '100%', background: color }} />
    </div>
  );
};

export const Reel: React.FC<{ storyboard: Storyboard }> = ({ storyboard: sb }) => {
  const theme = THEMES[sb.theme] ?? THEMES.night;
  const beat = beatFrames(sb.bpm, REEL.fps);
  const tl = reelTimeline(sb);
  const total = reelDuration(sb);
  return (
    <FontGate>
      <AbsoluteFill style={{ background: theme.bg }}>
        {tl.map(({ from, dur, scene }, i) => {
          const C = SCENES[scene.type];
          return (
            <Sequence key={i} from={from} durationInFrames={dur} name={`${i + 1}. ${scene.type}`}>
              <C scene={scene} sb={sb} theme={theme} dur={dur} beat={beat} index={i} />
            </Sequence>
          );
        })}
        <Progress total={total} color={theme.accent} track="rgba(255,255,255,0.14)" />
        <div style={{ position: 'absolute', top: 222, left: REEL.safe.left, fontFamily: FONT.mono, fontSize: 26, color: 'rgba(255,255,255,0.62)', letterSpacing: '0.04em' }}>{sb.handle}</div>
        <CutWipe at={tl.map((s) => s.from)} color={theme.accent} />
        <Grain />
      </AbsoluteFill>
    </FontGate>
  );
};
