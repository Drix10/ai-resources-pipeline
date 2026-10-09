# Abyssal

- **Source page:** https://motionpromptgallery.com/p/abyssal-openai/
- **Author/creator:** VB Srivastav (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/abyssal-bioluminescent-ecosystem
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 960/666
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (2 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits VB Srivastav. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Build this interactive 3D experience as a single self-contained index.html that works offline. Keep the HTML, CSS, JavaScript, procedural geometry, textures, and shaders inline, with no external dependencies or downloaded assets. Use browser-native WebGL with a graceful fallback if unavailable. Support desktop and mobile, keyboard-accessible controls, pause/resume, and reduced motion. Keep animation smooth and rendering performance bounded.

Render an original deep-ocean ecosystem surrounding a hydrothermal vent and towering procedurally grown coral or mineral formations. Establish strong depth with underwater fog, volumetric-looking light shafts, animated caustic approximations, marine-snow particles, and a dark abyss beyond the habitat. Populate the scene with multiple believable behaviors: a coherent boid-like school of tiny bioluminescent fish that steers around obstacles, translucent jellyfish with rhythmic bells and articulated trailing tentacles, swaying anemones or tube worms, and occasional larger luminous creatures. Give the hydrothermal vent rising turbulent particulate plumes and nearby organisms independent pulses rather than synchronized flashing. Cursor or touch disturbances should scatter and regather nearby fish; expose controls for current strength, bioluminescence intensity, and day/night or ambient depth. Include smooth orbit and a graceful slow cinematic idle camera. Procedurally generate all forms and textures; use cyan, violet, and occasional warm vent-orange against authentic inky water.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Refine the compact layout:
Refine the responsive layout so the underwater scene stays visible on small screens, including compact landscape views. Keep titles, labels, and environmental controls readable and separate, without crowding the habitat. Preserve the desktop composition, artwork, animation, and interactions.
````
