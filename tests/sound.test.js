const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const music = require("../src/factory/music");
const { normalizeEvents, renderSfx, KINDS } = require("../src/factory/sfx");
const mix = require("../src/factory/mix");
const library = require("../src/factory/library");
const { heroPrompt, soundBlock } = require("../src/factory/hero");

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "sound-"));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { windowsHide: true }).status === 0;

/** A 16-bit mono WAV: a click on every beat at `bpm`, quiet until `dropAt`, loud after. */
function clickTrack(file, { bpm = 120, seconds = 40, dropAt = 20, sr = 22050 } = {}) {
  const n = seconds * sr;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  const beat = (60 / bpm) * sr;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const k = i % Math.round(beat);
    const amp = t < dropAt ? 0.08 : 0.7;
    const click = k < sr * 0.03 ? Math.sin((2 * Math.PI * 90 * k) / sr) * Math.exp(-k / (sr * 0.008)) * amp : 0;
    const bed = Math.sin(2 * Math.PI * 220 * t) * (t < dropAt ? 0.01 : 0.12);
    buf.writeInt16LE(Math.round((click + bed) * 30000), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

test("music: file names become id, mood, title and artist", () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "inspirational"));
  fs.writeFileSync(path.join(dir, "inspirational", "Summer - Antonio Vivaldi.mp3"), "x");
  fs.writeFileSync(path.join(dir, "inspirational", "notes.txt"), "x");
  const [t, ...rest] = music.scanFiles(dir);
  assert.equal(rest.length, 0, "only audio files count");
  assert.deepEqual({ id: t.id, mood: t.mood, title: t.title, artist: t.artist }, { id: "summer-antonio-vivaldi", mood: "inspirational", title: "Summer", artist: "Antonio Vivaldi" });
});

test("music: a click track's tempo, drop and window are found, and the drop lands on the climax", { skip: !hasFfmpeg }, () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "educational"));
  clickTrack(path.join(dir, "educational", "Clicks - Test.wav"));
  const file = path.join(dir, "catalog.json");
  const [t] = music.catalog({ dir, file, refresh: true });
  assert.ok(Math.abs(t.bpm - 120) < 1.5, `bpm ${t.bpm}`);
  assert.ok(t.drops.some((d) => Math.abs(d.t - 20) <= 1), `drops ${JSON.stringify(t.drops)}`);
  assert.equal(t.vocals, true, "unknown tracks are assumed to have vocals (ducked deeper)");
  const saved = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(saved.tracks[t.id] && !saved.tracks[t.id].file, "catalog saved without machine paths");

  const plan = music.planWindow(t, { seconds: 15, climaxAt: 9 });
  assert.ok(plan.dropAt !== null && Math.abs(plan.dropAt - 9) <= 1.1, `drop at ${plan.dropAt}`);
  assert.ok(plan.bars.includes(plan.dropAt), "the drop sits on a bar line");
  assert.ok(plan.start >= 0 && plan.start + 15 <= t.duration);
  assert.ok(Math.abs(plan.beats[1] - plan.beats[0] - 0.5) < 0.02, "beats every 0.5 s at 120 bpm");
  assert.equal(plan.energy.length, 15);

  // Hand edits survive re-analysis.
  saved.tracks[t.id].vocals = false;
  saved.tracks[t.id].version = 0;
  fs.writeFileSync(file, JSON.stringify(saved));
  const [again] = music.catalog({ dir, file, refresh: true });
  assert.equal(again.vocals, false);
});

test("music: the director's pick wins, otherwise mood, instrumental and freshness decide", () => {
  const base = { duration: 200, drops: [], refDb: -12, bpm: 100 };
  const tracks = [
    { ...base, id: "a-vocal-edu", mood: "educational", vocals: true },
    { ...base, id: "b-inst-edu", mood: "educational", vocals: false },
    { ...base, id: "c-inst-emo", mood: "emotional", vocals: false },
    { ...base, id: "d-short", mood: "educational", vocals: false, duration: 20 },
  ];
  const pick = (o) => music.chooseTrack({ tracks, seconds: 30, climaxAt: 18, random: () => 0, ...o })?.id;
  assert.equal(pick({ mood: "educational", narrated: true, director: "CONCEPT ...\nMUSIC: c-inst-emo\nwhy" }), "c-inst-emo");
  assert.equal(pick({ mood: "educational", narrated: true, director: "MUSIC: d-short" }), "b-inst-edu", "a pick too short for the film is ignored");
  assert.equal(pick({ mood: "educational", narrated: true }), "b-inst-edu");
  assert.equal(pick({ mood: "educational", narrated: true, recent: ["b-inst-edu"] }), "a-vocal-edu");
  assert.equal(music.directorPick("**MUSIC:** b-inst-edu", tracks).id, "b-inst-edu");
  assert.equal(music.moodFor("Anthropic launched a new model today"), "inspirational");
  assert.equal(music.moodFor("How the scheduler works, step by step"), "educational");
  assert.equal(music.moodFor("a quiet afternoon"), "storytelling");
});

test("sfx: events are cleaned, spaced and derived from cuts when the agent gave none", () => {
  const ev = normalizeEvents({ sfx: [{ t: 1, kind: "whoosh" }, { t: 1.03, kind: "impact" }, { t: 2, kind: "laser" }, { t: 99, kind: "pop" }, { t: 3, kind: "riser", weight: 7 }, { t: 3, kind: "boom" }] }, 10);
  assert.deepEqual(ev.map((e) => e.kind), ["whoosh", "riser", "boom"]);
  assert.equal(ev[1].weight, 1, "weights are clamped");
  const derived = normalizeEvents({ cuts: [0, 2.5, 5] }, 10, { dropAt: 6 });
  assert.deepEqual(derived.map((e) => e.kind), ["whoosh", "whoosh", "riser", "boom"]);
  assert.ok(KINDS.includes("shutter"));
  const file = path.join(tmp(), "sfx.wav");
  renderSfx(file, { seconds: 4, events: ev.filter((e) => e.t < 4), speech: [[0.5, 1.5]] });
  assert.equal(fs.statSync(file).size, 44 + 4 * 48000 * 4);
  assert.equal(renderSfx(path.join(tmp(), "none.wav"), { seconds: 4, events: [] }), null);
});

test("mix: speech windows merge short pauses and the duck expression follows them", () => {
  const words = [{ w: "a", start: 0.2, end: 0.5 }, { w: "b", start: 0.7, end: 1 }, { w: "c", start: 2.5, end: 3 }];
  assert.deepEqual(mix.speechWindows(words), [[0.2, 1], [2.5, 3]]);
  const expr = mix.duckExpression(mix.speechWindows(words), 0.2);
  assert.match(expr, /^1-0\.800\*max\(clip\(/);
  assert.equal(mix.duckExpression([], 0.2), "1");
  const many = Array.from({ length: 200 }, (_, i) => ({ w: "x", start: i * 1.2, end: i * 1.2 + 0.4 }));
  assert.ok(mix.speechWindows(many).length <= 40, "long scripts are merged to keep the filter fast");
});

test("captions: short chunks, the spoken word lit, safe-area style", () => {
  const words = "Wait. This model just beat every benchmark on your laptop".split(" ").map((w, i) => ({ w, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const chunks = mix.captionChunks(words);
  assert.deepEqual(chunks[0].map((w) => w.w), ["Wait."], "punctuation ends a chunk");
  assert.ok(chunks.every((c) => c.length <= 3));
  const ass = mix.captionsAss(words, { accent: "#ff3b30" });
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Style: Cap,Anton,/);
  assert.match(ass, /\\c&H00303BFF/, "accent in ASS BGR order");
  assert.equal((ass.match(/^Dialogue:/gm) || []).length, words.length, "one event per spoken word");
  assert.equal(mix.accentFrom(["#111111", "#22d3ee"]), "#22d3ee");
  assert.equal(mix.accentFrom(["#000000"]), "#FFD60A");
  assert.ok(fs.existsSync(path.join(mix.FONTS, "Anton-Regular.ttf")), "the caption font ships with the repo");
});

test("mix: a full reel comes out at 1080x1920, the film's length, mastered near -14 LUFS", { skip: !hasFfmpeg, timeout: 180000 }, () => {
  const dir = tmp();
  const film = path.join(dir, "film.mp4");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=540x960:r=30:d=8", "-pix_fmt", "yuv420p", film]);
  const voice = path.join(dir, "voice.wav");
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=5", "-ar", "48000", voice]);
  const track = path.join(dir, "track.wav");
  clickTrack(track, { seconds: 30, dropAt: 2 });
  const words = [{ w: "hello", start: 0.5, end: 1.2 }, { w: "world", start: 1.4, end: 2.2 }];
  const sfx = renderSfx(path.join(dir, "sfx.wav"), { seconds: 8, events: normalizeEvents({ cuts: [2, 4] }, 8) }).file;
  const out = path.join(dir, "reel.mp4");
  const r = mix.mixReel({ film, out, seconds: 8, music: { file: track, start: 3, refDb: -8, vocals: false }, sfx, voice: { file: voice, words }, captions: true, workDir: dir });
  assert.equal(r.captions, true);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height,channels,sample_rate:format=duration", "-of", "json", out], { encoding: "utf8" });
  const info = JSON.parse(probe.stdout);
  const v = info.streams.find((s) => s.width);
  const a = info.streams.find((s) => s.channels);
  assert.deepEqual([v.width, v.height, a.channels, a.sample_rate], [1080, 1920, 2, "48000"]);
  assert.ok(Math.abs(Number(info.format.duration) - 8) < 0.15, `duration ${info.format.duration}`);
  const lufs = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", out, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr.match(/I:\s+(-?[\d.]+) LUFS\s*\n\s*Threshold/);
  assert.ok(lufs && Math.abs(Number(lufs[1]) + 14) <= 2, `integrated loudness ${lufs && lufs[1]}`);
  assert.ok(!fs.existsSync(path.join(dir, "reel.video.mp4")), "the intermediate is removed");
});

test("visual library: entries, licences and the agent's block", () => {
  const all = library.visuals();
  assert.ok(all.length >= 10);
  for (const v of all) {
    assert.ok(v.title && v.kind && v.use && v.license, `${v.slug} has title, kind, use and licence`);
    if (v.kind !== "technique") assert.match(v.file_url, /^https:\/\/assets\.mixkit\.co\//, `${v.slug} comes from an allowed host`);
  }
  assert.ok(all.some((v) => v.slug === "technique-shatter"));
  const block = library.visualsBlock((s) => `visuals/${s}.mp4`);
  assert.match(block, /VISUAL LIBRARY/);
  assert.match(block, /\[technique\] SHATTER/);
});

test("hero brief: music section, sound design and captions contract", () => {
  const sb = { id: "x", format: "reel", bpm: 120, author: "A", handle: "@a", scenes: [{ type: "hook", beats: 8, text: "Hook line" }], slides: [] };
  const track = { title: "T", artist: "Ar", mood: "educational", vocals: false };
  const plan = { start: 10, seconds: 20, bpm: 101, beats: [0, 0.6], bars: [0, 2.4], dropAt: 12, energy: "1234" };
  const prompt = heroPrompt({ storyboard: sb, article: { title: "t", text: "x", links: [] }, references: [], engine: "remotion", skills: [], avoid: "-", voice: { seconds: 10, words: [], scenes: [] }, music: { track, plan } });
  assert.match(prompt, /MUSIC \(chosen for this piece/);
  assert.match(prompt, /drops at 12\.00 s/);
  assert.match(prompt, /SOUND DESIGN/);
  assert.match(prompt, /"captions": true\|false/);
  assert.match(prompt, /VISUAL LIBRARY/);
  assert.doesNotMatch(soundBlock(null), /CAPTIONS/, "no captions contract without a voice");
});
