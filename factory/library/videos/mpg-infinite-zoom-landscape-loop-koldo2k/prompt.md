# Infinite-zoom landscape loop

- **Source page:** https://motionpromptgallery.com/p/infinite-zoom-landscape-loop-koldo2k/
- **Author/creator:** Koldo Huici @koldo2k
- **Model:** Claude Opus 5.5
- **Tools/engine:** Canvas + AI images
- **Original post:** https://x.com/koldo2k/status/2103129343253778767
- **Posted:** 2026-09-24
- **Site tags:** ai-image, canvas, explainer
- **Aspect ratio:** 720/406
- **Provenance note (from the gallery):** Prompt verbatim from github.com/yihui-dev/awesome-opus5-5-videos (prompts/koldo2k-778767.md); the creator also supplied their own reference assets; title/date from github.com/zhuyansen/awesome-opus-5.5-video. Preview clip and poster: Skillry media of the original post (skillry.dev/ai-videos/opus-5-5/koldo2k-778767).

## Prompt (verbatim as published)

````text
Build a looping "infinite zoom" animation, After Effects style: the camera
travels from landscape to landscape by flying through vintage objects.

LOOK: vintage collage realistic photo landscapes + black & white newspaper
cutout objects (halftone, white paper border, soft shadow). Film grain,
vignette, light flicker.

WORLDS (loop): snowy mountains → pocket watch (swinging on its chain) →
sea cliffs → box camera lens → desert dunes → magnifying glass →
misty lake → hand mirror → back to start.
Extras: floating hat, phone, umbrella, gramophone, key; a 1950s man walking
toward the watch; a whale swimming across the cliffs sky.

HOW:
- Generate everything via the Magnific MCP (Seedream 5 Pro landscapes,
  GPT 2.5 transparent cutouts, depth maps, Kling 2.5 animation, Lyria 3
  music). List the generations + credit cost and wait for my OK first.
- Split each landscape into 3 depth layers from its depth map and fill the
  hidden areas. Parallax: layer scale = camera^Z, Z between 0.45 and 1.22.
- Each portal's glass holds the next world; cut seamlessly when it fills
  the frame.
- Constant speed: exponential zoom to a fixed point, each segment's duration
  proportional to log(zoom). Verify the cuts frame by frame.
- Man & whale: generate on pure green (#00B140), animate in place with
  Kling, key out every frame, build a seamless loop (ping-pong if needed).
- Cutouts animate at 15 fps (on twos).
- 20 s loop, 1920×1080, 30 fps. Music: 96 BPM, cut to exactly 8 bars = 20 s.

DELIVER: an interactive artifact (viewer, AE-style timeline, music +
MP4 download) and a rendered MP4 with music under 30 MB.
Show me screenshots before each expensive step.
````
