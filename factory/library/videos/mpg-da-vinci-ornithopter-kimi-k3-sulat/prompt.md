# Da Vinci's ornithopter: working mechanism in a living manuscript

- **Source page:** https://motionpromptgallery.com/p/da-vinci-ornithopter-kimi-k3-sulat/
- **Author/creator:** Sulat sulat.com
- **Model:** Kimi K3
- **Tools/engine:** Interactive 3D, static page
- **Original post:** https://da-vinci-ornithopter.k3.demos.sulat.com/
- **Site tags:** motion, 3d, mechanism, explainer, one-shot
- **Aspect ratio:** 1200/630
- **Provenance note (from the gallery):** From Sulat's one-shot demo catalogue (k3.demos.sulat.com). The demo page describes itself as "a one-shot AI demo made with Kimi K3 by Moonshot AI". The prompt is the demo's published PROMPT.md, verbatim. The poster is the catalogue's own thumbnail. Sulat publishes no dates or videos for its demos, so postedAt is empty and there is no clip.

## Prompt (verbatim as published)

````text
Create an interactive 3D experience around Leonardo da Vinci's ornithopter: the flying machine rendered as a working mechanism — wooden lattice frame, canvas wings with visible ribbing, the pilot's prone cradle, pedals, pulleys, and cables that genuinely drive the wing beat. Present it as a living Renaissance manuscript come to life: da Vinci's sketchbook pages, mirrored-handwriting annotations, ink cross-sections, and exploded-view diagrams surround the machine, drawn in sepia ink on aged parchment.

The visitor can orbit the machine freely; run the wing mechanism at variable speed and watch the linkage, cables, and canvas flex in a mechanically honest way; trigger an exploded assembly view where every part floats apart with leader lines and labels, then reassembles piece by piece; page through annotated chapters (wings, drivetrain, pilot controls, materials); and watch a dreamlike flight demo carrying the machine over a sketched Tuscan landscape of hills, cypress trees, and a distant dome.

Controls are mouse-and-keyboard first: mouse drag orbits the machine, and paired WASD and arrow-key bindings orbit or move in the active camera frame by default — A and ArrowLeft orbit or move left, D and ArrowRight orbit or move right, W and ArrowUp move the view forward or up, and S and ArrowDown move it back or down, always relative to the camera's current orientation and staying correct after any rotation or chapter change. Chapter navigation, the exploded view, mechanism speed, and every visible control work with an ordinary mouse.

Delivery condition: the final artifact must expose a production-state browser probe, window.__ONESHOT_DIRECTIONAL_CONTROL_PROBE__ with reset() and sample(), that resets one deterministic, ready-to-control camera state and reports the real camera position, forward vector, and active-frame right basis so an external browser-level check can send A, ArrowLeft, D, and ArrowRight independently and reject missing, zero, or inverted responses. The probe must read the same production camera state and input listeners that visitors use — not a parallel test rig or a hard-coded answer.

Do not take shortcuts or settle for a static model spinning on a pedestal. This skill imposes no token budget limit, so pursue the full depth — mechanical fidelity of the wing beat, manuscript atmosphere, exploded-view clarity, the flight sequence, responsive states, and the small ink-and-paper details — and keep refining until it feels like a museum exhibit that escaped into a sketchbook.
````

## Code tab (verbatim as published)

````text
Prompt file: https://da-vinci-ornithopter.k3.demos.sulat.com/PROMPT.md
````
