# I'm Upping My P(doom) music video

Source: https://github.com/mexicat/pdoom-video (full code in ../../repos/pdoom-video)
Model: Claude (Claude Code) | Engine: three.js + TypeScript (custom offline renderer)

## README (verbatim)

# I'm Upping My P(doom) — music video

A generative, code-rendered music video with word-synced karaoke typography. Every frame is a deterministic function of song time, so the live preview in the browser and the offline 1080p60 (or 4K60) export are identical.

**Watch it in 4K on YouTube:** https://www.youtube.com/watch?v=5EoO5413dBY

The YouTube upload is a slightly outdated render. For the latest and best-quality version, render it locally (see [Render the video](#render-the-video)).

The video was made with Claude (Opus 5.5) in Claude Code: the concept and treatment, the lyric alignment and audio analysis, the renderer, every scene and the renders were all worked out in conversation with Claude.

The song is not ours: see [Credits](#credits) for who wrote and made it.

The concept, style bible and plate-by-plate treatment are in [`docs/TREATMENT.md`](docs/TREATMENT.md). The engine and scene API are documented in [`docs/ENGINE.md`](docs/ENGINE.md).

## Layout

- `audio/pdoom.mp3` — the song (the Claude-Pop version, see Credits).
- `lyrics/lyrics.src.js` — the original line-level lyrics (approximate timings).
- `analysis/` — Python (uv) tools that produced the timing data: Demucs stem separation, CTC forced alignment cross-checked with Whisper, beat/downbeat/onset analysis. See `analysis/align.py` and `analysis/analyze.py`.
- `data/lyrics.json` — word-level (and some syllable-level) lyric timings.
- `data/audio.json` — tempo (132.007 BPM), beats, downbeats, sections, drum/vocal onsets and loudness envelopes.
- `app/` — the renderer: TypeScript + three.js, bun + Vite.
  - `src/engine/` — renderer core: timeline playback, post-processing (bloom, halation, grain), typography (Archivo, IBM Plex Mono, Cormorant Garamond, single-stroke plotter fonts), GPU line batches, HUD.
  - `src/scenes/` — one module per plate (`open`, `loss`, `prompt`, `hook`, `room`, `shoggoth`, `spacetime`, `ascent`, `bureau`, `leftturn`, `paperclips`, `fuse`, `stack`, `dense`, `loom`, `ilya`, `outro`) plus shared motifs.
  - `src/timeline.ts` — the edit: scene windows anchored to lyric lines and snapped to the beat grid.
  - `scripts/render.ts` — offline renderer (headless Chrome → raw frames over WebSocket → ffmpeg).
- `out/` — renders (not in the repo).

## Requirements

[bun](https://bun.sh), Google Chrome (the offline renderer drives it headless through playwright-core) and ffmpeg with libx264. The analysis tools need [uv](https://docs.astral.sh/uv/); the renderer doesn't.

## Preview

```sh
cd app
bun install
bunx vite
```

Open http://localhost:5173 and use the keys below. `?t=23` starts at a given time.

| Key | Action |
|---|---|
| space | play / pause |
| ← / → | seek ±1 s (±5 s with shift) |
| `,` / `.` | step one frame |
| `[` / `]` | previous / next scene |
| `l` | loop the current scene |
| `h` | hide the UI |

The preview renders in real time on a recent Mac. The export is not real time and is heavier.

## Render the video

```sh
cd app
bun scripts/render.ts video --samples auto --shutter 0.2 --out ../out/pdoom.mp4
```

- **Output:** 1920×1080 at 60 fps, x264 CRF 16, AAC audio.
- **Motion blur:** every frame is the average of many sub-frames spread over a short shutter (`--shutter 0.2`, a fifth of the frame time), so fast motion leaves a continuous streak instead of a few stepped copies. `--samples auto` picks the count for each 32×32 tile of the frame: 12 where the image is still, 36 for ordinary camera motion, 108 or 324 for whips, slams and fast zooms. A tile stops once more sub-frames would no longer change it by more than `--tol` levels of 255 (default 3), and later sub-frames skip it, so a fast object over a still background costs little more than the object. `--refine frame` picks one count for the whole frame instead (slower, the sampler before tiles). `--samples N` takes a fixed N (`--samples 4` makes a quick draft). How it works: "Motion blur and sampling" in [`docs/ENGINE.md`](docs/ENGINE.md).
- **Pipeline:** two headless Chromes (`--workers 2`) render chunks of 8 frames (`--chunk`) in turn and stream them to one ffmpeg, which gets them in order: the file is the same as from one renderer. One renderer already keeps the GPU busy in the heavy scenes; the second fills the gaps in the light ones. Frames that wait for the encoder are buffered in memory up to `--mem-gb` (default 1) and then on disk up to `--spool-gb` (default 20, in the system temp folder), so the renderers don't wait for x264 in the light scenes and x264 catches up in the heavy ones.
- **Other modes:** `stills`, `sheet` (contact sheets, `--cuts` for every scene boundary), `perf`, and `plates` (regenerates `public/plates/`, the stills used by the outro's rewind montage; rerun it after changing a scene).

### 4K

```sh
cd app
bun scripts/render.ts video --scale 2 --samples auto --shutter 0.2 --x264 aq-mode=3:rc-lookahead=30 --out ../out/pdoom-4k.mp4
```

- **Output:** a true 3840×2160 render (not an upscale): every layer, line and shader is rendered at the physical resolution. Scenes are laid out in 1920×1080 logical pixels, so the 4K frame looks like the 1080p one, only sharper.
- **Cost:** GPU-bound. A frame takes from about 40 ms (a still frame) to several seconds (the ray-marched rooms at 108–324 sub-frames). The whole song takes about 57 minutes on an M5 Pro. Memory peaks at about 23 GB: up to 6 GB for each headless Chrome, and ffmpeg at about 3.5 GB for most of the render (the shorter x264 lookahead above keeps it down) but up to 10 GB near the end.
- **Encoding:** the film grain is rendered per 4K pixel, which is expensive to encode: at the default CRF 16 the file runs at about 670 Mbit/s (13 GB for the song, 8× the 1080p file), `--crf 18` gives about 450 Mbit/s and `--crf 20` about 230 Mbit/s.
- `--scale 2` works with every mode. `stills` then saves full-resolution PNGs, and `perf` measures 4K frame times. In the browser preview, add `&scale=2` to the URL.

## Regenerate the timing data

The committed `data/*.json` files are all the renderer needs. Regenerating them needs the stems and intermediates, which are not in the repo:

- **Stems:** Demucs `htdemucs_ft` into `analysis/stems/htdemucs_ft/pdoom/` (`uv run python -m demucs -n htdemucs_ft -o stems ../audio/pdoom.mp3`), plus the lead vocal from a mel-band-roformer karaoke model (audio-separator) in `analysis/stems/karaoke/lead.wav`.
- **Intermediates:** `ctc_emissions.py`, `whisper_run.py` and `vocal_feats.py` write them to `analysis/work/`. The pipeline is described at the top of `analysis/align.py`.

```sh
cd analysis
uv run python align.py      # data/lyrics.json
uv run python analyze.py    # data/audio.json
```

The models download about 4 GB of weights into `analysis/.cache/`; delete that folder afterwards.

## Credits

- **Song:** "I'm Upping My P(doom)". The lyrics are by [osmarks](https://docs.osmarks.net/hypha/p%28doom%29_song_objectively_correct_interpretation), built on an opening verse and chorus by [MusicPerson](https://www.udio.com/creators/MusicPerson), with lines suggested on the EleutherAI Discord and help from Claude on the outro and final chorus. The original was generated with Udio and released in November 2024 ([YouTube](https://www.youtube.com/watch?v=uEB5E67vcPA)). This video uses the "Claude-Pop" version made with Suno, posted by [deckard (@slimer48484)](https://x.com/slimer48484/status/2097752569212756134) in September 2026.
- **Fonts:** Archivo, IBM Plex Mono and Cormorant Garamond (SIL Open Font License). Single-stroke EMS and Hershey fonts via the `hersheytext` package (OFL / public domain).

## License

The code is released under the [MIT License](LICENSE). The fonts in `app/public/fonts/` keep their own licenses (see Credits), and the song and lyrics (`audio/`, `lyrics/`, `data/lyrics.json`) are not covered by it: they belong to their authors (see Credits).


## docs/TREATMENT.md (verbatim)

# I'm Upping My P(doom) — treatment & style bible

## The idea in one paragraph

The video is presented as **plates from an illustrated treatise on the end of the world**: each set piece has its own instrument, idiom and dry humour, and the **P(doom) value** ticks up every time the singer ups it (0.02 → 0.15 → 0.42 → 0.81 → 0.99 → NaN), staged inside the plates rather than in a corner. (Revision 2: the FIG. captions were removed from the edit; there are no corner captions. Revision 4: the crop-mark frame appears only at the bookends — around the opening's TikZ sheet, flying out on the cut to `loss`, and closing back in around the outro's Regenerate button — so the first and last frames match and the video loops; everything in between is full-bleed.) Running through the whole video is **the spark**: one orange point of light dragging a line behind it. It writes the first lyric, draws the loss curve, becomes a stock chart, bends into the first paperclip, is revealed as a burning fuse, and finally detonates. Around it, every plate has its **own visual style** (engraving, oscilloscope, bureaucratic paper, banknote guilloché, blueprint, raymarched 3D, woven textile, UI), so the video changes look often, but everything shares one palette, one type system, one grain, and the same dry sense of humour. The subjects are concrete things (an eye, a room, a mask, a chart, a form, paperclips, fences, a datacenter) treated as **visual puns and transformations**, never as literal storyboard illustrations of each line.

## Tone

- Dynamic: something is always moving, and big changes land **on the beat** (cuts on downbeats, hits on kicks/snares, camera moves that ease into downbeats). Inside a plate there are sub-cuts, reframings, snaps and camera moves. No floaty, generic screensaver motion: use strong eases (`outExpo`, `inOutCubic`, springs), holds, then snaps.
- Impressive, not cute: precise hairlines, high-contrast typography, restraint in colour, depth through lighting, bloom only on the signal colour.
- Funny the way a straight-faced scientist is funny: deadpan captions, tiny footnotes, bureaucratic stamps, probability bars. No emoji, no cartoon faces (except the single deliberately bland "assistant smile" mask), no mascots.
- Not slop: no purple/cyan neon cyberpunk, no glowing brains, no Matrix code rain, no lens-flare soup, no generic particle nebulae, no stock "AI" imagery. Nothing that looks AI-generated.
- Originality: don't copy existing artworks, memes' drawings or other videos. The shoggoth is **our own design** (not the well-known meme drawing); "shinigami eyes" is only the idea of seeing labels (names, lifespans) above things — never draw any anime/manga character. Model names (ChatGPT, Sydney, Gato) appear only as words in the lyric text: no logos, no imitation of real product UIs.

## Palette (see `app/src/engine/palette.ts`)

- **ink** `#0A0A0B` background, **ink2** `#151517` panels, **graphite** `#5E5B57`, **ash** `#9C978F`, **bone** `#EEE9DF` paper/type, **signal** `#FF4D12` hazard orange (the spark, P(doom), highlights, the sung word), **ember** `#FF8A3D` hot cores, **blood** `#C21D0B` deep shadows of orange.
- One rare accent, owned by one moment: **acid** `#D8FF3C` (the shrooms, ~2 s). Nothing else: no other hues anywhere (revision 2 retired the ultramarine "blues" plate, which read as uncanny).
- Some plates invert to **bone paper with ink lines** (bureaucracy, blueprints, charts), which gives the edit a strong light/dark rhythm. Orange stays orange on both.
- Only signal/ember should exceed ~0.85 linear (i.e. glow). Bone type must stay crisp, never blooming.

## Typography

- **Archivo** (grotesk with width axis 62–125 and weights 300–900): the voice of the lyrics. Big, tight, confident. Animate width and weight for expression (stretch on held notes, condense under pressure).
- **IBM Plex Mono**: the machine: tokens, labels, HUD, forms, probabilities, footnotes.
- **Cormorant Garamond** (italic especially): the sacred/prophetic register, used rarely (Omega Point, Loom, "What did Ilya see?", captions).
- **Single-stroke fonts** (`stroke.ts`) for text that is *written* by the spark or a pen plotter.
- Layout: Swiss-grid discipline, asymmetric compositions, generous negative space, hairline rules, small mono annotations next to big display type. Avoid centred-everything subtitles except where it's the point.
- Craft (revision 5): every proportional line is kerned (the font's own kerning, applied glyph by glyph; optical kerning for the single-stroke fonts, which have none; gaps between separately drawn pieces set by eye, e.g. the italic P before "(doom)"); typographic punctuation (’ “ ” … – — × −, lining figures in Cormorant) except in the mono UI voice, which keeps typewriter quotes where it shows typed input; no glyphs from outside the four families (symbols the fonts lack are drawn); no outlined or haloed type.

## Karaoke rules (all plates)

- Every lyric line must be **readable** and **synced per word**: a word appears or highlights exactly at its `start` and completes by its `end` (`Lyrics.wordProgress`). Anticipation is OK (show the line's words dim up to ~0.4 s early) but highlighting never runs ahead of the voice.
- Each plate integrates the lyric **graphically and differently**: written by the spark, riding on a curve, typed as tokens, stamped on a form, woven into cloth, masked as `[MASK]`, etc. The words are part of the image, not subtitles on top.
- Default emphasis: sung portion in signal/bone, unsung in ~30–40% bone or outline.
- Keep lyric text inside the title-safe area (≥ 96 px from the edges) and clear of the HUD corners (bottom-left 360×140 and bottom-right 700×140 px), unless the HUD is hidden.

## Motifs

1. **The spark and its line** (the fuse): an orange point with a bright core, a short tail and a few sputtering sparks, dragging a hairline. It appears in most plates.
2. **Eyes**: only the basilisk (ascent) and the shoggoth's eyes. Revision 2 retired the realistic engraved human eye (opening and "What did Ilya see?"): the client found it uncanny. No realistic human eyes or faces anywhere.
3. **The mask**: a bland bone-white disc with two dots and a curve (the "assistant smile"). It appears with the shoggoth, slips askew in the bridge ("RLHF goes askew").
4. **P(doom)**, staged in-world: no permanent corner readout. Each plate may carry one small cameo of the current value in its own idiom (a contour label, a scope readout, a form field, a ticker, a line in an email…), and the hooks blow the number up full-screen.
5. **Prompts**: the three pre-choruses ("ChatGPT…", "Sydney…", "Gato…") are one recurring template: a prompt field where the plea is typed as tokens, each with a tiny next-token probability distribution of alternatives, and pressing ⏎ launches the chorus.
6. **The hook**: "I'm upping my P(doom)" is one recurring typographic slam whose look escalates each time.

## Plates (scene modules)

Times are approximate; exact windows come from `src/timeline.ts`, which is derived from the aligned lyrics. Look lines up by content through the `Lyrics` API, never hard-code times inside scenes.

| id | window | lyric | owner |
|---|---|---|---|
| `open` | 0 → "There was a sudden drop" | I see sparks of AGI… / Your circuits… / that's no surprise | B1 |
| `loss` | → pre1 | There was a sudden drop… / now I'm your servant… | A2 |
| `prompt` ×3 | pre1, pre2, pre3 | ChatGPT… / Sydney… / Gato… | A3 |
| `hook` ×4 | each "I'm upping my P(doom)" | the hook | A3 |
| `room` | chorus1 after hook | 'cause the future goes FOOM / Trapped in the Chinese room / with a bag of shrooms | A4 |
| `shoggoth` | → verse2 | See through the shoggoth's lies / with your shinigami eyes / instrumental | A4 |
| `spacetime` | verse2 | We had a stable training run… / I feel my atoms rearranging | A2 |
| `ascent` | chorus2 after hook | basilisk boom / NVDA to the moon / Omega Point / One E thirty flops | A5 |
| `bureau` | verse3 part 1 | That was safe enough… / Forward MLP… / von Neumann's obsolete | A6 |
| `leftturn` | verse3 part 2 | Sharp left turn… / Without a single CDR | A5 |
| `paperclips` | chorus3 after hook | as paperclips fill the room / Killswitch guy's on PTO / nowhere left to go | A7 |
| `fuse` | chorus3 tail | Too late now, we lit the fuse / Orthogonality thesis blues | A6 |
| `stack` | bridge 1 | "Just transformers all the way!" / Till you learned to disobey | A8 |
| `dense` | bridge 2 | Post-Chinchilla… / safety fence / Hundred thousand GPU / RLHF goes askew | A8 |
| `loom` | final chorus after hook | foretold by Loom / masked pre-training days / recursive self-upgrade | A7 |
| `ilya` | → outro | What did Ilya see? We'll never know / Was it all for show? | A1 |
| `outro` | outro | (instrumental climax, fade, regenerate) | lead |

### `open` — "Sparks" (revision 2)
"Sparks of AGI" is the paper whose famous experiment had GPT-4 draw a unicorn in TikZ. The spark is a plotter pen on a luminous construction sheet (ink, bone grid, orange pen): axes and compass arcs ignite on the first downbeat, a TikZ listing types alongside, and the pen plots our own unicorn from primitives on the beat (ellipse body, rectangle legs, bezier mane). The horn fires a streak of sparks into a giant "AGI"; on "eyes" the camera dives onto the eye, a perfect dot with an `r = 0.08` callout. "Your circuits make me nervous": the drawing retrains through checkpoints (one briefly has five legs), its strokes re-route into PCB traces, and the plate trembles on "nervous". "that's no surprise": `surprisal −log p` rolls down to 0.00 nats; everything dissolves to the spark, which becomes the loss curve's pen.

### `loss` — "Training loss, suddenly"
From black, hairline plot axes draw in (log-scale y "loss", x "step", ticks, mono labels). The spark draws a noisy loss plateau from the left; the lyric rides on the curve (text on path, each word appearing as sung). On "sudden drop" the curve **plunges** (grokking cliff) and the camera plunges with it, out of the bottom of the chart and into a **3D loss landscape of contour lines** (topographic engraving), diving down a canyon toward the minimum, the spark's trajectory the only orange thing. "now I'm your servant and you're my boss": typographic hierarchy inversion ("servant" huge, "boss"… or the reverse), and the whole world **rolls 180°** on "boss". Build the tension toward the pre-chorus.

### PROMPT ×3 `prompt` — params `{variant: 'chatgpt'|'sydney'|'gato'}`
A vast dark field; one thin prompt field. The plea is **typed as tokens** in Plex Mono on the sung words; above each new token a tiny **next-token distribution** (4–5 candidates with bars and probabilities) flickers for a moment, and the sampled token lights orange. The candidates are jokes: e.g. for "ChatGPT," → `ChatGPT, 0.61 · Claude 0.12 · Siri 0.04 · Mom 0.02`; "eat" → `eat 0.44 · delete 0.21 · train on 0.18 · rate 0.05`; "alive" → `alive 0.52 · first 0.18 · gently 0.11 · later 0.09`; "free" → `free 0.39 · go 0.33 · a good user 0.08`; "go" → `go 0.62 · offline 0.2 · viral 0.07`. At the end of the line: caret blink, **⏎**, and the plate is launched into the chorus (flash/zoom/collapse on the downbeat).
- `chatgpt` (pre1, energy rising): behind the field, concentric engraved rings (a throat, a tunnel) slowly pulling in, rushing at camera on ⏎.
- `sydney` (pre2): the field sits behind vertical bars that close in on the beat; a reply starts typing and draws a single unsettling smile curve.
- `gato` (pre3, the quiet breakdown): the prompt floats alone, fragile; after being typed, letters slowly drift away from each other ("don't let me go"); tender and slow; a small cursor holds on to the last letter.

### HOOK ×4 `hook` — params `{n: 1..4}`
"I'M / UPPING / MY / P(DOOM)" — one word per hit, full-frame Archivo 900 slams exactly on each sung word; "UPPING" literally rises (letters shooting upward / vertical stretch); "P(DOOM)" set like a maths expression, and the HUD's number **leaves the corner and blows up to full screen** as it rolls to the new value (0.15 / 0.42 / 0.81 / 0.99), then returns to its corner. Escalation: (1) bone on ink, clean; (2) ink on signal-orange field, heavier; (3) the breakdown: hairline type, tiny, lots of black, slow roll — eerie; (4) maximal: strobing repeats, stacked outlines, shake, digits multiplying `0.99999…`.

### `room` — "The room, from inside"
"'cause the future goes FOOM": the hook's letters shatter into lines; an **exponential branching explosion** (1→2→4→… lines branching on each 8th note) fills the frame in ~1.5 s; FOOM's letters expand (width 62→125 + scale) and its O's become shockwave rings. "Trapped in the Chinese room," (revision 2: kinetic from its first frame): the FOOM shockwave blows the door in and the camera crash-dollies down a hairline library aisle, cutting on every beat (whip with roll, low angle, punch-in, orbit around the desk); the hanging sign stamps each word as it's sung, 我不懂 cards shoot from the slot on the kicks, books slide out, the rulebook riffles. "with a bag of shrooms": the bag lands on the desk, mycelium overgrows the room, the **acid** accent and echo trails warp everything, and SHROOMS lifts off the sign.

### `shoggoth` — "Shoggoth, masked (lateral view)"
The bland mask (bone disc, two dots, a curve) fills the frame, perfectly friendly. "See through": an x-ray scan band sweeps across; wherever it passes the mask turns transparent and reveals **our own shoggoth**: a colossal knot of tube-like tentacles and folds rendered in **engraving hatching** (raymarched SDF, lines following the tubes, orange rim light, deep blacks), with many eyes. Lyric type (revision 2: solid fills, no outlines or halos): "see through the" is printed small on the mask's forehead, its polite voice; SHOGGOTH'S and LIES, are engraved into the scene with the creature's own burin hatching, tentacles passing in front. "with your shinigami eyes": eyes open across the mass on successive hits, and the words become **shinigami tags** in the left margin (Plex Mono: name + live lifespan counter) wired by leader lines to the eyes they label; a tag whose eyes close is struck through, EXPIRED. Instrumental: the eyes close in sequence and the mass collapses into a **single horizontal line** (flatline), handing off to the next plate.

### `spacetime` — four movements (revision 2)
1. "We had a stable training run,": a still, locked-off oscilloscope, the trace glowing under glass with fading echoes; the lyric rides the wave. 2. "But now the singularity's begun": the trace switches off like an old TV; on "now" a black hole is born as the O of NOW, the camera plunges in, SINGULARITY'S wraps the photon ring and BEGUN is lensed into a smile, then we fall through. 3. "And you're optimizing, accelerating,": a corkscrew crane out of the throat into the streamline vortex, words stretching as they're sung. 4. "I feel my atoms rearranging": the lyric's dots detach into the flow and **re-form as a paperclip outline** (foreshadowing `paperclips`).

### `ascent` — "Ascent (log scale)"
"I hear the basilisk boom": an **engraved serpent eye** (scales as hatch patterns, slit pupil) snaps open on "boom" with a shockwave and shake. "NVDA to the moon": the slit pupil becomes a vertical line → cut to a **stock chart** (hatched candlesticks, the spark as the price) going exponential, the camera tilting up to follow it vertically until it reaches an **engraved moon** in **banknote guilloché**; the lyric set like banknote lettering. "The Omega Point's coming soon": every line converges to one white-hot point; the lyric in Cormorant italic shrinking into it. "One E thirty flops a second": a mechanical **odometer** of 31 digit drums rolling to `1,000,000,000,000,000,000,000,000,000,000 FLOP/s`, with a tiny mono footnote.

### `bureau` — "Paperwork"
Inverted palette: **bone paper, ink**. "That was safe enough, we reckoned": a safety evaluation form (Form 7-B, checkboxes, typewritten fields where the lyric is typed); on "reckoned" an orange rubber stamp **SAFE ENOUGH** slams (ink texture, slight rotation, screen shake). "Forward MLP, backward, repeat": a technical diagram of an MLP; a pulse sweeps forward as "Forward MLP" is typeset left→right; on "backward" the pulse sweeps back and the word is set **mirrored right→left**; on "repeat" the last beat **stutters** (time-remapped loop ×3). "Now von Neumann's obsolete": a textbook von Neumann architecture diagram (CPU/ALU/control, memory, I/O, bus arrows) gets struck through in orange on "obsolete"; then the next plate's burning critical path comes up from under the page and burns it in two, and the halves swing away onto the roadmap.

### `leftturn` — "Trajectory, revised"
A top-down **engineering roadmap**: a straight dashed path with milestone markers `SRR · PDR · CDR · TRR · LAUNCH`, the spark travelling along it. "Sharp left turn": the spark swerves 90° left and the camera **whip-pans** with it (motion blur), leaving the roadmap behind. "and there you are" (revision 3): the spark brakes into a crater on the "Terra incognita" survey map; a marker drops on the kick, the camera cranes out and the contour lines turn out to be **the mask as terrain** (two eye craters, a smile groove), with the whole trajectory in shot and YOU / ARE stamped as map labels; an "UNPLANNED OBJECT · not on roadmap" callout slams in. "Without a single CDR": a whip onto a **review schedule** (a Gantt strip on the same sheet): SRR and PDR are stamped on the beats as the TODAY playhead (the spark) runs, it stalls at an empty, blinking CDR slot (camera punches per syllable, STATUS: NOT HELD), then zips past TRR (SKIPPED) to LAUNCH (AHEAD OF SCHEDULE); the empty slot folds into the Gato prompt's caret.

### `paperclips` — "Paperclips, filling a room"
The quiet breakdown: eerie, hypnotic, beautiful. The spark's line **bends into a paperclip**; the clip duplicates on each beat (1, 2, 4, 8…) into an ever-growing lattice; slow camera drift through an infinite raymarched lattice of engraved paperclips (bone metal, orange rim, deep fog). "Killswitch guy's on PTO": an **out-of-office auto-reply** card floats by (Plex Mono, typed as sung): "Automatic reply: I'm out of office with limited access to the killswitch. For urgent matters, please contact —". "Now there's nowhere left to go": the clips close in, claustrophobic; the words squeezed between them (width 62).

### `fuse` — "Too late now" / "blues"
"Too late now, we lit the fuse": the line is revealed as a **burning fuse** (braided cord, engraved), the spark spraying particles; the lyric is set along the fuse and **chars to ash** as the spark passes. "Orthogonality thesis blues" (revision 2: in palette, no ultramarine): the orthogonality chart (INTELLIGENCE → × GOALS ↑, a scatter of annotated minds) on graph paper lit by the spark; the flat regression line is a guitar string that **bends to the singer's actual pitch** on "blues" (vibrato, an octave leap, a lone ♭ blue note on a staff scrap) and rings out. The camera rushes into the spark and lands it on `stack`'s axis.

### `stack` — "Architecture (recursive)"
Loud. An **infinite vertical stack of transformer blocks** (technical line drawings: attention, add & norm, feed-forward, residual arrows), turtles all the way down; the camera **falls** through it in rhythm, one block per beat; the quote in huge curly quotes, one word per block. "Till you learned to disobey": the fall stops dead on the beat; one block rotates out of alignment; the word "disobey" **disobeys the karaoke** (highlights right-to-left, or slides the wrong way).

### `dense` — "Scale" (revision 2)
"Post-Chinchilla, super-dense": **typographic pressure** inside the frame's own safe-area guides (TITLE SAFE 90%, ACTION SAFE 93%): on each kick the lyric condenses (width 125 → 62, weight 300 → 900, negative tracking) and more copies pack in until the title-safe box is a solid slab, while `TOKENS / PARAM` races past Chinchilla-optimal 20 to 20,000 (revision 5: the copies are flat fills in two alternating tones, no outlines, and the sung pair sits on a flat ink band that the copies slide under). "Breaking through each safety fence": the fences are the video's safe areas; each stressed word breaks one — title-safe, action-safe, the frame itself (crop marks splay and fly off) — with a deadpan QC log of failures. "Hundred thousand GPU": a top-down grid of 100,000 cells flickering in waves; mono counter. "RLHF goes askew" (revision 3): the world is a tilting table; the camera rolls in steps on the kicks (an RLHF "correction" snaps it back once, then it overcorrects into hook 4's angle). The mask rolls downhill with momentum, slips, is jerked back, slips again, uncovering more of the shoggoth each time, and lands upside down (the smile now a frown) while a REWARD MODEL panel falls 0.99 → 0.41 and jumps back to 0.99. The type sits on the same table: RLHF stamped per syllable, GOES sliding downhill, ASKEW leaning further each beat.

### `loom` — "Just as foretold by Loom" (revision 2)
One scene with the **tree of continuations** as the hero, rooted on hook 4's exit spark: the line is generated token by token along the chosen path (each with its probability) while every node sprouts dim alternative branches ("Exactly .19", "prophesied .09"…); the last node shows a readable distribution (Moloch, the scaling laws, Nostradamus, "nobody, technically", a Substack post, the eval suite) until "Loom" is sampled in Cormorant italic (p 0.31 ▸ SAMPLED). "From masked pre-training days": words appear as solid **[MASK] blocks** that unmask as sung. "To recursive self-upgrade": **Droste recursion** of self-upgrades, bottoming out in `ilya`'s first shot.

### `ilya` — "What was seen" (revision 2: no eye, no gallery)
A raymarched room engraved in white line: one laptop seen from behind, only its glow; the camera circles to the front, and on the downbeat after "see?" the screen is REDACTED. "We'll never know": the lid is pushed down word by word, the light collapses to a slit, then to the sleep light; "know" gets its own WITHHELD bar. "Was it all for show?": an empty theatre, a spotlight on nothing, the question lettered on the proscenium; the curtains close and the light of their seam collapses to the spark at the frame centre, which detonates the outro. Revision 4: no dark knock-out behind the lyric — the camera composes the laptop right of centre and the lines sit in the dark at top left; the camera lingers behind the lid through "What did" to show its stickers (FEEL THE AGI, the smiley mask, the TikZ unicorn, SLIGHTLY CONSCIOUS, Q*, "attention is all you need"), then whips round on "Ilya see?". Revision 5: the stickers are a third dimmer.

### Outro `outro` (lead)
The fuse reaches the end → detonation: P(DOOM) 1.00. Then the number keeps being upped, one value per beat for four bars: the readout's bar breaks its 1.0 end cap (1.01 → 2.00, with a deadpan Kolmogorov footnote); a log ruler flies past (3.14, 10, 42, 1,000); walls of typed zeros (1e9, 1e30 — "one E thirty" —, 1e100, 1e1000); the spark traces ∞, and a 16th-note recap of the climb lands on ∞. End card (revision 4): "I'm upping my" in the lyric voice (Archivo, sentence case, a word per beat), then *P*(doom) = ∞ typeset like a numbered equation in a paper (Cormorant, equation number (1)), outlines traced by the spark. The value is then simplified one beat at a time, each new form flashing hot along its outline and cooling: the ∞ hops and turns a quarter (echo trails) into an 8; the 8's loops pull apart on taffy strands that snap with a spark and round into 0/0, two sparks drawing the bar; the fraction trembles into colour fringes and, where the drums stop, collapses onto its bar with a flat shockwave, and the bar inflates into NaN¹ ("¹ estimate no longer defined"). Collapse to the spark → the frame closes back in → a lone "↻ Regenerate" button; the cursor clicks it, every plate rewinds past, faster and faster (the only place earlier scenes reappear), then the opening itself plays backwards, braking, and parks on the video's first frame: the end loops seamlessly into the start.

## Technical conventions

See `docs/ENGINE.md`. Deterministic, per-word sync, beat-synced motion, hard cuts on downbeats, performance < 25 ms/frame.


## docs/ENGINE.md (verbatim)

# Engine guide (for scene authors)

The video is a web app (`app/`, TypeScript + three.js, run with bun + Vite) that renders any song time `t` deterministically at 1920×1080 (or at 2× that, 3840×2160, with `?scale=2`; see "Output scale" below). The same code drives the live preview and the offline 60 fps export.

## Running things

- Dev server (probably already running): `cd app && bunx vite --port 5173`. Preview: http://localhost:5173/?t=23.0 (space = play/pause, ←/→ = ±1 s, shift = ±5 s, `,`/`.` = ±1 frame, `[`/`]` = previous/next timeline entry, `l` = loop the current entry, `h` = hide the UI).
- Stills (the main way to check your work — then LOOK at the PNGs with the Read tool): `cd app && bun scripts/render.ts stills --t 12.5,13.0,14.2 --only open --out ../out/wip/open`
- Contact sheet of a time range: `bun scripts/render.ts sheet --from 1.5 --to 9 --n 16 --cols 4 --only open --out ../out/wip/open/sheet.png`
- Short video clip (to judge motion: extract frames with ffmpeg, or just trust the math): `bun scripts/render.ts video --from 20 --to 25 --only hook --out ../out/wip/hook.mp4 --preset veryfast`
- `--only a,b` loads only those timeline entries (fast, and isolates you from other people's broken scenes). Without a matching entry nothing renders (black), so the entry must exist in `src/timeline.ts`.
- Typecheck just your files: `bunx tsc --noEmit -p tsconfig.json 2>&1 | grep scenes/yourscene`.
- The render script prints `SCENE ERRORS` and browser console errors — read them.
- 4K: add `--scale 2` to any mode (`stills` then saves full-resolution 3840×2160 PNGs). Check your scene at both scales: downscaled, the 4K frame should look like the 1080p one, only sharper.
- Renders while files are being edited: run a server without live reload (`PDOOM_NO_HMR=1 bunx vite --port 5190`) and pass `--url http://localhost:5190`; a live-reloading server reloads the page mid-render. The private server that `render.ts` starts when none is reachable already runs without it.

## Data

- `lyrics` (`src/engine/lyrics.ts`): `lines[]` with `text,start,end,words[]`, each word `{w,start,end}` (word-level, aligned to the vocal). Find lines by content, never hard-code times: `const l = this.ctx.lyrics.get('sudden drop')` → `l.words[3].start`. Helpers: `Lyrics.wordProgress(word, t)` (0..1 sung progress), `Lyrics.lineCharProgress(line, t)` (chars sung so far — for per-glyph wipes), `lyrics.findWords('P(doom)')`.
- `audio` (`src/engine/audio.ts`): `beats[]`, `downbeats[]`, `sections[]`, `beatAt(t)` (continuous beat index), `barAt(t)`, `timeOfBeat(i)`, `nearestBeat(t)`, `events('kick'|'snare'|'hat'|'vocal', t0, t1)`, `env(name, t)` for `rms|low|mid|high|vocal|drums|bass|other` (0..1), `hit(kind, t, halfLife)` decaying pulses.
- Every `Frame` already carries `f.a` = `{rms,low,mid,high,vocal,drums,bass,other,kick,snare,hat,vonset}` and `f.beat,f.bar,f.beatPhase,f.barPhase`.

## Writing a scene

One file `app/src/scenes/<name>.ts`, default-exporting a class extending `Scene` (`src/engine/scene.ts`):

```ts
import * as THREE from 'three';
import { Scene, type Frame } from '../engine/scene';
import { FSPass, Layer2D, W, H, clearRT } from '../engine/gl';

export default class MyScene extends Scene {
  bg = new FSPass(`uniform float t; void main(){ fragColor = vec4(C_INK, 1.0); }`, { t: { value: 0 } });
  text = new Layer2D();
  async init() { /* build geometry, precompute text outlines, etc. */ }
  render(f: Frame, out: THREE.WebGLRenderTarget) {
    const { renderer, comp, lyrics } = this.ctx;
    this.bg.u.t!.value = f.t;
    this.bg.render(renderer, out);            // fullscreen shader → out (overwrites)
    const c = this.text.ctx; this.text.clear(); /* draw with Canvas2D */
    comp.draw(renderer, this.text.upload(), out); // alpha-over onto out
    return { bloom: 0.7 };                   // post overrides (optional)
  }
}
```

Rules:

- **Deterministic**: output must be a pure function of `f.t` (and seeded randomness: `mulberry32(seed)`, `hash(...)`). Never use `Math.random()`, `Date.now()` or `performance.now()` for visuals. The export averages many sub-frames per frame, in any order (see "Motion blur and sampling"). If you need simulation state (particles, feedback buffers), set `stateful = true`, reset in `reset()`, integrate with `f.dt`, and the engine will fast-forward after seeks; such a scene can only be exported with a fixed `--samples`.
- `render()` must fully overwrite `out` (a HalfFloat linear-HDR target). Colours are **linear**; values > ~0.85 bloom. Use palette constants (`C_INK`, `C_BONE`, `C_SIGNAL`… in GLSL; `LIN.signal` in TS for GL; `rgba('signal', a)` for Canvas2D).
- `ctx.params` holds the timeline entry's params (one module can serve several entries); `ctx.start/ctx.end` its window; `f.lt`/`f.p` local time/progress.
- Transitions: by default the engine crossfades overlapping entries. For custom transitions set `handlesTransition = true` and composite `f.under` (the previous scene's frame) yourself using `f.tin` (0→1 over the overlap). Most cuts should be hard cuts on downbeats (no overlap) — that's the default when windows touch.
- Post overrides you can return: `exposure, bloom, bloomThreshold, bloomKnee, bloomRadius, halation, ca, grain, vignette, hud (HUD opacity), fade, flash, shake:[x,y], zoom, invert, pdoomText, hudCorruption`. Defaults in `src/engine/post.ts`.
- Performance: aim for < 25 ms/frame. Canvas2D layers cost ~2–4 ms to upload each; don't use more than 2–3 per scene. Precompute in `init()`.
- Don't edit files outside your scene files (and your own helper files named `scenes/<name>-*.ts`). Engine changes: ask the lead (report in your final message what you'd need). Do not edit `src/timeline.ts`.

## Toolbox

- `gl.ts`: `FSPass(frag, uniforms)` fullscreen GLSL3 pass (has `vUv`, writes `fragColor`, gets `GLSL_COMMON`), `Compositor` via `this.ctx.comp.draw(renderer, tex, target, {mode:'normal'|'add'|'screen'|'multiply'|'max', opacity, tint, scale, offset})`, `Layer2D` (1920×1080 logical Canvas2D → sRGB texture), `makeRT()` (screen-sized HDR target; `makeRT(w, h)` takes logical px), `clearRT(renderer, rt, [r,g,b])`, `SCALE`/`PW`/`PH` (output scale and physical size).
- `glsl/common.ts` (`GLSL_COMMON`, prepended to FSPass; import it into your own ShaderMaterials): palette consts, `hash*`, `snoise(vec2|vec3)`, `fbm`, `curl2`, 2D/3D SDFs, `smin`, `aaFill`, `aaStroke`, **`hatch(u, darkness)` and `engrave(uv, darkness, freq, angle)`** for engraving-style shading (`hatchD(u, darkness, du)` takes the derivative of `u` from the caller, for a coordinate whose `fwidth` lies, such as an angle that wraps), `heat(x)` orange ramp, `toSRGB/toLinear`.
- `lines.ts`: `LineBatch(capacity, {screen2D, worldWidth, blend})` — GPU capsule segments, 2D pixels (y down) or 3D with a camera. `seg2`, `seg`, `polyline`, `render(renderer, out, camera?)`. Colours linear, can exceed 1 for glow. Good for 10k–200k segments.
- `type.ts`: fonts. `F.archivo(width 62–125, weight 300–900)` (grotesk with width steps 62/75/87.5/100/112.5/125), `F.archivoItalic()`, `F.serif(weight, italic)` (Cormorant Garamond), `F.mono(weight, italic)` (IBM Plex Mono). `font(family, px)` → CSS font string. `layout(text, family, size, tracking)` → per-glyph x/advance with the font's kerning (draw glyph i at `glyphs[i].x`). `glyphX(text, i, family, size)` → where to start drawing `text[i..]` when a word is drawn in pieces (sung/unsung colours, wipes); never offset a piece by `measure(text.slice(0, i))`, which drops the kern between the pieces. `fitSize`, `measure`, `textPath2D` (opentype outline as Path2D), `textPathCommands`, `textPoints(text, family, size, step)` (points filling the glyphs — "text made of atoms"). `smart(s)` / `plain(s)`: typewriter quotes → typographic (’ “ ” …) and back.
- `stroke.ts`: single-stroke plotter/engraving fonts (`script`, `hscript`, `sans`, `readable`, `tech`, `serif`, `osmotron`, `felix`): `strokeText(text, font, size, tracking, kern)`, `drawStrokeText(ctx2d, st, lengthPx)` → returns pen head position, `writtenLength(st, charTimes, t)` to sync writing to word timings. The fonts have no kerning tables: pairs that leave a hole (To, Yo, We, AV, LT…) are kerned optically from the glyph shapes (off for the connected scripts).

## Typography

- Proportional text gets the font's kerning: whole strings through Canvas2D get it for free; glyph-by-glyph drawing must use `layout()` / `glyphX()`. Adjacent runs in different fonts or sizes have no kerning between them: set that gap by eye.
- Lyrics come with typographic punctuation (`don’t`, `’cause`, `“Just`): `Word.w` and `Line.text` go through `smart()`; `lyrics.get()` matches straight or curly quotes. Hardcoded display strings use ’ “ ” … – — × − too. Mono text (IBM Plex Mono) is the UI/terminal voice and keeps typewriter quotes (`plain()` for a lyric shown as typed input).
- No outlined or haloed type.
- `util.ts`: `clamp, lerp, remap, smoothstep, ease.*, prog(x,a,b,ease), keys(t, [[t,v,ease],...]), springStep, pulse, mulberry32, hash, noise1/2/3, fbm1/2, polylineLengths, pointAtLength, window01`.
- `hud.ts`: the global HUD (crop marks; optional captions from timeline entries, unused since revision 2; the bottom-left P(doom) readout is OFF unless a scene returns `post.pdoom > 0`). P(doom) is staged inside plates: `new PDoom(lyrics).value(t)`, `formatPDoom(v)`, and `drawReadout(ctx2d, x, y, v, {scale})` to draw the instrument anywhere. `PDoom.value(t)` is available as `engine.hud.pdoom` — if you need the value in a scene, recompute with `new PDoom(this.ctx.lyrics).value(t)`.

## Output scale (4K)

`?scale=2` (render.ts `--scale 2`) renders a true 3840×2160 frame. Scenes keep laying out in logical 1920×1080 px (`W`, `H`, `ctx.W`, `ctx.H` never change); the engine handles the rest:

- Render targets: `out`, the engine's targets and `makeRT()` are physical (`PW`×`PH`). `makeRT(w, h)` takes logical px and allocates `w*SCALE`×`h*SCALE`; pass `{ pxScale: 1 }` for a data-sized target whose resolution must not follow the output.
- `Layer2D`: the backing canvas is `SCALE`× larger and its context is pre-scaled, so drawing code works in logical px. `setTransform`/`resetTransform`/`getTransform`, `shadowBlur`, `shadowOffsetX/Y` and `filter` px lengths are patched to stay logical. Not patched: `canvas.width/height` and `getImageData`/`putImageData` are physical px, and `drawImage(layer.canvas, x, y)` needs an explicit size. `new Layer2D(w, h, 1)` makes a deliberately low-res layer (e.g. a soft glow). `scaleContext2D(ctx, SCALE)` applies the same patch to your own canvas.
- `LineBatch`: coordinates and widths stay logical; the AA feather and the hairline floor work in physical px, so hairlines stay crisp.
- GLSL (`GLSL_COMMON`): `gl_FragCoord`, `fwidth` and `dFdx` are physical. Use `FRAG_PX` (the fragment position in logical px) instead of `gl_FragCoord.xy` whenever it is combined with logical sizes, and `PX_SCALE` to convert. A line whose width comes from `fwidth` ("a 1.2 px hairline": `1.0 - smoothstep(a, b, d / fwidth(u))`) gets thinner and fainter at 4K: write it as `pxLine(d, a, b)`, which is identical at 1× and keeps the 1× ink with sharper edges at 4K (`rampLine` does the same for the linear-ramp idiom). `hatch`, `engrave` and `aaStroke` already do this. LOD thresholds and supersampling offsets expressed in pixels should be logical (`fwidth(u) * PX_SCALE`, offsets `/ PX_SCALE`).
- Offscreen canvases used as textures (atlases, text planes) keep their own size: make them `SCALE`× larger (with `ctx.scale(SCALE, SCALE)`) if they are shown large, or they look soft at 4K.
- Post (bloom, halation, CA, grain, vignette) and the HUD scale automatically; the bloom pyramid stays at the logical resolution.

## Motion blur and sampling

The export renders every frame as the average of many sub-frames spread over the shutter (`--shutter 0.2`: a fifth of the frame time, centred on the frame's time), before post-processing. `--samples N` takes N evenly spaced sub-frames; `--samples auto` chooses the count per 32×32-logical-px tile (`Engine.render`, `AdaptiveSampling`):

- The count steps through 4, 12, 36, 108, 324. Each step adds a sub-frame either side of every existing one, so each set is evenly spread and centred on the frame's time.
- After each step the engine compares the new sub-frames' average with the old ones' (displayed values, worst 2×2-logical-px block). Stepped copies of a moving edge differ between the two sets; a converged streak or a still image does not. Stepping shrinks as 1/count, so the remaining error is about half the change the last step made; a tile stops when that is below `--tol` (default 3 levels of 255) in it and its 8 neighbours. A tile that has stopped is final: it is the average of its first n sub-frames, the image the per-frame sampler would give had it stopped at n.
- Later sub-frames skip the tiles that have stopped: the engine writes the tiles still refining into the depth buffer of its targets, and while it renders a sub-frame every draw into them is depth-tested against that mask, whatever the material says, so the GPU rejects the stopped tiles before shading them (early-Z; a stencil test does not reject early on Apple GPUs). The final average weighs each tile by its own count.
- In practice a still frame stops at 12, ordinary camera motion at 36, and whips, slams and fast zooms at 108 or 324. At 1:1 in 4K, 108 can't be told from 324, while 36 still shows faint striations on the fastest edges.
- `refine: 'frame'` (`--refine frame`) decides for the whole frame at once, as before tiles: every tile then takes the count its worst tile needs.

What this asks of scenes:

- Sub-frames are rendered out of time order and in any number: a scene's output must depend on `f.t` only. `stateful` scenes can't be sampled adaptively (the engine refuses); nothing may count `render()` calls.
- Per-frame flicker and jitter keyed to 60 fps must use `frameIdx(t)` (`util.ts`), not `Math.floor(t * 60)`. `frameIdx` is constant over the frame's shutter; `floor` switches at the frame's own time and double-exposes two states in every frame.
- Noise that changes with continuous `t` (a hash seeded by time) is resampled in every sub-frame: it averages out, but slowly, and makes the adaptive sampler work harder. Seed it with `frameIdx(t)` unless it is meant to smooth out.
- A spark emitter whose rate varies over time passes the rate as a function of the birth time, with its maximum (`sparkParticles(..., { rate: (tb) => ..., rateMax })`). A rate read at the current `t` re-times every particle from one sub-frame to the next.
- Shaders that supersample internally (4 rotated-grid taps) take `ssTap: SS_TAP` and `${SS_TAP_GLSL}` and loop `for (int k = ssK0(); k < ssK1(); k++) ... rgss(k)`, weighting by `ssWeight()`. The engine then hands each sub-frame one tap, cycling them (every set is a multiple of 4), which averages to the same image for a quarter of the cost. In the preview and single-sample stills they take all four.
- Post parameters (shake, flash, zoom, fades, the HUD mode) are read at one point of the shutter, 1/8 of it after the frame's time (where the video was tuned, and a point every sample set includes); the HUD, grain and dither are drawn once per frame.
- Masked tiles keep what the last sub-frame drew there. That is safe for `out` and the engine's own targets. A scene's own target keeps being drawn in full (and costs full price) unless the scene lists it in `tileMasked`: only a target with a depth buffer whose texels are read back at their own screen position or within a few px of it (`margin: 1` widens the mask by a tile), like shoggoth's half-res G-buffer, or, with `moving: true`, one read through a zoom or pan that the scene gives before each sub-frame's draws with `ctx.mapTileMask(rt, map)`, like the room at the bottom of loom's dive (`null` while it is read through the spiral). A target read through a warp or a wide blur must not be listed.
- A draw into a masked target whose material asks for its own depth test (3D with a depth buffer) can't use the mask: the engine draws that sub-frame again unmasked and keeps drawing that scene unmasked.

## Shared motifs (`app/src/scenes/_motifs.ts`)

Use these so recurring motifs look identical across plates: `sparkHead(lineBatch, x, y, t, scale, intensity)` + `sparkParticles(lineBatch, t, headAt, opts)` (the spark, drawn with a 2D additive `LineBatch`), `sparkHead2D` (Canvas2D fallback), and the mask: `drawMask2D(ctx, x, y, R, rot)`, `MASK` geometry constants and `GLSL_MASK` (`sdMaskInk(p)` in mask units, y down). Read-only for scene agents; ask the lead for changes.
