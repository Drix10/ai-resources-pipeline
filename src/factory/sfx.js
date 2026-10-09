/**
 * Sound effects for reels, synthesized in code (no samples to license): one stereo WAV the length
 * of the film with every effect placed where the agent's motion lands (out/cues.json "sfx").
 *
 * Kinds: whoosh (camera moves, slides), impact (slams, stamps), boom (the big reveal), riser and
 * swell (build INTO the event: they end on it), tick (counters, typing), pop (elements appearing),
 * glitch (cuts with a glitch), shutter (a screenshot or page capture), type (keystrokes).
 * Every effect is seeded, so a cue list always renders the same file.
 */
const fs = require("fs");

const SR = 48000;
const TAU = Math.PI * 2;
const KINDS = ["whoosh", "impact", "boom", "riser", "swell", "tick", "pop", "glitch", "shutter", "type"];

function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return (s / 4294967296) * 2 - 1;
  };
}

/** RBJ biquad, coefficients recomputed per sample when the frequency moves. */
function biquad(type) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x, f, q = 0.9) => {
    const w = (TAU * Math.min(f, SR * 0.45)) / SR;
    const cs = Math.cos(w);
    const a = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === "bp") { b0 = a; b1 = 0; b2 = -a; } else if (type === "hp") { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; } else { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
    const a0 = 1 + a;
    const y = (b0 * x + b1 * x1 + b2 * x2 + 2 * cs * y1 - (1 - a) * y2) / a0;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

/**
 * Each kind returns {lead, samples: [L[], R[]]}: `lead` seconds of the sound come BEFORE the
 * event time (a whoosh peaks on the cut, a riser ends on it).
 */
const SYNTH = {
  whoosh(rnd) {
    const len = Math.round(0.55 * SR);
    const bp = biquad("bp");
    const L = new Float32Array(len), R = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const env = Math.sin(Math.PI * Math.min(1, p / 0.62) * 0.5) ** 2 * (p < 0.62 ? 1 : Math.exp(-(p - 0.62) * 9));
      const f = 300 * Math.pow(12, Math.sin(Math.PI * p));
      const v = bp(rnd(), f, 1.4) * env * 2.2;
      const pan = p; // left to right
      L[i] = v * (1 - pan * 0.6); R[i] = v * (0.4 + pan * 0.6);
    }
    return { lead: 0.34, samples: [L, R] };
  },
  impact(rnd) {
    const len = Math.round(0.9 * SR);
    const lp = biquad("lp");
    const L = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      ph += (TAU * (42 + 70 * Math.exp(-t * 18))) / SR;
      const body = Math.sin(ph) * Math.exp(-t * 6.5);
      const click = lp(rnd(), 2500) * Math.exp(-t * 45) * 1.6;
      L[i] = Math.tanh((body + click) * 1.4) * 0.9;
    }
    return { lead: 0, samples: [L, L] };
  },
  boom(rnd) {
    const len = Math.round(2.4 * SR);
    const lp = biquad("lp");
    const L = new Float32Array(len), R = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      ph += (TAU * (30 + 55 * Math.exp(-t * 7))) / SR;
      const sub = Math.sin(ph) * Math.exp(-t * 2.2);
      const tail = lp(rnd(), 900) * Math.exp(-t * 3) * 0.7;
      L[i] = Math.tanh((sub + tail) * 1.5) * 0.95;
      R[i] = Math.tanh((sub + tail * 0.8) * 1.5) * 0.95;
    }
    return { lead: 0, samples: [L, R] };
  },
  riser(rnd) {
    const dur = 1.8;
    const len = Math.round(dur * SR);
    const bp = biquad("bp");
    const L = new Float32Array(len), R = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const p = i / len;
      ph += (TAU * (180 * Math.pow(5, p))) / SR;
      const env = p * p * p;
      const v = (bp(rnd(), 250 * Math.pow(24, p), 2) * 1.8 + Math.sin(ph) * 0.25) * env;
      L[i] = v; R[i] = v * (0.8 + 0.2 * Math.sin(TAU * 6 * p));
    }
    return { lead: dur, samples: [L, R] };
  },
  swell(rnd) {
    const dur = 1.4;
    const len = Math.round(dur * SR);
    const hp = biquad("hp");
    const L = new Float32Array(len), R = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const v = hp(rnd(), 3000, 0.7) * Math.pow(p, 4) * 1.6; // a reversed cymbal
      L[i] = v; R[i] = -v;
    }
    return { lead: dur, samples: [L, R] };
  },
  tick() {
    const len = Math.round(0.05 * SR);
    const L = new Float32Array(len);
    for (let i = 0; i < len; i++) { const t = i / SR; L[i] = Math.sin(TAU * 3200 * t) * Math.exp(-t * 260) * 0.7; }
    return { lead: 0, samples: [L, L] };
  },
  pop() {
    const len = Math.round(0.14 * SR);
    const L = new Float32Array(len);
    let ph = 0;
    for (let i = 0; i < len; i++) { const t = i / SR; ph += (TAU * (520 + 1100 * Math.min(1, t / 0.03))) / SR; L[i] = Math.sin(ph) * Math.exp(-t * 38) * 0.7; }
    return { lead: 0, samples: [L, L] };
  },
  glitch(rnd) {
    const len = Math.round(0.3 * SR);
    const L = new Float32Array(len), R = new Float32Array(len);
    let hold = 0, v = 0;
    for (let i = 0; i < len; i++) {
      if (hold-- <= 0) { hold = Math.round((0.002 + Math.abs(rnd()) * 0.02) * SR); v = Math.sign(rnd()) * (0.3 + Math.abs(rnd()) * 0.5); }
      const gate = Math.sin(TAU * 18 * (i / SR)) > -0.2 ? 1 : 0;
      const s = Math.round(v * 4) / 4 * gate * (1 - i / len);
      L[i] = s; R[i] = (i % 400 < 200 ? s : -s);
    }
    return { lead: 0.05, samples: [L, R] };
  },
  shutter(rnd) {
    const len = Math.round(0.16 * SR);
    const bp = biquad("bp");
    const L = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const c1 = Math.exp(-t * 300);
      const c2 = t > 0.045 ? Math.exp(-(t - 0.045) * 220) : 0;
      L[i] = bp(rnd(), 2400, 1.2) * (c1 + c2 * 0.8) * 2.4;
    }
    return { lead: 0, samples: [L, L] };
  },
  type(rnd) {
    const len = Math.round(0.04 * SR);
    const bp = biquad("bp");
    const L = new Float32Array(len);
    for (let i = 0; i < len; i++) { const t = i / SR; L[i] = bp(rnd(), 3000, 1.5) * Math.exp(-t * 180) * 1.8; }
    return { lead: 0, samples: [L, L] };
  },
};

// Relative loudness per kind before the event weight.
const GAIN = { whoosh: 0.55, impact: 0.8, boom: 0.9, riser: 0.45, swell: 0.4, tick: 0.35, pop: 0.4, glitch: 0.4, shutter: 0.5, type: 0.25 };

/**
 * Clean list of events from the agent's cues (or derived from its cuts): known kinds, inside the
 * film, at most one every 80 ms and 120 in all. `speech` windows soften effects under the voice.
 */
function normalizeEvents(cues, seconds, { dropAt = null } = {}) {
  let list = Array.isArray(cues?.sfx) ? cues.sfx : null;
  if (!list) {
    // No sound design from the agent: a whoosh on each cut, and a riser into a boom on the drop.
    const cuts = (Array.isArray(cues?.cuts) ? cues.cuts : []).map(Number).filter((t) => t > 0.3);
    list = cuts.map((t) => ({ t, kind: "whoosh", weight: 0.5 }));
    if (dropAt !== null && dropAt > 2 && dropAt < seconds - 0.5) list.push({ t: dropAt, kind: "riser", weight: 0.6 }, { t: dropAt, kind: "boom", weight: 0.8 });
  }
  const out = [];
  for (const e of list.slice(0, 400)) {
    const t = Number(e?.t);
    const kind = String(e?.kind || "").toLowerCase();
    if (!Number.isFinite(t) || t < 0 || t > seconds || !KINDS.includes(kind)) continue;
    const w = Number.isFinite(Number(e.weight)) ? Math.max(0, Math.min(1, Number(e.weight))) : 0.6;
    out.push({ t, kind, weight: w });
  }
  out.sort((a, b) => a.t - b.t);
  const spaced = [];
  for (const e of out) {
    // Build-ups (riser, swell) may share their event's moment with the hit they lead into.
    const clash = spaced.find((x) => Math.abs(x.t - e.t) < 0.08 && x.kind !== "riser" && x.kind !== "swell" && e.kind !== "riser" && e.kind !== "swell");
    if (!clash) spaced.push(e);
  }
  return spaced.slice(0, 120);
}

/** Renders the effects bus. Returns {file, events} or null when there is nothing to play. */
function renderSfx(file, { seconds, events, speech = [], seed = 11 }) {
  if (!events.length) return null;
  const n = Math.ceil(seconds * SR);
  const L = new Float32Array(n), R = new Float32Array(n);
  const rnd = noise(seed);
  const inSpeech = (t) => speech.some(([a, b]) => t >= a - 0.05 && t <= b + 0.05);
  for (const e of events) {
    const { lead, samples } = SYNTH[e.kind](rnd);
    // Under the voice an effect is a texture, not a competitor.
    const g = GAIN[e.kind] * (0.4 + 0.6 * e.weight) * (inSpeech(e.t) ? 0.55 : 1);
    const s0 = Math.round((e.t - lead) * SR);
    for (let i = 0; i < samples[0].length; i++) {
      const k = s0 + i;
      if (k < 0 || k >= n) continue;
      L[k] += samples[0][i] * g;
      R[k] += samples[1][i] * g;
    }
  }
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const norm = peak > 0.95 ? 0.95 / peak : 1;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * norm * 32767))), 44 + i * 4);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * norm * 32767))), 46 + i * 4);
  }
  fs.writeFileSync(file, buf);
  return { file, events };
}

module.exports = { renderSfx, normalizeEvents, KINDS, SR };
