# Factory TODO

Sound and finishing work for reels. Today the soundtrack is our own beat-locked synth
(`src/factory/soundtrack.js`), timed from the agent's `out/cues.json`. These items replace or
extend it. Every item must keep the factory's rules: nothing a viewer hears may make a claim the
article does not, everything is licensed for commercial social use, and every step is time-boxed
and non-fatal.

## 1. ElevenLabs voiceover (done)

Built in `src/factory/voice.js`, wired through `storyboard.js`, `director.js`, `hero.js` and `index.js`:

- [x] Settings: `FACTORY_VOICE`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` (default `eleven_v4`, the latest), `ELEVENLABS_FALLBACK_MODELS`, `ELEVENLABS_STABILITY`, `FACTORY_VOICE_FALLBACK_MODEL` / `_VOICE` (OpenRouter).
- [x] The storyboard writes a `voiceover` line per scene for agent reels, with ElevenLabs audio tags (`[curious]`, `[deadpan]`, `[pause]`, `[low, steady voice]`...). Gated like the screen: numbers, banned words and emoji with tags stripped, a words-per-second budget per scene, at most 3 well-formed tags, no SSML.
- [x] ElevenLabs `/v1/text-to-speech/{voice}/with-timestamps` for the whole script, exact word timings from the character alignment; a refused model falls back to the next; cached by script hash.
- [x] OpenRouter fallback (`openai/gpt-audio-mini`, used while there is no ElevenLabs key): strict TTS framing, one request per scene, every clip proven by its own voiced audio and transcript (that model can stop mid-script and stream silence), trimmed and joined; scene windows exact, word timings estimated.
- [x] The voice is recorded BEFORE the film: `voice.json` (scene windows, words) goes to the director and the agent, who time every reveal to the spoken words; the film must outlast the voice.
- [x] Mix: voice on top, music ducked by a sidechain compressor, mastered to about -14 LUFS / -1.5 dBTP.
- [ ] When the ElevenLabs key is in `.env`: run one reel and listen; pick a voice id (or a clone) and set `ELEVENLABS_VOICE_ID`.

## 2. Music selection, download and use

- [ ] Pick a licensed source with an API and terms that allow use in Instagram posts by a
      personal/creator account (e.g. a paid stock-music API). Record the licence per track in the
      job folder; never use tracks without a licence that covers it.
- [ ] `src/factory/music.js`: from the director's prompt (mood, tempo, energy arc) build a query,
      fetch candidates, and score them by BPM fit (within +/-4 of the storyboard's bpm, or
      half/double), length >= piece length, energy curve, and "not used in the last 15 pieces".
- [ ] Download with the same safe fetcher rules as the rest of the factory (public hosts,
      size cap, magic-byte check), cache by track id, keep `music.json` (title, artist, licence,
      source URL) next to the reel.
- [ ] Beat-map the chosen track (ffmpeg + an onset/beat detector) and give the agent the real
      downbeats instead of a synthetic 120 bpm grid; cut on them.
- [ ] Trim and fade to the film length; loop point at a bar boundary when the reel loops.
- [ ] Keep the synth as the fallback when no track fits or the API is down.

## 3. SFX and VFX on cuts

- [ ] A small licensed SFX library in `factory/library/sfx/` (whoosh, impact, tick, stamp,
      paper, mechanical click, riser, glitch), each with loudness normalised and a licence file.
- [ ] The agent's `cues.json` grows from `cuts` to typed events:
      `{"t": 3.2, "kind": "impact|whoosh|tick|stamp|riser|glitch", "weight": 0.0-1.0}`, written
      where its motion actually lands (a slam, a stamp, a page turn, a camera whip).
- [ ] `soundtrack.js` (or a new `sfx.js`) places each SFX by its event, with per-kind gain and a
      short pre-roll for whooshes, and keeps SFX under the voice.
- [ ] VFX the agent applies on cuts, as a shared helper set it can import: motion blur by
      sub-frame blending, chromatic misregistration on impact frames, film grain/halation,
      flash frames, a camera shake on impacts. All deterministic (seeded by frame).
- [ ] QA: a frame-by-frame check that every SFX event lines up with a visual event (+/- 1 frame).

## Done when

- A reel ships with voice, licensed music and cut-synced SFX, mastered for Instagram, with
  `voice.json`, `music.json` and the SFX cue list in its job folder for review.
- Any of the three can be switched off and the reel still renders with the synth.
