/**
 * Beat-locked soundtrack synthesized from the same timeline the picture uses
 * (the claude-launchvideo approach, in plain JS so the pipeline needs no Python).
 *
 * Kick on every beat, hat on the off-beats, a sub bass walking a four-chord loop,
 * a soft pad, a riser into the first cut and an impact on every scene cut.
 * Output: 44.1 kHz stereo 16-bit WAV, peak-normalized to -1 dBFS.
 *
 * Original audio, no samples: nothing to clear for copyright on Instagram.
 */
const fs = require("fs");

const SR = 44100;
const TAU = Math.PI * 2;

// Seeded noise so a storyboard always renders the same file.
function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// i – VI – III – VII in A minor (Am F C G): roots for the bass, triads for the pad.
const PROGRESSION = [
  { root: 45, triad: [57, 60, 64] },
  { root: 41, triad: [53, 57, 60] },
  { root: 48, triad: [55, 60, 64] },
  { root: 43, triad: [55, 59, 62] },
];

function synthesize({ bpm = 120, seconds, cuts = [], seed = 7 }) {
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rnd = noise(seed);
  const beat = 60 / bpm;
  const add = (i, l, r = l) => { if (i >= 0 && i < n) { L[i] += l; R[i] += r; } };

  // Kick: pitch-swept sine with a fast amp decay.
  for (let b = 0; b * beat < seconds; b++) {
    const start = Math.round(b * beat * SR);
    for (let k = 0; k < SR * 0.35; k++) {
      const t = k / SR;
      const v = Math.sin(TAU * (48 * t + (110 / 28) * (1 - Math.exp(-t * 28)))) * Math.exp(-t * 9) * 0.9;
      add(start + k, v);
    }
  }

  // Hats on the off-beats, slightly panned.
  for (let b = 0; b * beat < seconds; b++) {
    const start = Math.round((b + 0.5) * beat * SR);
    let hp = 0, prev = 0;
    for (let k = 0; k < SR * 0.06; k++) {
      const x = rnd();
      hp = 0.85 * (hp + x - prev); prev = x;
      const v = hp * Math.exp(-(k / SR) * 70) * 0.16;
      add(start + k, v * 0.8, v);
    }
  }

  // Bass + pad, one chord per bar (4 beats).
  const bar = beat * 4;
  for (let c = 0; c * bar < seconds; c++) {
    const ch = PROGRESSION[c % PROGRESSION.length];
    const s0 = Math.round(c * bar * SR);
    const len = Math.round(bar * SR);
    const fb = midiHz(ch.root);
    for (let k = 0; k < len; k++) {
      const t = k / SR;
      const beatPhase = (t % beat) / beat;
      const duck = 0.35 + 0.65 * Math.min(1, beatPhase * 4); // sidechain-style pump from the kick
      const env = Math.min(1, t * 30) * Math.min(1, (bar - t) * 30);
      const bass = (Math.sin(TAU * fb * t) + 0.3 * Math.sin(TAU * fb * 2 * t)) * 0.22 * env * duck;
      let pad = 0;
      for (const m of ch.triad) {
        const f = midiHz(m);
        pad += Math.sin(TAU * f * t + Math.sin(TAU * 0.3 * t)) + 0.5 * Math.sin(TAU * f * 1.003 * t);
      }
      pad *= 0.028 * env * duck;
      add(s0 + k, bass + pad, bass + pad * 0.9);
    }
  }

  // Riser into the first real cut, and an impact on every cut.
  const firstCut = cuts.find((c) => c > 0.5);
  if (firstCut) {
    const len = Math.round(Math.min(1.5, firstCut) * SR);
    const s0 = Math.round(firstCut * SR) - len;
    for (let k = 0; k < len; k++) {
      const p = k / len;
      add(s0 + k, rnd() * 0.12 * p * p);
    }
  }
  for (const c of cuts) {
    if (c <= 0.01) continue;
    const s0 = Math.round(c * SR);
    for (let k = 0; k < SR * 0.5; k++) {
      const t = k / SR;
      const v = (Math.sin(TAU * 55 * t) * 0.5 + rnd() * 0.25 * Math.exp(-t * 30)) * Math.exp(-t * 6) * 0.6;
      add(s0 + k, v);
    }
  }

  // Fade the tail and normalize.
  const fade = Math.round(0.4 * SR);
  for (let k = 0; k < fade; k++) { const g = k / fade; L[n - 1 - k] *= g; R[n - 1 - k] *= g; }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = 0.891 / peak; // -1 dBFS
  for (let i = 0; i < n; i++) { L[i] = Math.tanh(L[i] * gain * 1.05); R[i] = Math.tanh(R[i] * gain * 1.05); }
  return { L, R };
}

function writeWav(file, { L, R }) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
  return file;
}

/** Writes the soundtrack for a storyboard. `cuts` are scene start times in seconds. */
function renderSoundtrack(file, { bpm, seconds, cuts, seed }) {
  return writeWav(file, synthesize({ bpm, seconds, cuts, seed }));
}

module.exports = { renderSoundtrack, synthesize };
