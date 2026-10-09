/**
 * Music for reels, only from our own library: factory/library/music/<mood>/<Title - Artist>.mp3.
 *
 *  - catalog(): every track with its analysis (tempo, loudness, energy per second, drops), kept
 *    in music/catalog.json. New or changed files are analysed on first use; hand-edited fields
 *    (vocals, exclude, tags, notes) survive re-analysis.
 *  - chooseTrack(): the director's pick, else the best fit for the piece's mood that the channel
 *    has not used lately; instrumentals first under a voiceover.
 *  - planWindow(): which part of the track plays. Its biggest drop lands on the film's climax and
 *    the window starts on a downbeat, with the beat grid re-fitted on that stretch so the agent
 *    can cut on the real beats.
 *
 * The audio files stay on this machine (gitignored); catalog.json is versioned.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const LIB = path.resolve(__dirname, "../../factory/library");
const MUSIC = path.join(LIB, "music");
const CATALOG = path.join(MUSIC, "catalog.json");
const MOODS = ["educational", "emotional", "inspirational", "storytelling"];
const AUDIO = /\.(mp3|m4a|wav|flac|ogg|aac)$/i;
const SR = 11025; // analysis rate: enough for beats and loudness, a fraction of the memory
const HOP = 256; // onset frames of ~23 ms
const FPS = SR / HOP;
const ANALYSIS_VERSION = 3;

const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

/** "Title - Artist.mp3" in a mood folder -> {id, rel, mood, title, artist}. */
function scanFiles(dir = MUSIC) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const mood of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!mood.isDirectory()) continue;
    for (const f of fs.readdirSync(path.join(dir, mood.name))) {
      if (!AUDIO.test(f)) continue;
      const base = f.replace(AUDIO, "").replace(/\.+$/, "");
      const cut = base.lastIndexOf(" - ");
      const title = (cut > 0 ? base.slice(0, cut) : base).trim();
      const artist = (cut > 0 ? base.slice(cut + 3) : "").trim();
      out.push({ id: slug(`${title} ${artist}`), rel: `${mood.name}/${f}`, mood: mood.name.toLowerCase(), title, artist });
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Mono PCM of (part of) a file at the analysis rate. */
function decode(file, { start = 0, seconds = 0, sr = SR } = {}) {
  const args = ["-v", "error"];
  if (start > 0) args.push("-ss", start.toFixed(3));
  args.push("-i", file);
  if (seconds > 0) args.push("-t", seconds.toFixed(3));
  args.push("-ac", "1", "-ar", String(sr), "-f", "s16le", "-");
  const r = spawnSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024, timeout: 120000, windowsHide: true });
  if (r.error || r.status !== 0) throw new Error(`decode ${path.basename(file)}: ${r.error?.message || String(r.stderr).slice(-200)}`);
  const buf = r.stdout;
  const x = new Float32Array(Math.floor(buf.length / 2));
  for (let i = 0; i < x.length; i++) x[i] = buf.readInt16LE(i * 2) / 32768;
  return x;
}

/** Onset strength per ~23 ms frame: rises in pre-emphasised log energy above their local mean. */
function onsets(x) {
  const n = Math.floor(x.length / HOP);
  const e = new Float32Array(n);
  let prev = 0;
  for (let k = 0; k < n; k++) {
    let s = 0;
    for (let i = k * HOP; i < (k + 1) * HOP; i++) {
      const y = x[i] - 0.97 * prev;
      prev = x[i];
      s += y * y;
    }
    e[k] = Math.log(1e-5 + s / HOP);
  }
  const d = new Float32Array(n);
  for (let k = 1; k < n; k++) d[k] = Math.max(0, e[k] - e[k - 1]);
  // Subtract a ~0.5 s moving mean so steady loud passages do not count as onsets.
  const w = Math.round(FPS / 2);
  const out = new Float32Array(n);
  let acc = 0;
  for (let k = 0; k < n; k++) {
    acc += d[k];
    if (k >= w) acc -= d[k - w];
    out[k] = Math.max(0, d[k] - acc / Math.min(k + 1, w));
  }
  return out;
}

const at = (env, f) => {
  const i = Math.floor(f);
  if (i < 0 || i + 1 >= env.length) return 0;
  const t = f - i;
  return env[i] * (1 - t) + env[i + 1] * t;
};

/**
 * Tempo and phase that best explain the onsets: a coarse autocorrelation (with a prior around
 * 115 bpm, so a half or double tempo does not win on noise), then a comb search around it.
 * Returns {bpm, phase (s), confidence 0..1}.
 */
function fitBeat(env, { around = 0, spread = 0.03 } = {}) {
  if (env.length < FPS * 4) return { bpm: around || 120, phase: 0, confidence: 0 };
  let bpm0 = around;
  if (!bpm0) {
    let mean = 0;
    for (const v of env) mean += v;
    mean /= env.length;
    let best = -Infinity;
    for (let bpm = 60; bpm <= 190; bpm += 0.5) {
      const lag = (FPS * 60) / bpm;
      let s = 0;
      let c = 0;
      for (let k = 0; k + lag + 1 < env.length; k += 2) { s += (env[k] - mean) * (at(env, k + lag) - mean); c++; }
      const prior = Math.exp(-0.5 * (Math.log2(bpm / 115) / 0.9) ** 2);
      const score = (s / Math.max(1, c)) * prior;
      if (score > best) { best = score; bpm0 = bpm; }
    }
  }
  let total = 0;
  for (const v of env) total += v;
  const avg = total / env.length || 1e-9;
  let best = { bpm: bpm0, phase: 0, score: -Infinity };
  for (let bpm = bpm0 * (1 - spread); bpm <= bpm0 * (1 + spread); bpm += bpm0 * 0.0015) {
    const period = (FPS * 60) / bpm;
    for (let ph = 0; ph < period; ph += 0.5) {
      let s = 0;
      let c = 0;
      for (let f = ph; f < env.length; f += period) { s += at(env, f); c++; }
      const score = s / Math.max(1, c);
      if (score > best.score) best = { bpm, phase: ph, score };
    }
  }
  return { bpm: Math.round(best.bpm * 100) / 100, phase: best.phase / FPS, confidence: Math.max(0, Math.min(1, (best.score / avg - 1) / 3)) };
}

/** RMS level per second, in dBFS. */
function energyPerSecond(x) {
  const out = [];
  for (let s = 0; (s + 1) * SR <= x.length; s++) {
    let acc = 0;
    for (let i = s * SR; i < (s + 1) * SR; i++) acc += x[i] * x[i];
    out.push(Math.round(10 * 10 * Math.log10(1e-9 + acc / SR)) / 10);
  }
  return out;
}

const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : -60;
};

/** Where the track kicks in: the biggest rises of 4-second energy, at least 8 s apart. */
function dropsOf(energy) {
  const mean = (a, b) => {
    let s = 0;
    for (let i = a; i < b; i++) s += energy[i];
    return s / Math.max(1, b - a);
  };
  const rises = [];
  for (let t = 4; t + 4 <= energy.length; t++) rises.push({ t, rise: Math.round((mean(t, t + 4) - mean(t - 4, t)) * 10) / 10 });
  const picked = [];
  for (const r of rises.sort((a, b) => b.rise - a.rise)) {
    if (r.rise < 3 || picked.length >= 6) break;
    if (picked.every((p) => Math.abs(p.t - r.t) >= 8)) picked.push(r);
  }
  return picked.sort((a, b) => a.t - b.t);
}

function analyzeTrack(entry, dir = MUSIC) {
  const file = path.join(dir, entry.rel);
  const x = decode(file);
  const energy = energyPerSecond(x);
  // Tempo from the loudest minute: intros and breakdowns often have no clear pulse.
  let from = 0;
  let bestLevel = -Infinity;
  for (let s = 0; s + 60 <= energy.length; s += 5) {
    const level = energy.slice(s, s + 60).reduce((a, b) => a + b, 0);
    if (level > bestLevel) { bestLevel = level; from = s; }
  }
  const part = x.subarray(from * SR, Math.min(x.length, (from + 60) * SR));
  const beat = fitBeat(onsets(part));
  // Slow songs often read at double tempo: fold into 70-150 bpm (the doubled grid still holds
  // every real beat, so the phase stays valid; planWindow re-fits it anyway).
  let bpm = beat.bpm;
  while (bpm > 150) bpm /= 2;
  while (bpm < 70) bpm *= 2;
  return {
    duration: Math.round((x.length / SR) * 100) / 100,
    bpm: Math.round(bpm * 100) / 100,
    beatConfidence: Math.round(beat.confidence * 100) / 100,
    refDb: percentile(energy, 0.9),
    energy: energy.map((v) => Math.round(v)),
    drops: dropsOf(energy),
    version: ANALYSIS_VERSION,
  };
}

// Hand-set fields that analysis never overwrites.
const MANUAL = ["vocals", "exclude", "tags", "notes", "mood"];
const guessVocals = (t) => !/instrumental|\binstr\b|\bscore\b|\bost\b|vivaldi|mozart|bach|beethoven/i.test(`${t.title} ${t.artist}`);

let cached = null;

/**
 * The catalog of tracks present on disk, analysing anything new. Never throws: a track that
 * cannot be decoded is left out (and logged by the caller through the returned `errors`).
 */
function catalog({ dir = MUSIC, file = CATALOG, refresh = false, log = null } = {}) {
  if (cached && !refresh && cached.dir === dir) return cached.tracks;
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")).tracks || {}; } catch { /* first run */ }
  const tracks = [];
  let changed = false;
  for (const t of scanFiles(dir)) {
    const stat = fs.statSync(path.join(dir, t.rel));
    const prev = saved[t.id];
    let entry = prev;
    if (!prev || prev.version !== ANALYSIS_VERSION || prev.size !== stat.size || prev.rel !== t.rel) {
      try {
        entry = { ...t, size: stat.size, ...analyzeTrack(t, dir), vocals: guessVocals(t) };
        for (const k of MANUAL) if (prev && prev[k] !== undefined) entry[k] = prev[k];
        changed = true;
        log?.(`Factory music: analysed ${t.rel} (${entry.bpm} bpm, ${Math.round(entry.duration)} s).`);
      } catch (e) {
        log?.(`Factory music: could not analyse ${t.rel}: ${e.message}`);
        continue;
      }
    }
    tracks.push({ ...entry, file: path.join(dir, t.rel) });
  }
  const gone = Object.keys(saved).filter((id) => !tracks.some((t) => t.id === id));
  if (changed || gone.length) {
    // Tracks that are gone from disk keep their entry (another machine may still have them).
    const out = { ...saved };
    for (const t of tracks) {
      const { file: _f, ...rest } = t;
      out[t.id] = rest;
    }
    const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, `${JSON.stringify({ note: "Analysed by src/factory/music.js. Edit vocals/exclude/tags/notes by hand; they survive re-analysis.", tracks: sorted }, null, 1)}\n`);
      fs.renameSync(tmp, file);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      log?.(`Factory music: catalog not saved (${e.message}).`);
    }
  }
  cached = { dir, tracks };
  return tracks;
}

/** One line per track for the director. */
function catalogLines(tracks) {
  return tracks.filter((t) => !t.exclude).map((t) => {
    const drops = (t.drops || []).slice(0, 3).map((d) => `${d.t}s`).join(", ");
    return `- ${t.id} | ${t.mood} | "${t.title}"${t.artist ? ` by ${t.artist}` : ""} | ${Math.round(t.bpm)} bpm | ${t.vocals ? "vocals" : "instrumental"} | ${Math.round(t.duration)} s${drops ? ` | drops at ${drops}` : ""}`;
  }).join("\n");
}

// Mood from what the story is about, when the director did not pick a track.
const MOOD_WORDS = {
  emotional: /\b(died|death|lost|loss|grief|layoffs?|fired|lonely|fear|afraid|doom|risk|warning|danger|sad|tragic|harm|crisis)\b/i,
  inspirational: /\b(launch(?:ed|es)?|ship(?:ped|s)?|built|record|breakthrough|first|beat|won|milestone|open[- ]sourced?|free|dream|future)\b/i,
  educational: /\b(how|why|explained|guide|tutorial|learn|works?|step|framework|library|api|benchmark|paper|architecture)\b/i,
};

function moodFor(text) {
  const s = String(text || "");
  const score = (re) => (s.match(new RegExp(re.source, "gi")) || []).length;
  const ranked = Object.entries(MOOD_WORDS).map(([m, re]) => [m, score(re)]).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] > 0 ? ranked[0][0] : "storytelling";
}

/** The director's "MUSIC: <id>" line, if it names a real track. */
function directorPick(director, tracks) {
  const m = String(director || "").match(/^\s*(?:[#*\s]*)MUSIC\s*[:\-]\s*\**\s*([a-z0-9-]+)/im);
  return m ? tracks.find((t) => t.id === m[1]) || null : null;
}

/**
 * The track for a piece. Director's pick first (when it is long enough), else the best of the
 * mood's tracks that were not used in the last pieces: instrumental under a voice, a drop that can
 * land on the climax, and a little chance so the same few tracks do not take every slot.
 */
function chooseTrack({ tracks, mood, seconds, climaxAt, narrated, recent = [], director = null, random = Math.random }) {
  const usable = (tracks || []).filter((t) => !t.exclude && t.duration >= seconds + 2);
  if (!usable.length) return null;
  const picked = directorPick(director, usable);
  if (picked) return picked;
  const fresh = usable.filter((t) => !recent.includes(t.id));
  const pool = fresh.length ? fresh : usable;
  const scored = pool.map((t) => {
    const dropFits = (t.drops || []).some((d) => d.t >= climaxAt && d.t - climaxAt + seconds <= t.duration - 0.5);
    const score = (t.mood === mood ? 3 : 0) + (narrated && !t.vocals ? 2 : 0) + (dropFits ? 1.5 : 0) + random() * 1.5;
    return { t, score };
  });
  return scored.sort((a, b) => b.score - a.score)[0].t;
}

/**
 * Which part of the track plays under a film of `seconds`. Returns everything the agent needs to
 * cut on the music, in FILM time: {start, seconds, bpm, beats, bars, dropAt, energy}.
 */
function planWindow(track, { seconds, climaxAt }) {
  const dur = track.duration;
  const maxStart = Math.max(0, dur - seconds - 0.5);
  let start = null;
  let dropAt = null;
  // The biggest drop that can land on the climax.
  const fits = (track.drops || []).filter((d) => d.t - climaxAt >= 0 && d.t - climaxAt <= maxStart).sort((a, b) => b.rise - a.rise);
  if (fits.length) {
    start = fits[0].t - climaxAt;
    dropAt = climaxAt;
  } else {
    // Otherwise the loudest stretch that does not open on silence.
    const e = track.energy || [];
    const floor = (track.refDb ?? -20) - 12;
    let best = -Infinity;
    for (let s = 0; s <= Math.floor(maxStart); s++) {
      if ((e[s] ?? -90) < floor) continue;
      let sum = 0;
      for (let i = s; i < Math.min(e.length, s + seconds); i++) sum += e[i];
      if (sum > best) { best = sum; start = s; }
    }
    if (start === null) start = 0;
    const d = (track.drops || []).find((x) => x.t > start + 2 && x.t < start + seconds - 2);
    if (d) dropAt = d.t - start;
  }

  // Re-fit the grid on this stretch (tempo drifts in played music) and start on a downbeat.
  let bpm = track.bpm || 120;
  let phase = 0;
  try {
    const from = Math.max(0, start - 1);
    const env = onsets(decode(track.file, { start: from, seconds: seconds + 3 }));
    const fit = fitBeat(env, { around: bpm, spread: 0.02 });
    bpm = fit.bpm;
    phase = from + fit.phase; // absolute time of a beat
    // The strongest of the four beat positions is the downbeat.
    const beat = 60 / bpm;
    let bestK = 0;
    let bestS = -1;
    for (let k = 0; k < 4; k++) {
      let s = 0;
      for (let t = fit.phase + k * beat; t * FPS < env.length; t += 4 * beat) s += at(env, t * FPS);
      if (s > bestS) { bestS = s; bestK = k; }
    }
    phase += bestK * beat;
  } catch { /* keep the catalog grid */ }
  const beat = 60 / bpm;
  // Snap the start to the nearest downbeat (moves the drop by under half a bar).
  const bar = beat * 4;
  const k = Math.round((start - phase) / bar);
  let snapped = phase + k * bar;
  if (snapped < 0) snapped += bar;
  if (snapped > maxStart) snapped -= bar;
  if (snapped >= 0 && snapped <= maxStart) {
    if (dropAt !== null) dropAt += start - snapped;
    start = snapped;
  }
  const beats = [];
  for (let t = phase + Math.ceil((start - phase) / beat - 1e-6) * beat - start; t < seconds; t += beat) if (t >= 0) beats.push(Math.round(t * 1000) / 1000);
  const bars = beats.filter((_, i) => i % 4 === 0);
  // Drops are found at 1 s resolution and real drops sit on a bar line: put it on the nearest one.
  if (dropAt !== null && bars.length) dropAt = bars.reduce((best, b) => (Math.abs(b - dropAt) < Math.abs(best - dropAt) ? b : best), bars[0]);
  if (dropAt !== null && (dropAt < 1 || dropAt > seconds - 0.5)) dropAt = null;
  // Energy over the film, 0-9 per second, for building intensity with the music.
  const e = (track.energy || []).slice(Math.floor(start), Math.floor(start) + Math.ceil(seconds));
  const lo = Math.min(...e, track.refDb - 30);
  const hi = Math.max(...e, track.refDb);
  const energy = e.map((v) => Math.max(0, Math.min(9, Math.round(((v - lo) / Math.max(1, hi - lo)) * 9)))).join("");
  return {
    start: Math.round(start * 1000) / 1000,
    seconds,
    bpm: Math.round(bpm * 100) / 100,
    beats,
    bars,
    dropAt: dropAt === null ? null : Math.round(dropAt * 1000) / 1000,
    energy,
  };
}

/** The music section of the agent's brief. */
function musicBlock(track, plan) {
  const list = (a, n) => a.slice(0, n).map((t) => t.toFixed(2)).join(", ");
  return `MUSIC (chosen for this piece; mixed in afterwards, so render the film muted)
Track: "${track.title}"${track.artist ? ` by ${track.artist}` : ""} (${track.mood}, ${plan.bpm} bpm, ${track.vocals ? "has vocals: they sit under the voice" : "instrumental"}). It plays from the first frame for ~${Math.round(plan.seconds)} s.
- Beats (film seconds): every ${(60 / plan.bpm).toFixed(3)} s from ${plan.beats[0]?.toFixed(2) ?? "0.00"}. Downbeats (cut here): ${list(plan.bars, 40)}${plan.bars.length > 40 ? ", ..." : ""}.
${plan.dropAt !== null ? `- The music drops at ${plan.dropAt.toFixed(2)} s: land the piece's biggest turn or reveal exactly there.\n` : ""}- Energy per second (0 quiet .. 9 loud): ${plan.energy}
Cut on downbeats, land hits on beats, build with the energy curve, and let the quiet stretches breathe. Aim the film at ~${Math.round(plan.seconds)} s so the section fits.`;
}

module.exports = {
  catalog, catalogLines, chooseTrack, planWindow, musicBlock, moodFor, directorPick, scanFiles, decode, onsets,
  fitBeat, energyPerSecond, dropsOf, analyzeTrack, MUSIC, CATALOG, MOODS, SR, FPS,
};
