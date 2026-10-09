# Jellyfish Jelly: squishable gummy jellyfish (WebGPU)

- **Source page:** https://motionpromptgallery.com/p/jellyfish-jelly-squishable-gummy-jellyfish-webgpu-vib3coded/
- **Author/creator:** Vib3Coded @vib3coded
- **Model:** GPT-6 Astra
- **Tools/engine:** ChatGPT-6 Astra
- **Original post:** https://x.com/vib3coded/status/2104651061336117614
- **Posted:** 2026-09-28
- **Site tags:** comparison
- **Aspect ratio:** 756/960
- **Provenance note (from the gallery):** Two-model build: Claude Sonnet 5.5 and ChatGPT-6 Astra. Prompt verbatim via jasonzhu.ai/en/prompts/claude-opus-5-5/2104651061336117614 (prompt source: https://x.com/vib3coded/status/2104651061336117614); metadata from github.com/zhuyansen/awesome-opus-5.5-video. Poster is the X video thumbnail.

## Prompt (verbatim as published)

````text
Create “Jellyfish Jelly” — a beautiful, interactive 3D gummy jellyfish that users can grab, stretch, and squish directly in their browser. Deliver a complete single-file HTML experience using genuine WebGPU.
ART DIRECTION
Make it look like a premium translucent gummy sculpture:
A rounded, softly scalloped jellyfish bell.
Six flowing tentacles and a few delicate internal structures visible through the bell.

Glossy, translucent material with thickness-dependent color absorption, refraction, subtle subsurface lighting, and gentle rim highlights.
Rich color in thicker areas and more transparency at the edges.
A warm off-white background, soft studio lighting, and a subtle shadow beneath the floating jellyfish.
Keep the composition elegant and uncluttered. Avoid opaque plastic, excessive bloom, blown-out highlights, and visible mesh seams.
GEOMETRY AND PHYSICS
Generate all geometry procedurally. No external models or image files.
Use stable position-based dynamics or a mass-spring system with approximate volume preservation.
The bell should feel soft but substantial. Tentacles should be lighter, more flexible, and respond with slightly delayed motion. Their roots must remain attached to the bell.
Allow users to grab the bell or any tentacle at the clicked location. Pulling should deform the nearby area first, then elastically move the surrounding geometry.
On release, the jellyfish should wobble and gradually recover without snapping back, teleporting, or oscillating forever.
Add a subtle idle swimming motion: the bell slowly contracts and expands while the tentacles trail behind. Reduce this animation while the jellyfish is held.
Do not fake softness by scaling or rotating the entire model. Clamp extreme stretching and use fixed simulation steps.
INTERACTION
Left-click or touch to grab and stretch.

Right-drag or drag empty space to orbit the camera.
Support a limited zoom range.
Keep camera gestures separate from object interaction.
Include Give it a nudge, Reset, Pause, and Reset view.
Add Firmness, Internal damping, and Pulse rate sliders.
Include ¼ speed and Show mesh toggles.
Provide three palettes: Moon, Coral, and Deep. Switching colors must not reset the simulation.
INTERFACE
Use a minimal editorial layout with thin borders, generous whitespace, clean sans-serif controls, and a large italic serif heading:
“Jellyfish.”
Caption:
“A little current.
A little glow.
A very soft drifter.”
Place a compact “THE SPECIMEN” control panel on the right and a WebGPU status indicator at the top.
QUALITY AND PERFORMANCE
Reuse geometry and buffers instead of rebuilding meshes during dragging. Keep internal details attached to the deforming body.
Handle transparency carefully, without disappearing tentacles, flickering surfaces, or harsh black outlines.
Test repeated grabs, strong pulls, releases, palette changes, pause, reset, and mobile interaction. Show a clear fallback message if WebGPU is unavailable.
Deliver the full working HTML, not a mockup or code fragment.
````
