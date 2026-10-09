# 38-second fictional game trailer built entirely in code

- **Source page:** https://motionpromptgallery.com/p/38-second-game-trailer-built-in-code-theparuchh/
- **Author/creator:** Paruchh @theparuchh
- **Model:** GPT-6 Astra
- **Tools/engine:** Blender (headless bpy) + Python audio synthesis + ffmpeg
- **Original post:** https://x.com/theparuchh/status/2106824464092770455
- **Posted:** 2026-10-04
- **Site tags:** motion, 3d, blender, audio, video, one-shot
- **Aspect ratio:** 1280/720
- **Provenance note (from the gallery):** Prompt verbatim from the creator's own reply under the X post (X auto-linked "build.sh"; shown here as typed). Preview clip and poster from the creator's own video in the X post (re-encoded excerpt). Audio kept because the code-generated music and sound are part of the piece.

## Prompt (verbatim as published)

````text
Create a cinematic trailer for a fictional game, 35–40 seconds long, with the production quality of a reveal at The Game Awards

MAIN RULE
Everything the viewer sees and hears must be created by your code: geometry, materials, animation, lighting, particles, titles, music, and sound
No premade models, textures, HDRIs, images, videos, audio, or logo fonts from the internet
System fonts are allowed

TOOLS

- Blender (headless, Python/bpy): procedural generation using Geometry Nodes and shader nodes, animation using keyframes and drivers
- Rendering: EEVEE Next (bloom, volumetrics, motion blur, depth of field), use Cycles only for 1–2 hero shots if time allows
- Audio: synthesis in Python (numpy/scipy) or SuperCollider for music, ambience, impacts, whooshes, rumble, and a deep BRAAAM at the climax
- Assembly: ffmpeg for editing, color grading, grain, 2.39:1 letterboxing, and audio mixing

STEP 1: CONCEPT
Invent a game: its title, setting, conflict, and one memorable visual hook, such as a world with floating mountains or a gigantic creature beneath the clouds
Write it in CONCEPT.md

STEP 2: STORYBOARD
Plan 8–12 shots with timecodes in STORYBOARD.md
For each shot, describe what is in frame, camera movement (dolly, crane, orbit, FPV flythrough, slow push-in), focal length, lighting, and sound
Structure:

- 0–8 s: quiet and atmosphere, dawn, slow wide shots
- 8–20 s: increasing pace, transition between day and night (time-lapse sky and shadows), first signs of a threat
- 20–32 s: climax, fast cuts on the beat, epic scale, particles, bursts of light, a creature or an event
- 32–35 s: impact, black screen, animated game logo
- 35–40 s: “Coming 2027” and a quiet final sound

STEP 3: WORLD AND ANIMATION IN BLENDER

- Procedural terrain (noise + erosion), procedural vegetation or ruins using instancing, water or volumetric clouds
- At least one complex character or creature animation: a bone rig created through code, procedural walking or wing flapping, secondary animation (tail, cloth, dust particles)
- Dynamic sky: Nishita sky or a custom shader, sun moving along an arc, stars at night
- Atmosphere: fog, god rays, dust in light beams, particles (sparks, ash, leaves)
- Camera: smooth Bézier curves, easing, subtle noise-driven handheld shake in dynamic shots, no linear movements
- Logo: 3D text or a procedural emblem with an assembly animation and an emissive shader

STEP 4: AUDIO
Synchronize the music with the edit: tempo and impacts must align with cut timecodes
Layers: ambient pad, pulsing bass, percussion during the climax, sound design for specific on-screen events
Final mix: stereo, normalized to -14 LUFS

STEP 5: QUALITY CONTROL

- First render a low-resolution preview of each shot and 3 still frames per shot, inspect them yourself and honestly assess composition, lighting, readability, and whether it looks expensive, rework weak shots
- Only then perform the final render

DELIVERABLES

- trailer.mp4: 1920×1080, 24 fps, H.264, AAC
- Source folder: .blend file, all generation scripts, audio script, assembly script
- build.sh / build.ps1: one command that rebuilds everything from scratch
- README.md: concept, storyboard, description of techniques, render time

SUCCESS CRITERION
Someone watching without any context should believe this is a real game trailer rather than a technical demo
Priority: atmosphere, lighting, and rhythm matter more than object count

Choose the technologies yourself within these constraints
Work autonomously until the finished result is ready
````
