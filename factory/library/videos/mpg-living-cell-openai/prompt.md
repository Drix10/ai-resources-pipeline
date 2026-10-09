# Living Cell

- **Source page:** https://motionpromptgallery.com/p/living-cell-openai/
- **Author/creator:** VB Srivastav (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/living-cell-cross-section
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 960/600
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (2 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits VB Srivastav. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Build this interactive 3D experience as a single self-contained index.html that works offline. Keep the HTML, CSS, JavaScript, procedural geometry, textures, and shaders inline, with no external dependencies or downloaded assets. Use browser-native WebGL with a graceful fallback if unavailable. Support desktop and mobile, keyboard-accessible controls, pause/resume, and reduced motion. Keep animation smooth and rendering performance bounded.

Build a luminous interactive cross-section of a living eukaryotic cell at molecular scale. Show an unmistakable phospholipid bilayer as two dense instanced layers with hydrophilic heads and paired hydrophobic tails. Animate membrane channels opening, receptor binding, and a selective concentration gradient of moving ions. Inside the cytoplasm, construct procedural microtubules carrying kinesin-like walking motor proteins and glowing cargo vesicles; include a cutaway mitochondrion with folded cristae and visible rotary ATP-synthase-inspired structures. Add Brownian-motion particles, ribosome-like clusters, actin fibers, and soft depth-aware fluorescence using restrained cyan, ultraviolet, and coral. Distinguish inside from outside with coherent scale and lighting. Provide orbit/zoom, a clipping or exploded-view slider, transport-speed control, pause/resume, and pointer inspection that identifies the nearest major structure. Favor readable biological mechanisms over an arbitrary cloud of spheres.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Refine the compact layout:
Refine the responsive layout so the cell remains easy to inspect on small screens, including compact landscape views. Keep structure labels and simulation controls readable and accessible without covering the main scene. Preserve the desktop design and all existing interactions.
````
