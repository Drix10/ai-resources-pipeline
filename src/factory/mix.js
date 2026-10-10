/**
 * The final reel: picture scaled to 1080x1920 (with burned-in captions when the agent did not
 * build its own), then one audio mix:
 *  - music from the planned window of the chosen track, levelled from its analysis, faded in on
 *    the downbeat and out at the end;
 *  - under the voice the music steps down (deeper for tracks with vocals) and a 2.8 kHz pocket is
 *    carved in it, then rises again in every pause longer than about half a second; a light
 *    sidechain catches what the automation misses;
 *  - the voice cleaned up (rumble cut, gentle compression) and levelled;
 *  - the sound-effects bus on top;
 *  - limited and mastered to -14 LUFS / -1.5 dBTP, where Instagram plays it without turning it down.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { decode } = require("./music");

const FONTS = path.resolve(__dirname, "../../factory/library/fonts");
const CAPTION_FONT = "Anton";

function run(args, { cwd, timeoutMs = 15 * 60 * 1000 } = {}) {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (res.error || res.status !== 0) throw new Error(`ffmpeg failed: ${res.error?.code === "ETIMEDOUT" ? `timed out after ${Math.round(timeoutMs / 1000)}s` : res.error?.message || String(res.stderr).slice(-600)}`);
}

/** First pass of two-pass loudness normalisation: what loudnorm measures on this mix. */
function measureLoudness(inputs, graph) {
  const res = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-loglevel", "info", ...inputs, "-filter_complex", `${graph},loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json[a]`, "-map", "[a]", "-f", "null", "-"], { encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  const m = String(res.stderr || "").match(/{[^{}]*"input_i"[^{}]*}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const n = (k) => Number(j[k]);
    return ["input_i", "input_tp", "input_lra", "input_thresh", "target_offset"].every((k) => Number.isFinite(n(k))) ? j : null;
  } catch {
    return null;
  }
}

/** Spoken stretches from word timings: words closer than `gap` seconds belong to one stretch. */
function speechWindows(words, gap = 0.5) {
  const out = [];
  for (const w of words || []) {
    const a = Number(w.start), b = Number(w.end);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    const last = out[out.length - 1];
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  // A filter expression with hundreds of terms is slow: merge the shortest pauses first.
  let g = gap;
  let merged = out;
  while (merged.length > 40) {
    g += 0.25;
    const next = [];
    for (const w of merged) {
      const last = next[next.length - 1];
      if (last && w[0] - last[1] <= g) last[1] = w[1];
      else next.push([...w]);
    }
    merged = next;
  }
  return merged.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000]);
}

/**
 * Music gain over time for ffmpeg's volume filter: 1 in the clear, `duck` while someone speaks,
 * ramping down 120 ms before a stretch and back up over 350 ms after it.
 */
function duckExpression(windows, duck) {
  if (!windows.length) return "1";
  const terms = windows.map(([a, b]) => `clip(min((t-${(a - 0.12).toFixed(3)})/0.12,(${(b + 0.35).toFixed(3)}-t)/0.35),0,1)`);
  const max = terms.reduce((acc, t) => (acc ? `max(${acc},${t})` : t), "");
  return `1-${(1 - duck).toFixed(3)}*${max}`;
}

/** Loudness of the sounding parts of a file (dBFS RMS over the seconds above -45 dB). */
function activeLevel(file, { start = 0, seconds = 0 } = {}) {
  const x = decode(file, { start, seconds });
  const sr = 11025;
  const levels = [];
  for (let s = 0; (s + 0.5) * sr <= x.length; s += 0.5) {
    let acc = 0;
    for (let i = s * sr; i < (s + 0.5) * sr; i++) acc += x[i] * x[i];
    const db = 10 * Math.log10(1e-9 + acc / (0.5 * sr));
    if (db > -45) levels.push(db);
  }
  if (!levels.length) return null;
  return 10 * Math.log10(levels.reduce((a, d) => a + 10 ** (d / 10), 0) / levels.length);
}

const clampDb = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- captions -------------------------------------------------------------------------------

const assColor = (hex) => {
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => m[1].slice(i, i + 2));
  return `&H00${b}${g}${r}`.toUpperCase();
};

const luminance = (hex) => {
  const m = String(hex || "").match(/^#?([0-9a-f]{6})$/i);
  if (!m) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The piece's brightest saturated colour for the spoken word, else a caption yellow. */
function accentFrom(palette) {
  const sat = (hex) => {
    const m = String(hex).match(/^#?([0-9a-f]{6})$/i);
    if (!m) return 0;
    const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return (Math.max(...v) - Math.min(...v)) / 255;
  };
  const pick = (Array.isArray(palette) ? palette : []).filter((c) => luminance(c) > 0.45 && sat(c) > 0.35).sort((a, b) => sat(b) - sat(a))[0];
  return pick || "#FFD60A";
}

const clean = (w) => String(w).replace(/[{}\\]/g, "").toUpperCase();
const stamp = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

/** Groups words into short caption lines: 3 words or 16 characters, broken at pauses and punctuation. */
function captionChunks(words) {
  const chunks = [];
  let cur = [];
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; };
  for (const w of words || []) {
    if (!String(w.w || "").trim()) continue;
    const prev = cur[cur.length - 1];
    const chars = cur.reduce((a, x) => a + x.w.length + 1, 0) + w.w.length;
    if (prev && (cur.length >= 3 || chars > 16 || w.start - prev.end > 0.35 || /[.,!?;:]$/.test(prev.w))) flush();
    cur.push(w);
  }
  flush();
  return chunks;
}

/**
 * Word-by-word captions as ASS: the line appears with a small pop, the word being spoken is lit
 * in the accent colour. Centred in the band y 1190..1340, just above Instagram's caption and buttons.
 */
function captionsAss(words, { accent = "#FFD60A" } = {}) {
  const hi = assColor(accent) || "&H000AD6FF";
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Cap,${CAPTION_FONT},96,&H00FFFFFF,&H00FFFFFF,&H00000000,&H78000000,0,0,0,0,100,100,1.5,0,1,7,4,2,90,150,600,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const chunks = captionChunks(words);
  chunks.forEach((chunk, ci) => {
    const next = chunks[ci + 1];
    const end = Math.min(next ? next[0].start : Infinity, chunk[chunk.length - 1].end + 0.4);
    chunk.forEach((w, i) => {
      const a = i === 0 ? chunk[0].start : w.start;
      const b = i + 1 < chunk.length ? chunk[i + 1].start : end;
      if (b - a < 0.02) return;
      const text = chunk.map((x, j) => (j === i ? `{\\c${hi}\\fscx108\\fscy108}${clean(x.w)}{\\c&H00FFFFFF&\\fscx100\\fscy100}` : clean(x.w))).join(" ");
      const pop = i === 0 ? "{\\fscx88\\fscy88\\t(0,90,\\fscx100\\fscy100)}" : "";
      lines.push(`Dialogue: 0,${stamp(a)},${stamp(b)},Cap,,0,0,0,,${pop}${text}`);
    });
  });
  return `${lines.join("\n")}\n`;
}

// ---- the mix --------------------------------------------------------------------------------

/**
 * Builds reel.mp4 from the agent's film. music: {file, start, refDb, vocals} | null; sfx: wav |
 * null; voice: {file, words} | null; captions: burn our captions (the agent did not build its own).
 * With no music and no voice it falls back to `fallbackWav` (the synth) so a reel is never silent.
 */
function mixReel({ film, out, seconds, music = null, sfx = null, voice = null, captions = false, accent, fallbackWav = null, workDir }) {
  const dir = workDir || path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  // 1. Picture: Instagram's frame, plus captions. ffmpeg runs in `dir` so the subtitle filter gets
  //    plain relative paths (a Windows drive colon would need escaping inside a filter graph).
  const silent = path.join(dir, "reel.video.mp4");
  let vf = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1";
  const words = (voice?.words || []).filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end));
  if (captions && words.length) {
    fs.writeFileSync(path.join(dir, "captions.ass"), captionsAss(words, { accent }));
    const fontsRel = path.relative(dir, FONTS).split(path.sep).join("/") || ".";
    vf += `,ass=captions.ass:fontsdir=${fontsRel}`;
  }
  run(["-i", path.resolve(film), "-vf", vf, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "30", "-an", "reel.video.mp4"], { cwd: dir });

  // 2. Sound.
  const inputs = ["-i", silent];
  const chains = [];
  const mixIn = [];
  let idx = 1;
  const fmt = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  const windows = speechWindows(words);
  let voiceLabel = null;

  if (voice && fs.existsSync(voice.file)) {
    let vGain = 0;
    try { const lv = activeLevel(voice.file); if (lv !== null) vGain = clampDb(-17 - lv, -12, 18); } catch { /* keep 0 */ }
    inputs.push("-i", voice.file);
    chains.push(`[${idx}:a]${fmt},highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=90:makeup=2,volume=${vGain.toFixed(1)}dB,apad=whole_dur=${seconds.toFixed(3)},asplit=2[vo][vsc]`);
    voiceLabel = "vo";
    idx++;
  }
  if (music && fs.existsSync(music.file)) {
    const target = voiceLabel ? -20 : -16;
    const mGain = clampDb(target - (Number.isFinite(music.refDb) ? music.refDb : -14), -24, 12);
    const fadeIn = music.fadeIn ?? 0.06;
    const fadeOut = Math.min(2, Math.max(0.6, seconds * 0.06));
    inputs.push("-ss", Math.max(0, music.start).toFixed(3), "-t", (seconds + 0.5).toFixed(3), "-i", music.file);
    let m = `[${idx}:a]${fmt},volume=${mGain.toFixed(1)}dB,afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, seconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)},apad=whole_dur=${seconds.toFixed(3)}`;
    if (voiceLabel) {
      const duck = music.vocals ? 0.2 : 0.32; // about -14 dB / -10 dB while someone speaks
      m += `,equalizer=f=2800:t=q:w=1.1:g=-4,volume='${duckExpression(windows, duck)}':eval=frame[mraw];[mraw][vsc]sidechaincompress=threshold=0.06:ratio=3:attack=12:release=300[mus]`;
    } else {
      m += "[mus]";
    }
    chains.push(m);
    mixIn.push("[mus]");
    idx++;
  } else if (fallbackWav && fs.existsSync(fallbackWav)) {
    inputs.push("-i", fallbackWav);
    chains.push(`[${idx}:a]${fmt},volume=-3dB,apad=whole_dur=${seconds.toFixed(3)}${voiceLabel ? `[mraw];[mraw][vsc]sidechaincompress=threshold=0.04:ratio=8:attack=15:release=350[mus]` : "[mus]"}`);
    mixIn.push("[mus]");
    idx++;
  } else if (voiceLabel) {
    chains.push("[vsc]anullsink");
  }
  if (sfx && fs.existsSync(sfx)) {
    inputs.push("-i", sfx);
    chains.push(`[${idx}:a]${fmt},volume=-5dB,apad=whole_dur=${seconds.toFixed(3)}[fx]`);
    mixIn.push("[fx]");
    idx++;
  }
  if (voiceLabel) mixIn.push(`[${voiceLabel}]`);
  if (!mixIn.length) {
    // Nothing to hear at all: a silent track keeps the file valid for Instagram.
    inputs.push("-f", "lavfi", "-t", seconds.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo");
    chains.push(`[${idx}:a]anull[sil]`);
    mixIn.push("[sil]");
  }
  const base = `${chains.join(";")};${mixIn.join("")}amix=inputs=${mixIn.length}:normalize=0:duration=longest,atrim=0:${seconds.toFixed(3)},alimiter=limit=0.9:attack=5:release=60`;
  // Two passes: one-pass loudnorm lands a short reel 1-3 LU under target; measured, it is exact.
  const m = measureLoudness(inputs, base);
  const norm = m
    ? `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`
    : "loudnorm=I=-14:TP=-1.5:LRA=11";
  const graph = `${base},${norm},aresample=48000[a]`;
  try {
    run([...inputs, "-filter_complex", graph, "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-t", seconds.toFixed(3), "-movflags", "+faststart", path.resolve(out)]);
  } finally {
    fs.rmSync(silent, { force: true });
  }
  return { video: out, windows, captions: captions && words.length > 0 };
}

module.exports = { mixReel, measureLoudness, speechWindows, duckExpression, captionsAss, captionChunks, accentFrom, activeLevel, FONTS };
