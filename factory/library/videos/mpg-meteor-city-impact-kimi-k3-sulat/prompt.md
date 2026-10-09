# Meteor City Impact: cinematic procedural meteor strike

- **Source page:** https://motionpromptgallery.com/p/meteor-city-impact-kimi-k3-sulat/
- **Author/creator:** Sulat sulat.com
- **Model:** Kimi K3
- **Tools/engine:** Procedural 3D, single static page
- **Original post:** https://meteor-city-impact.k3.demos.sulat.com/
- **Site tags:** motion, 3d, simulation, vfx, one-shot
- **Aspect ratio:** 1200/630
- **Provenance note (from the gallery):** From Sulat's one-shot demo catalogue (k3.demos.sulat.com). The demo page describes itself as "a one-shot AI demo made with Kimi K3 by Moonshot AI". The prompt is the demo's published PROMPT.md, verbatim. The poster is the catalogue's own thumbnail. Sulat publishes no dates or videos for its demos, so postedAt is empty and there is no clip.

## Prompt (verbatim as published)

````text
Create a large-scale, photorealistic-in-spirit procedural 3D visualization of a meteor striking a city, delivered as an interactive cinematic experience. The event unfolds as one continuous simulated sequence: the meteor's approach and fiery atmospheric entry, the blinding impact flash, an expanding shockwave rolling through downtown streets, buildings fracturing and collapsing, debris and dust plumes, fires catching, and a smoky aftermath. Everything is simulated and rendered live — no pre-rendered video.

Give the visitor director-like control: a cinematic timeline with play, pause, and scrubbing; authored camera chapters (orbital approach, street level, aerial) plus a free orbit camera that can circle the impact zone at any moment; playback speed from slow motion to real time; and toggles for effect layers such as shockwave distortion, dust density, and structural damage. Before the strike, the city is alive — moving traffic, lit windows, rooftop details, blinking aviation lights — so the destruction lands with real weight.

Camera and interface must be fully usable with mouse and keyboard. Mouse drag orbits the view, and paired WASD and arrow-key bindings move or orbit in the active camera frame by default: A and ArrowLeft orbit or move the camera left, D and ArrowRight orbit or move right, W and ArrowUp move the view forward or up, and S and ArrowDown move it backward or down, always relative to the camera's current orientation and staying correct after any rotation or chapter change. Every on-screen control — timeline, chapters, toggles — works with an ordinary mouse.

Delivery condition: the final artifact must expose a production-state browser probe, window.__ONESHOT_DIRECTIONAL_CONTROL_PROBE__ with reset() and sample(), that resets one deterministic, ready-to-control camera state and reports the real camera position, forward vector, and active-frame right basis so an external browser-level check can send A, ArrowLeft, D, and ArrowRight independently and reject missing, zero, or inverted responses. The probe must read the same production camera state and input listeners that visitors use — not a parallel test rig or a hard-coded answer.

Do not take shortcuts or settle for a cookie-cutter explosion sprite over a skyline texture. This skill imposes no token budget limit, so pursue the full depth of the event — entry glow, staged impact beats, building-by-building collapse behavior, dust dynamics, convincing shockwave physics, responsive interface states, and small environmental details — and keep refining until the sequence feels like an authored disaster film rendered live in the browser.
````

## Code tab (verbatim as published)

````text
Prompt file: https://meteor-city-impact.k3.demos.sulat.com/PROMPT.md
````
