# Ora 2 image model launch film

- **Source page:** https://prompt-motion.com/rossaxbt-3085b7
- **Author:** testarossa (@rossaxbt)
- **Original post:** https://x.com/rossaxbt/status/2107845961691091295
- **Model:** Opus 5.5
- **Stack / engine:** HTML canvas + Playwright + ffmpeg (classified: html)
- **Posted:** Oct 7, 2026
- **Site tags:** product-ui, photos, music
- **Video size:** 1080x1080
- **Video file:** https://media.prompt-motion.com/rossaxbt-3085b7/video.7261bee4.mp4

## Prompt (verbatim, as published)

```text
<inputs>
Ask me for: my product name, a one-line pitch, my logo, 3 to 6 screenshots of the product, 40+ images of what it creates (or photos of it), my brand colors and font, an ElevenLabs API key and voice ID, plus a royalty-free track with a clear drop (the audio file and the drop timestamp). If I skip anything, use these defaults: "Ora 2", "an image model made for taste", free images from Unsplash and Pixabay, Geist, ink #111214, the voice Samara X (19STyYD15bswVz51nqLf) on eleven_v4, and Pixabay "Cascade Breathe" (129.83 BPM, drop at 75.39s).
</inputs>

<script>
Write a 9-line voiceover in this format and adapt every line to my product:
"This is [name]. A [category]... built for [value]. [Verb] in ANY style. Give it a [input] - and it just... understands. The more you use it, the BETTER it gets. Adjust its [setting]. Its [setting]. Its [setting]. Every [output] - exactly as you pictured it. [Name]. Out now."
Use emotion tags sparingly: [softly] on the quiet lines and [excited] on the [Verb] line. Don't tag the opener, and end it with a plain full stop.
</script>

<voice>
Call the ElevenLabs API directly using my key, without an MCP. Generate 4 full-script takes in one pass and let me choose. If a line doesn't sound right, regenerate just that line 4 times and splice the best version into my take.
Shorten pauses longer than 0.28s to 0.2s, then bring each phrase 85% of the way toward the median level, adjusting gain only during pauses.
For word timings, split the read at pauses of 100ms or longer, transcribe each segment separately with Whisper, and align its first word to the measured onset. A single Whisper pass can place words up to half a second late.
</voice>

<direction>
A 22-second square launch film, 1440x1440 at 60fps, in the style of an AI lab launch: white canvas, one typeface, black ink, real images, and captions typed word by word at the exact time they're spoken.
Every control (prompt bar, settings panel, caption pill) uses liquid glass: frost the scene behind it, bend that scene along the edge like thick glass, then add a top sheen, bright rim and soft lift shadow. Glass disappears on plain white, so add a slow pastel aura in my brand colors or a blurred wash of the photo behind it.
The one emphasized word types in a gradient of my brand colors, with a faint glow behind it.
Motion rules: keep the camera drifting (push from 1.0 to 1.04 per scene; when content moves to the next scene, start at the zoom where the previous scene ended). Nothing appears instantly: use eased fades of at least 0.3s. Change images on 16th notes, with a click for each. Land scene changes on phrase starts, and align the music drop with the [Verb] line. Don't show full stops on screen.
Banned: selection-box highlights, beat-snapped slams, white flashes, 3D, templates.
</direction>

<structure>
Seven scenes, timed to the voice:

1. "This is [name]": a collage of my images drifts out as the name types in large, then gives way to the category line.
2. "made for [value]": full-screen flashes of my best images switch on 16th notes into the drop, with the line typed in white over them.
3. The drop: a glass prompt bar types a short prompt. The result card changes style every 16th note, while a black style chip rolls to each new name above a thumbnail strip.
4. "Show it a moodboard": 9 images fly into a 3x3 grid, then circle the result as "It gets you" types on screen.
5. "The more you use it, the better it gets": type two lines, with the emphasized word in the gradient.
6. The settings: show a glass panel with 3 sliders, each moving as she names it. Shift the image's hue, roll new seeds on 16ths, then turn it into a poster. Shift a blurred wash of its colors behind the glass in sync.
7. "Every [output], exactly how you see it": burst 120 of my images outward from the center behind a glass caption pill, then bring them together into my logo as the name types on. Put "Out now" underneath and hold for 2s.

Replace the prompt bar, results and sliders with my product's real input, outputs and settings.
</structure>

<sound>
Set the song so the drop lands on the [Verb] line, and anchor the beat grid there.
Duck the music under the voice with a 3-band sidechain (lows 30%, mids 85%, air 55%; 0.3s hold, 50ms look-ahead, 0.5s release). Then adjust the mids of each phrase until the voice sits about 9 dB above the music between 300 Hz and 4 kHz.
Use one downloaded Mixkit SFX per event, positioned by its measured peak: a click for each image change, a key sound for every typed letter, a soft landing on the emphasized word, whooshes, and impacts on the drop and logo. Trim each around its peak (many risers are 4 seconds). Fade the music along a dB curve under the end card. Loudnorm to -14 LUFS.
</sound>

<build>
1. One HTML canvas. Every frame is a pure function of time inside seek(t), and every caption and cut follows the word table.
2. Glass: capture the canvas behind the shape, blur it about 14px for the body, draw a lightly blurred copy magnified about 1.06x in a 12px band along the edge, then add the milk, sheen, rim and shadow.
3. Render with Playwright at 60fps using 8 motion-blur subframes, then encode with ffmpeg.
4. Before showing me anything, make a contact sheet of stills, scan frame differences for single-frame pops (only the 16th-note runs may jump), and check the voice-to-music ratio for every phrase.
</build>

<gotchas>
A [warmly] opener can sound whispered, while [excited] can feel fake. A highlight box behind a word looks like a Windows text selection. If the camera resets to 1.0 during a handoff, the zoom snaps. A 0.05s fade looks like an instant pop-in.
</gotchas>

<start>
Ask me for the inputs, write the script, send me 4 voice takes to choose from, then show me 8 stills before the full render.
</start>
```
