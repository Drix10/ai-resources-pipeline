/**
 * Voiceover for reels.
 *
 * The script is written with the storyboard (a `voiceover` line per scene, with ElevenLabs
 * audio tags like [curious], [pause], [deadpan] or [low, steady voice]) and passes the same fact
 * gate as on-screen text, tags stripped. It is spoken BEFORE the film is built, so the director
 * and the agent can land every reveal on its spoken word.
 *
 * Providers (one 6-minute deadline for the whole step):
 *  - ElevenLabs (main, ELEVENLABS_API_KEY): /v1/text-to-speech/{voice}/with-timestamps with the
 *    latest model (ELEVENLABS_MODEL, default eleven_v4; then the fallbacks). The whole script in
 *    one request; character alignment gives exact word timings. Only eleven_v3/v4 perform
 *    audio tags: other models get the script with tags removed, so they never read them aloud.
 *  - OpenRouter (fallback, OPENROUTER_API_KEY): a speech model (openai/gpt-audio-mini) over
 *    streaming chat completions, one request per scene. That model can stop mid-script and keep
 *    streaming silence or noise while its transcript claims the whole text, so every clip is
 *    proven by its own audio (enough voiced time, no long gap, a length cap) and transcript,
 *    trimmed to its speech and joined. Scene windows are exact; word timings are estimated.
 *
 * Refusals are remembered by cause, with an expiry: a bad key blocks the provider for 6 h, a
 * model the account cannot use blocks that model for 24 h, a quota or a script-specific error
 * blocks nothing (the next reel tries again).
 *
 * Output: voice.wav (48 kHz mono) + voice.json {provider, model, seconds, approximate, scenes:
 * [{scene, start, end, text}], words: [{w, start, end, scene}]}. Cached by script + voice.
 * Never throws: a reel without a voice still gets made.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");
const { ffmpeg } = require("./render");
const { STATE_DIR } = require("./queue");

const CACHE = path.join(STATE_DIR, "voice-cache");
const CACHE_VERSION = "v2"; // bump when a change makes old takes wrong
const CACHE_DAYS = 30;
const STAGE_DEADLINE_MS = 6 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 180000;
const TAG = /\[[^\]\n]{1,60}\]/g;
const TAG_MODELS = /^eleven_v[34]/;
const EL_BASE = "https://api.elevenlabs.io";

const stripTags = (t) => String(t || "").replace(TAG, " ").replace(/\s+/g, " ").trim();
const wordsOf = (t) => stripTags(t).split(/\s+/).filter(Boolean);
const tagsOf = (t) => (String(t || "").match(TAG) || []).map((x) => x.slice(1, -1).trim());
/** For a model that cannot perform tags: pauses become an ellipsis, everything else goes. */
const untagged = (t) => String(t || "").replace(TAG, (m) => (/pause/i.test(m) ? " ... " : " ")).replace(/\s+/g, " ").trim();

/** The spoken script: one entry per scene that has a voiceover line, in order. */
function scriptOf(storyboard) {
  return (storyboard.scenes || [])
    .map((s, i) => ({ scene: i + 1, text: s && typeof s.voiceover === "string" ? s.voiceover.trim() : "" }))
    .filter((s) => stripTags(s.text));
}

/**
 * Word timings from an ElevenLabs character alignment. Bracketed tags are skipped whether or not
 * the model echoes them, and a tag ends the word before it ("Wait[pause]what" is two words).
 * Returns null when the words do not line up.
 */
function wordsFromAlignment(alignment, expected) {
  const chars = alignment?.characters || [];
  const starts = alignment?.character_start_times_seconds || [];
  const ends = alignment?.character_end_times_seconds || [];
  const words = [];
  let cur = null;
  let depth = 0;
  const flush = () => { if (cur) { words.push(cur); cur = null; } };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "[") { flush(); depth++; continue; }
    if (c === "]") { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    if (/\s/.test(c)) { flush(); continue; }
    if (!cur) cur = { w: "", start: Number(starts[i]) || 0, end: Number(ends[i]) || 0 };
    cur.w += c;
    cur.end = Number(ends[i]) || cur.end;
  }
  flush();
  if (words.length !== expected.length) return null;
  return words.map((x, i) => ({ w: expected[i], start: x.start, end: Math.max(x.end, x.start) }));
}

/**
 * Estimated word timings across [lead, end]: each word weighted by its length, with extra room
 * after punctuation (where a speaker pauses). Punctuation-only tokens ("—", "...") take little.
 */
function estimateWords(expected, lead, end) {
  const weight = (w) => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
    if (!letters) return 0.5;
    return letters + 2 + (/[.!?…]$/.test(w) ? 6 : /[,;:—–-]$/.test(w) ? 3 : 0);
  };
  const total = expected.reduce((a, w) => a + weight(w), 0) || 1;
  const span = Math.max(0.1, end - lead);
  let t = lead;
  return expected.map((w) => {
    const d = (weight(w) / total) * span;
    const out = { w, start: t, end: t + d * 0.85 };
    t += d;
    return out;
  });
}

/** Groups word timings into per-scene windows. */
function sceneWindows(script, words) {
  let k = 0;
  return script.map((s) => {
    const n = wordsOf(s.text).length;
    const mine = words.slice(k, k + n);
    k += n;
    return { scene: s.scene, start: mine[0]?.start ?? 0, end: mine[mine.length - 1]?.end ?? 0, text: stripTags(s.text) };
  });
}

/** Seconds of a media file, or 0. */
function duration(file) {
  const out = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 30000 });
  const s = Number(String(out.stdout || "").trim());
  return Number.isFinite(s) && s > 0 ? s : 0;
}

const NUMBER_WORDS = new Set("zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand million billion trillion point percent".split(" "));

/** Words to compare a read against: numbers, units and spelled-out figures are left out (a TTS may say "two thousand twenty-four" for "2024"), runs of single letters join ("G R P C" -> "grpc"). */
function comparable(text) {
  const raw = String(text || "").toLowerCase().replace(/(\d)[,.](?=\d)/g, "$1").replace(/(\d)([a-z])/g, "$1 $2").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const out = [];
  for (const w of raw) {
    if (/\d/.test(w) || NUMBER_WORDS.has(w) || /^(ms|s|kb|mb|gb|tb|x|k)$/.test(w)) continue;
    if (w.length === 1 && out.length && out[out.length - 1].single) { out[out.length - 1].w += w; continue; }
    out.push({ w, single: w.length === 1 });
  }
  return out.map((x) => x.w);
}

/**
 * How faithfully `heard` reads `expected`: the longest common subsequence of their words over the
 * expected length, discounted when the reply is much longer than the script (an answer, not a read).
 */
function similarity(expected, heard) {
  const a = comparable(expected);
  const b = comparable(heard);
  if (!a.length) return b.length ? 0 : 1;
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  let score = dp[a.length][b.length] / a.length;
  const limit = a.length * 1.5 + 3;
  if (b.length > limit) score *= limit / b.length;
  return score;
}

/** RMS level (dBFS) of every 50 ms window of a 48 kHz file. */
function levelsOf(file) {
  const out = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "aresample=48000,asetnsamples=2400,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level", "-f", "null", "-"], { encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
  return [...String(out.stderr || "").matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) => (m[1] === "-inf" ? -Infinity : Number(m[1])));
}

const WIN = 0.05;

/**
 * Where the speech in a clip starts and ends, judged against the clip's own peak (a whisper is
 * still speech), and whether it is a full read of `words` words: enough voiced time, no long gap
 * in the middle, and a cap on length so a trailing noise bed is never taken for speech.
 */
function analyzeLevels(levels, words) {
  const finite = levels.filter(Number.isFinite);
  if (!finite.length) return { ok: false, reason: "no audio" };
  const peak = Math.max(...finite);
  const thr = Math.max(-55, peak - 26);
  const voicedAt = (i) => levels[i] > thr;
  const first = levels.findIndex((_, i) => voicedAt(i));
  if (first < 0) return { ok: false, reason: "silent" };
  const needVoiced = words / 4.5; // seconds of voiced windows a full read cannot be under
  const maxLen = words / 1.9 + 0.8; // seconds a slow but natural read stays within
  let voiced = 0;
  let lastVoiced = first;
  let gap = 0;
  let maxGap = 0;
  let endIdx = -1;
  for (let i = first; i < levels.length; i++) {
    if ((i - first) * WIN > maxLen) break;
    if (voicedAt(i)) {
      maxGap = Math.max(maxGap, gap);
      gap = 0;
      voiced += WIN;
      lastVoiced = i;
    } else {
      gap += WIN;
      if (gap >= 0.7 && voiced >= needVoiced) { endIdx = lastVoiced; break; }
    }
  }
  if (endIdx < 0) endIdx = lastVoiced;
  const start = Math.max(0, first * WIN - 0.05);
  const end = (endIdx + 1) * WIN;
  if (voiced < needVoiced) return { ok: false, start, end, voiced, reason: `voiced ${voiced.toFixed(2)} s of ${needVoiced.toFixed(2)} s needed` };
  if (maxGap > 1.5) return { ok: false, start, end, voiced, reason: `a ${maxGap.toFixed(1)} s gap mid-read` };
  return { ok: true, start, end, voiced };
}

// ---------------------------------------------------------------- refusals and retries

const refusals = new Map(); // "elevenlabs" or "elevenlabs:eleven_v4" -> expiry ms
const isRefused = (name, model) => [name, `${name}:${model}`].some((k) => (refusals.get(k) || 0) > Date.now());

/** What an error says about the provider: block the provider, block the model, or nothing. */
function refusalOf(e) {
  const s = Number(e?.status) || 0;
  const msg = String(e?.message || "");
  if (s === 401 && /quota|credit|limit|exceed/i.test(msg)) return null; // out of credits: try again next reel
  if (s === 402) return null;
  if (s === 401 || s === 403) return { scope: "provider", ms: 6 * 3600 * 1000 };
  if ((s === 400 || s === 404 || s === 422) && /model/i.test(msg)) return { scope: "model", ms: 24 * 3600 * 1000 };
  return null; // script-specific or transient
}

const isNetworkError = (e) => e?.name === "TypeError" || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket|fetch failed|network/i.test(String(e?.message || e?.cause?.code || ""));
const isTimeout = (e) => e?.name === "TimeoutError" || e?.name === "AbortError";

/** Retries network errors, 429 and 5xx (honouring Retry-After) and a timeout once, within the deadline. */
async function withRetry(fn, deadline) {
  let timeouts = 0;
  for (let attempt = 1; ; attempt++) {
    const left = deadline - Date.now();
    if (left < 5000) throw new Error("voice deadline reached");
    try {
      return await fn(Math.min(REQUEST_TIMEOUT_MS, left));
    } catch (e) {
      const retryable = e.status === 429 || e.status >= 500 || (!e.status && isNetworkError(e)) || (isTimeout(e) && ++timeouts <= 1);
      if (!retryable || attempt >= 3) throw e;
      const wait = Math.min(30000, Math.max(Number(e.retryAfter) * 1000 || 0, 4000 * attempt));
      if (Date.now() + wait > deadline - 5000) throw e;
      await sleep(wait);
    }
  }
}

const httpError = async (res, label) => Object.assign(new Error(`${label} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`), { status: res.status, retryAfter: res.headers.get("retry-after") });

// ---------------------------------------------------------------- ElevenLabs (main)

/** v3/v4 accept only three stability steps; snap to the nearest. */
const stabilityFor = (model, s) => (TAG_MODELS.test(model) ? [0, 0.5, 1].reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a)) : s);

async function elevenlabs(text, { model, voiceId, apiKey, stability }, timeoutMs) {
  const res = await fetch(`${EL_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": apiKey },
    body: JSON.stringify({ text, model_id: model, voice_settings: { stability: stabilityFor(model, stability), similarity_boost: 0.8, use_speaker_boost: true } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await httpError(res, `ElevenLabs ${model}`);
  const data = await res.json();
  if (!data.audio_base64) throw new Error(`ElevenLabs ${model} returned no audio`);
  return { audio: Buffer.from(data.audio_base64, "base64"), ext: "mp3", alignment: data.alignment || data.normalized_alignment || null };
}

// ---------------------------------------------------------------- OpenRouter (fallback)

const OR_SYSTEM = (delivery) => `You are a text-to-speech engine, not an assistant. Speak the text inside <script></script> aloud exactly as written, word for word, and nothing else: no greeting, no reply, no commentary, no questions, no sound after the last word. Delivery: ${delivery}.`;

async function openrouterSpeech(plain, { model, voice, apiKey, baseUrl, delivery }, timeoutMs) {
  // Speech runs at roughly 2-3 words/s; anything far past that is the model rambling on.
  const budgetBytes = Math.ceil((wordsOf(plain).length / 1.6 + 4) * 24000 * 2);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "ai-resources-pipeline/factory" },
    body: JSON.stringify({ model, modalities: ["text", "audio"], audio: { voice, format: "pcm16" }, stream: true, temperature: 0, messages: [{ role: "system", content: OR_SYSTEM(delivery) }, { role: "user", content: `<script>${plain}</script>` }] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw await httpError(res, `OpenRouter ${model}`);
  const chunks = [];
  let bytes = 0;
  let transcript = "";
  let buf = "";
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  const onLine = (raw) => {
    const m = raw.trim().match(/^data:\s?(\{.*)$/);
    if (!m) return false;
    let ev;
    try { ev = JSON.parse(m[1]); } catch { return false; }
    // Providers report failures inside the stream, with a 200 status.
    if (ev.error) throw Object.assign(new Error(`OpenRouter ${model} stream error: ${String(ev.error.message || ev.error).slice(0, 200)}`), { status: Number(ev.error.code) || 502 });
    const choice = ev.choices?.[0];
    if (choice?.finish_reason === "error") throw Object.assign(new Error(`OpenRouter ${model} stream ended in error`), { status: 502 });
    const audio = choice?.delta?.audio;
    if (audio?.transcript) transcript += audio.transcript;
    if (audio?.data) {
      const b = Buffer.from(audio.data, "base64");
      chunks.push(b);
      bytes += b.length;
      if (bytes > budgetBytes) return true;
    }
    return false;
  };
  try {
    outer: for (;;) {
      const { done, value } = await reader.read();
      buf += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (onLine(line)) break outer;
      }
      if (done) {
        if (buf) onLine(buf); // a last event without a trailing newline
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  if (!bytes) throw new Error(`OpenRouter ${model} returned no audio`);
  return { audio: Buffer.concat(chunks), ext: "pcm", transcript };
}

// ---------------------------------------------------------------- shared audio steps

/** Decodes provider audio (mp3, or raw 24 kHz pcm16) into a 48 kHz mono WAV, written atomically. */
function toWav(buf, ext, out) {
  const raw = `${out}.src.${ext}`;
  const tmp = `${out}.tmp.wav`;
  fs.writeFileSync(raw, buf);
  try {
    const input = ext === "pcm" ? ["-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw] : ["-i", raw];
    ffmpeg([...input, "-ar", "48000", "-ac", "1", tmp], { timeoutMs: 120000 });
    fs.renameSync(tmp, out);
  } finally {
    fs.rmSync(raw, { force: true });
    fs.rmSync(tmp, { force: true });
  }
}

/** ElevenLabs: the whole script in one request (consistent read), exact word timings from the alignment. */
async function speakElevenLabs(text, expected, opts, outWav, deadline) {
  const sent = TAG_MODELS.test(opts.model) ? text : untagged(text);
  const got = await withRetry((t) => elevenlabs(sent, opts, t), deadline);
  toWav(got.audio, got.ext, outWav);
  const words = wordsFromAlignment(got.alignment, expected);
  if (words) return { words, approximate: false };
  const seconds = duration(outWav);
  return { words: estimateWords(expected, 0.05, Math.max(0.5, seconds - 0.2)), approximate: true };
}

const SCENE_GAP = 0.3;

/** OpenRouter fallback: one request per scene, every clip proven by its own audio, trimmed and joined. */
async function speakOpenRouter(script, opts, outWav, deadline) {
  const clips = [];
  const words = [];
  let t = 0;
  try {
    for (const s of script) {
      const plain = stripTags(s.text);
      const sceneWords = wordsOf(s.text);
      let clip = null;
      let last = "";
      for (let attempt = 1; attempt <= 3 && !clip; attempt++) {
        const raw = `${outWav}.s${s.scene}.wav`;
        const trimmed = `${outWav}.s${s.scene}.trim.wav`;
        try {
          const got = await withRetry((tm) => openrouterSpeech(plain, opts, tm), deadline);
          toWav(got.audio, got.ext, raw);
          const read = analyzeLevels(levelsOf(raw), sceneWords.length);
          const match = similarity(plain, got.transcript);
          if (read.ok && match >= 0.85) {
            ffmpeg(["-i", raw, "-ss", read.start.toFixed(3), "-to", (read.end + 0.12).toFixed(3), "-af", `afade=t=out:st=${Math.max(0, read.end - read.start - 0.05).toFixed(3)}:d=0.15`, trimmed], { timeoutMs: 60000 });
            clip = trimmed;
          } else {
            last = read.ok ? `transcript match ${match.toFixed(2)}` : read.reason;
          }
        } catch (e) {
          if (e.status && e.status < 500 && e.status !== 429) throw e; // not something another attempt fixes
          last = e.message;
          if (/deadline/.test(e.message)) throw e;
        } finally {
          fs.rmSync(raw, { force: true });
          if (clip !== trimmed) fs.rmSync(trimmed, { force: true });
        }
      }
      if (!clip) throw new Error(`scene ${s.scene} was not read in full (${last})`);
      clips.push(clip);
      const len = duration(clip);
      for (const w of estimateWords(sceneWords, t + 0.02, t + Math.max(0.2, len - 0.08))) words.push({ ...w, scene: s.scene });
      t += len + SCENE_GAP;
    }
    const inputs = clips.flatMap((c) => ["-i", c]);
    const pads = clips.map((_, i) => `[${i}:a]apad=pad_dur=${i < clips.length - 1 ? SCENE_GAP : 0}[a${i}]`).join(";");
    const joins = clips.map((_, i) => `[a${i}]`).join("");
    const tmp = `${outWav}.tmp.wav`;
    try {
      ffmpeg([...inputs, "-filter_complex", `${pads};${joins}concat=n=${clips.length}:v=0:a=1[out]`, "-map", "[out]", "-ar", "48000", "-ac", "1", tmp], { timeoutMs: 120000 });
      fs.renameSync(tmp, outWav);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    return { words, approximate: true };
  } finally {
    for (const c of clips) fs.rmSync(c, { force: true });
  }
}

// ---------------------------------------------------------------- public API

/** Delivery directions for a provider that cannot perform tags. */
const deliveryFrom = (script) => {
  const tags = [...new Set(script.flatMap((s) => tagsOf(s.text)).filter((t) => !/pause/i.test(t)))].slice(0, 6);
  return `confident, curious senior engineer explaining something surprising to a peer; crisp consonants; natural pauses at full stops${tags.length ? `; moments of: ${tags.join(", ")}` : ""}`;
};

/** True when a voice can be made at all (voice on and some provider key set). */
const voiceAvailable = () => config.factory.voice.enabled && !!(config.factory.voice.elevenlabsKey || config.llm?.openrouter?.apiKey);

function pruneCache() {
  const cutoff = Date.now() - CACHE_DAYS * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(CACHE)) {
    const p = path.join(CACHE, f);
    try { if (fs.statSync(p).mtimeMs < cutoff || /\.(tmp\.wav|src\.\w+)$/.test(f)) fs.rmSync(p, { force: true }); } catch { /* in use */ }
  }
}

/**
 * Speaks the storyboard's voiceover script. Returns the voice manifest (also voice.json next to
 * voice.wav in outDir) or null when voice is off, there is no script, or every provider failed.
 */
async function synthesizeVoice(storyboard, outDir) {
  try {
    const v = config.factory.voice;
    const script = scriptOf(storyboard);
    if (!v.enabled || !script.length) return null;
    const text = script.map((s) => s.text).join(" ");
    const expected = wordsOf(text);
    const providers = [];
    if (v.elevenlabsKey) for (const model of [v.model, ...v.fallbackModels]) providers.push({ name: "elevenlabs", model });
    if (config.llm?.openrouter?.apiKey) providers.push({ name: "openrouter", model: v.orModel });
    if (!providers.length) {
      logger.warn("Factory voice: no ELEVENLABS_API_KEY or OPENROUTER_API_KEY; the reel gets music only.");
      return null;
    }
    fs.mkdirSync(CACHE, { recursive: true });
    pruneCache();
    const deadline = Date.now() + STAGE_DEADLINE_MS;
    const wav = path.join(outDir, "voice.wav");
    const manifestFile = path.join(outDir, "voice.json");
    const cacheOf = (p) => {
      const voiceName = p.name === "elevenlabs" ? v.voiceId : v.orVoice;
      const salt = `${CACHE_VERSION}|${p.name}|${p.model}|${voiceName}|${stabilityFor(p.model, v.stability)}|${TAG_MODELS.test(p.model)}`;
      const hash = crypto.createHash("sha1").update(`${salt}|${JSON.stringify(script)}`).digest("hex").slice(0, 16);
      return { voiceName, cachedWav: path.join(CACHE, `${hash}.wav`), cachedJson: path.join(CACHE, `${hash}.json`) };
    };
    const readCached = (p) => {
      const c = cacheOf(p);
      if (!fs.existsSync(c.cachedWav) || !fs.existsSync(c.cachedJson)) return null;
      try {
        return JSON.parse(fs.readFileSync(c.cachedJson, "utf8"));
      } catch {
        fs.rmSync(c.cachedWav, { force: true });
        fs.rmSync(c.cachedJson, { force: true });
        return null;
      }
    };
    // Best first: ElevenLabs (cached, then live), then the fallback (cached, then live).
    const order = [];
    for (const name of ["elevenlabs", "openrouter"]) {
      const mine = providers.filter((p) => p.name === name);
      order.push(...mine.map((p) => ({ ...p, cached: true })), ...mine.map((p) => ({ ...p, cached: false })));
    }
    for (const p of order) {
      if (!p.cached && isRefused(p.name, p.model)) continue;
      const { voiceName, cachedWav, cachedJson } = cacheOf(p);
      try {
        let manifest = readCached(p);
        if (!manifest) {
          if (p.cached) continue;
          if (Date.now() > deadline - 5000) { logger.warn("Factory voice: deadline reached."); break; }
          const spoken = p.name === "elevenlabs"
            ? await speakElevenLabs(text, expected, { model: p.model, voiceId: v.voiceId, apiKey: v.elevenlabsKey, stability: v.stability }, cachedWav, deadline)
            : await speakOpenRouter(script, { model: p.model, voice: v.orVoice, apiKey: config.llm.openrouter.apiKey, baseUrl: config.llm.openrouter.baseUrl, delivery: deliveryFrom(script) }, cachedWav, deadline);
          const { words, approximate } = spoken;
          const seconds = duration(cachedWav);
          if (!seconds) throw new Error("voice audio is unreadable");
          const scenes = sceneWindows(script, words);
          let k = 0;
          for (const sw of scenes) for (let n = wordsOf(sw.text).length; n > 0; n--) if (words[k]) words[k++].scene = sw.scene;
          manifest = { provider: p.name, model: p.model, voice: voiceName, seconds: Number(seconds.toFixed(3)), approximate, scenes, words, script: text };
          const tmp = `${cachedJson}.tmp`;
          fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2));
          fs.renameSync(tmp, cachedJson); // the JSON last: a pair without it is never trusted
        } else if (!p.cached) {
          continue;
        }
        fs.copyFileSync(cachedWav, wav);
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
        logger.info(`Factory voice: ${manifest.provider} ${manifest.model} (${manifest.voice}), ${manifest.seconds}s${manifest.approximate ? ", estimated word timings" : ""}${p.cached ? ", cached" : ""}.`);
        return { ...manifest, file: wav, manifestFile };
      } catch (e) {
        fs.rmSync(cachedWav, { force: true });
        const r = refusalOf(e);
        if (r) refusals.set(r.scope === "provider" ? p.name : `${p.name}:${p.model}`, Date.now() + r.ms);
        logger.warn(`Factory voice: ${p.name} ${p.model} failed (${e.message})${r ? `; skipping that ${r.scope} for ${Math.round(r.ms / 3600000)} h` : ""}.`);
        if (/deadline/.test(e.message)) break;
      }
    }
    logger.warn("Factory voice: no provider produced the voice; the reel gets music only.");
    return null;
  } catch (e) {
    logger.warn(`Factory voice: skipped (${e.message}).`);
    return null;
  }
}

/**
 * Final audio: the voice on top, the music ducked under it (sidechain), stereo, mastered for
 * Instagram (about -14 LUFS integrated, true peak -1.5 dBTP). Returns ffmpeg args for the mux.
 */
function voiceMixArgs({ video, music, voice, voiceDelay = 0, out }) {
  const ms = Math.max(0, Math.round(voiceDelay * 1000));
  return [
    "-i", video, "-i", music, "-i", voice,
    "-filter_complex",
    `[2:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms},apad,asplit=2[v1][v2];[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.6[m];[m][v1]sidechaincompress=threshold=0.04:ratio=8:attack=15:release=350[md];[md][v2]amix=inputs=2:normalize=0:duration=first,loudnorm=I=-14:TP=-1.5:LRA=11[a]`,
    "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", out,
  ];
}

module.exports = {
  synthesizeVoice, voiceMixArgs, voiceAvailable, scriptOf, stripTags, wordsOf, tagsOf, untagged, wordsFromAlignment,
  estimateWords, sceneWindows, similarity, analyzeLevels, refusalOf, stabilityFor, openrouterSpeech, TAG, TAG_MODELS,
};
