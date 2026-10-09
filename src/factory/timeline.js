/**
 * Node mirror of factory/src/Reel.tsx#reelTimeline. The picture and the soundtrack must agree
 * on every cut, so both compute scene windows from beats with the same rounding.
 * tests/factory.test.js locks the two together on the sample storyboard.
 */
const FPS = 30;

const beatFrames = (bpm, fps = FPS) => (60 / bpm) * fps;

function reelTimeline(sb, fps = FPS) {
  const beat = beatFrames(sb.bpm, fps);
  let t = 0;
  return sb.scenes.map((scene) => {
    const from = Math.round(t);
    t += scene.beats * beat;
    return { from, dur: Math.round(t) - from, scene };
  });
}

function reelDuration(sb, fps = FPS) {
  const tl = reelTimeline(sb, fps);
  const last = tl[tl.length - 1];
  return last ? last.from + last.dur : fps;
}

module.exports = { FPS, beatFrames, reelTimeline, reelDuration };
