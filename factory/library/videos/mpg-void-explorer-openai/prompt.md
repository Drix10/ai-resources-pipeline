# Void Explorer

- **Source page:** https://motionpromptgallery.com/p/void-explorer-openai/
- **Author/creator:** Thomas Ricouard (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/void-explorer
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 960/600
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (8 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits Thomas Ricouard. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Generate concept art for a fully explorable procedural universe where every star and planet I can see is somewhere I can go. I should be able to accelerate toward them, fly from space into a planet's atmosphere, and see the ground below. Use simpler retro 3D with retro-futurist neon colors, strong contrast, and an evocative sense of deep space. Find a middle ground between too realistic and too simplistic. Show orbital flight, atmospheric descent, and high-speed flight with stars and dust rushing around the ship.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Build the first vertical slice:
Build the first playable vertical slice of this procedural universe using the attached concept art as visual references. Assemble a basic procedural ship and connect flight, boost, travel between systems, waypoints, distance readouts, and continuous descent toward planetary terrain. Playtest the complete journey.

— Make flight and navigation feel right:
Improve the flight feel and make travel between planets faster. Make navigation visual with star charts and direct targeting, while keeping destinations and distances consistent.

— Upgrade the rendering:
Upgrade the rendering to WebGPU with WebGL support. Preserve the procedural world and simulation, then improve lighting, planetary materials, bloom, and the transition from orbit to the surface.

— Refine the spacecraft concept:
Generate concept images to refine AURORA, the exploration spacecraft for Void Explorer. Explore its silhouette and generate several views of the same design. Keep the ivory and indigo hull, emerald canopy, twin cyan engines, and four separate angular wings with pink tip lights. Refine the concepts until the shape is clear enough to model in 3D.

— Build and integrate AURORA:
Build AURORA in Blender using the attached ship concepts. Treat the approved top view as the authority for the silhouette and proportions, with the front view as supporting reference. Preserve the four separate wings and open gaps, mirror the geometry, and integrate the finished spacecraft into Void Explorer.

— Make exploration physical:
Let me land on the generated terrain, deploy the landing gear, leave through the ramp, walk around the ship, and reboard. Keep takeoff and the return to flight continuous.

— Keep the world coherent:
Playtest the complete journey from orbit to the surface and back. Keep terrain loading smooth and resilient, and check that rivers, water depth, and atmosphere behave consistently throughout flight and exploration.
````
