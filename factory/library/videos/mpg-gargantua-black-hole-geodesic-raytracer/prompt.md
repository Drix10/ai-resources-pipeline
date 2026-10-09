# Gargantua black-hole geodesic raytracer (WebGL2)

- **Source page:** https://motionpromptgallery.com/p/gargantua-black-hole-geodesic-raytracer-webgl2-devloper-hs-k/
- **Author/creator:** Harsh @devloper_hs
- **Model:** Kimi K3
- **Tools/engine:** Three.js · single HTML file
- **Original post:** https://x.com/devloper_hs/status/2079590483727442205
- **Posted:** 2026-07-20
- **Site tags:** simulation, shader
- **Aspect ratio:** 960/540
- **Provenance note (from the gallery):** Prompt as published on hyper3d.ai/3d-prompts/single-file-webgl2-black-hole-raytracer-2079590483727442205 (mirrors tripo3d.ai, which cites the original X post); model per those pages. Poster image from that page. Preview clip: first 30 s of the creator's own video in the X post (re-encoded excerpt).

## Prompt (verbatim as published)

````text
Create a complete, self-contained single HTML file (no external libraries like Three.js) that implements a real-time geodesic raytracer for a Schwarzschild black hole inspired by Gargantua.

Use raw WebGL2 with GLSL ES 3.00 in a single fragment shader. Implement accurate physics: null geodesic integration with 4th-order Runge-Kutta solver, event horizon, photon sphere, accretion disk with proper rendering, gravitational lensing, Doppler beaming, and gravitational redshift effects. Target stable 60 FPS performance.

Include mouse-controlled camera orbiting/zooming, and a cyberpunk-style control panel with sliders for parameters (mass, spin, disk density, view angle, etc.). Add subtle particle effects for matter falling in and dynamic lighting/shadows.

The output must be 100% complete, immediately runnable in a modern browser, with no black screen, NaNs, errors, or missing features. Prioritize numerical correctness, boundary handling, solver discipline, and physical accuracy above all. Verify and comment key physics equations in the code. Make it visually stunning and interactive like a premium physics demo/game.
````
