# Tidegarden

- **Source page:** https://motionpromptgallery.com/p/tidegarden-openai/
- **Author/creator:** Eric Provencher (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/tidegarden
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 960/601
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (8 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits Eric Provencher. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Create a tiny tropical island in Oriel with a beach, grass, one palm, open ocean, and clouds. Generate a believable realtime 3D reference with a leaning palm, turquoise shallows, and warm afternoon light, then use it as the visual north star. Inspect the rendered scene as you improve it.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Give the palm and grass life:
Give the palm naturally fluttering leaves. Make the grass GPU-driven, lush, and rooted in the sand, without a sharp cutoff.

— Assemble an editable reef in Blender:
Assemble a varied reef in Blender. Keep the source editable, compose the banks carefully, and preserve the materials when exporting to the scene.

— Give the water depth and light:
Make the water distort the geometry underneath. Keep the reef readable and make the underwater light move naturally with the surface.

— Build tools to see the problems:
Build high-contrast captures of the water, foam, and interaction surfaces. Inspect overdraw, shader cost, and draw calls so we can see the problem clearly.

— Simplify the shoreline foam:
Follow the shoreline tutorial. Use simpler meshes and textures, keep the foam minimal but prominent, and add lighting and microfoam around the whole island.

— Make the wave cause the wash:
The crests should follow the water toward the horizon and break in different places. Make their arrival line up with the shore crash and retreat.

— Lower the cost and ship:
Improve loading and frame time without losing the water’s look. Lower the render resolution, use cheaper anti-aliasing, simplify distant water, and ship the improved demo.
````
