# Prompt Motion site promo

- **Source page:** https://prompt-motion.com/antonio-kodheli-490109
- **Author:** Antonio Kodheli (@antonio_kodheli)
- **Original post:** https://x.com/antonio_kodheli/status/2107518066615582893
- **Model:** Opus 5.5
- **Stack / engine:** Remotion (classified: remotion)
- **Posted:** Oct 6, 2026
- **Site tags:** product-ui, music
- **Video size:** 1280x720
- **Video file:** https://media.prompt-motion.com/antonio-kodheli-490109/video.f4d6e825.mp4

## Prompt (verbatim, as published)

```text
<inputs>
Ask me for: the gallery URL (default www.prompt-motion.com/), one entry whose prompt
gets shown on screen, and a royalty-free track around 120 BPM with a clear drop (e.g. Mixkit).
</inputs>

<direction>
A 23-second 16:9 promo for a gallery of Claude-made motion videos, built only from the site itself:
its real header, its real grid of autoplaying previews, its real entry page and prompt.
Use the site's skin: near-white page, black pills, one UI font (Geist), and Geist Mono for prompt text.
One accent (red-orange #F0442C), used only for the highlighter, the cursor halo and the dot on the URL.
One continuous camera over a single "world" layer. Never two camera moves at once.
Every clip on screen carries its creator's @handle, exactly as the site shows it.
Banned: a "Generate" button or any feature the site doesn't have, invented numbers, paraphrased
taglines, fades on everything, glass cards, gradients, bouncy type, dead holds.
</direction>

<structure>
120 BPM, 46 beats.
b0–2: frame 0 is one real reel, full-bleed. The camera pulls back until it is just the first
  card on the site's home page. The header, then the tagline's first half, land on b1.
b2–9: hold on the live page: header plus a 3-column masonry of playing previews.
b9–13: the grid scrolls, then the camera whips into one tile until it is full-bleed.
b13–16: the music drops. Three full-res reels from the gallery, one beat each, hard cuts,
  each with a dark handle chip inside the safe area.
b16–21: the last reel shrinks back into its own tile (a match cut). A cursor with an accent halo
  hovers a tile and clicks.
b21–26: that tile blooms into its entry page: the video on the left; author, title,
  Model / Stack / Posted and the prompt on the right.
b26–32: the camera pushes 1.5× into the prompt while the video slides out. A solid accent highlighter
  sweeps one phrase. The cursor presses Copy, which turns into "Copied".
b32–46: the page slides off left. The "Copied" pill lifts, relabels to the URL and docks.
  Then "Prompt Motion" and both verbatim halves of the tagline land, and a rail of real tiles
  rises on the right. The last frame is the poster: two whole tiles, both handles visible.
</structure>

<build>
1. Remotion, 1920x1080, 30 fps. Every cue lives in timeline.ts (in beats) and every string in copy.ts.
   Scenes contain no magic numbers.
2. Scrape the site first: tagline, handles, avatars, preview MP4s and full-res videos, plus one
   entry's prompt. Quote all of it verbatim.
3. Lay out the gallery once in world coordinates. Drive the camera as (focus x, focus y,
   log-scale) tracks. Tile corner radius goes to 0 as a tile reaches full-bleed, so the
   pull-back, the whip-in and the match-cut back are all exact.
4. A tile that plays before the burst uses the same full-res file with an offset startFrom,
   so the whip lands on the burst's first frame.
5. The preview MP4s don't loop cleanly, and many contain hard cuts. Run scdet on every clip.
   Loop only windows with no cut inside them, with a 12-frame dissolve at the seam, and stagger
   each tile's phase so neighbouring tiles never change on the same frame.
6. Use one cursor that homes on the live button position, because the camera keeps creeping
   during holds.
7. Conform the track to 120 BPM with its drop on the burst. Place SFX by their measured peaks.
   Fill the track's own breaks with reversed whooshes into the hits. Mix to −14 LUFS.
8. Render stills at every cut before a full render. Run QA for frozen time and one-frame snaps.
   Then have a fresh critic who didn't build it review the render, and fix what it finds.
</build>

<gotchas>
Real gallery clips carry their own HUDs, cursors and cuts. Keep overlays (handle chips, our cursor)
clear of them, and don't put a cut-heavy clip anywhere the frame should feel calm.
If the page color matches a clip's background, the tile disappears; give tiles a 1px hairline.
On a camera push, check the last frame: the header and meta rows can drift into the edge bands.
</gotchas>
```
