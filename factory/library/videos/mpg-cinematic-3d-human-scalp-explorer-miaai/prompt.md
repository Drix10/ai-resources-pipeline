# Cinematic 3D human scalp explorer

- **Source page:** https://motionpromptgallery.com/p/cinematic-3d-human-scalp-explorer-miaai-lab/
- **Author/creator:** Mia @MiaAI_lab
- **Model:** Kimi K3
- **Tools/engine:** React + Three.js + React Three Fiber + GSAP
- **Original post:** https://x.com/MiaAI_lab/status/2078508824752017757
- **Posted:** 2026-07-18
- **Site tags:** motion, 3d, threejs, gsap, one-shot
- **Aspect ratio:** 1280/720
- **Provenance note (from the gallery):** Prompt verbatim from the creator's own reply under the X post ("Full prompt below"). Live build: https://mia-ai.net/tests/human-scalp/scalp/. Preview clip and poster from the creator's own video in the X post (re-encoded excerpt).

## Prompt (verbatim as published)

````text
Create an award-quality, production-ready web application that showcases an **ultra-realistic 3D human scalp** with the visual fidelity of a medical visualization mixed with a cinematic product reveal.

The goal is to make the user immediately think **"this is the most realistic scalp I've ever seen in a browser."**

## Overall Style

- Premium Apple / Unreal Engine / Pixar-level presentation
- Dark cinematic environment
- Soft volumetric lighting
- Physically Based Rendering (PBR)
- Realistic skin subsurface scattering
- Micro skin pores
- Fine peach fuzz
- Individual hair strands emerging from follicles
- Slight oil sheen
- Tiny imperfections
- High-resolution textures (4K–8K)
- Filmic color grading
- Depth of field
- Ambient occlusion
- Contact shadows
- HDR environment lighting

Everything should feel like a luxury medical visualization rather than a game.

## Technology

Use:

- React
- Three.js
- React Three Fiber
- Drei
- GSAP for animations
- Postprocessing effects
- TypeScript

The experience should run smoothly in modern browsers.

## 3D Model

The centerpiece is an anatomically accurate scalp.

Include:

- epidermis
- dermis
- hypodermis
- realistic follicles
- sebaceous glands
- blood vessels
- hair shafts
- arrector pili muscles
- connective tissue

The model should have enough detail that users can zoom in extremely close.

## Hair

Render hair using thousands of strands.

Requirements:

- Individual strand rendering
- Random variation
- Different thicknesses
- Natural clumping
- Soft movement
- Realistic root placement
- Correct emergence angles
- Slight color variation

Hair should look like premium CGI.

## Camera Experience

When the page loads:

- Slow cinematic fly-in
- The camera rotates around the scalp
- Then gently stops
- Mouse movement subtly affects camera angle
- Scrolling should smoothly zoom into the scalp
- No abrupt movement
- Everything should feel luxurious

## Interaction

- Users can rotate the scalp
- Zoom deeply
- Pan
- Double-click to focus
- Smooth inertia
- No jerky controls

## Information Hotspots

Place elegant glowing hotspots throughout the scalp.

Examples:

- Hair follicle
- Sebaceous gland
- Hair shaft
- Epidermis
- Dermis
- Blood vessels
- Melanocytes
- Bulge stem cells
- Arrector pili muscle
- Sweat gland

When clicked:

- camera animates smoothly to the location
- surrounding anatomy subtly highlights
- non-selected areas slightly fade
- a premium floating info panel appears

The info panel contains:

- title
- concise explanation
- optional illustration
- close button

Panels should animate elegantly.

## Cross Section Mode

Include a button: **"Explore Layers"**

Animation:

- The scalp slowly slices open
- Users can inspect epidermis, dermis, hypodermis, follicles, and glands
- Layers should separate smoothly
- Users can toggle back

## Exploded View

Add another button.

Animation:

- Every anatomical component floats apart slightly while maintaining relationships
- This should look like a luxury medical exhibit

## Shader Quality

Implement realistic shaders including:

- Subsurface scattering
- Micro-normal maps
- Curvature
- Ambient occlusion
- Fresnel
- Screen-space reflections
- Soft translucency
- Specular oil highlights
- Fine roughness variation

## Lighting

Use cinematic lighting:

- HDRI environment
- Large soft key light
- Cool rim light
- Warm fill light
- Gentle volumetric fog
- No harsh lighting

## User Interface

- Minimal
- Modern
- Dark
- Glassmorphism
- Thin typography
- Floating controls
- Apple Vision Pro aesthetic

Nothing should distract from the model.

## Animations

Everything should animate smoothly.

Use easing similar to Apple product pages.

Animate:

- Camera
- Hotspots
- Info panels
- Buttons
- Cross-section
- Exploded views
- Hover states
- Lighting transitions

No abrupt changes.

## Performance

Implement:

- LOD
- Instancing
- Compressed textures
- Lazy loading
- Adaptive quality
- 60 FPS target

## Educational Experience

Each anatomical structure should include:

- Name
- Function
- Interesting fact
- Clinical relevance
- Beautiful illustrations if available

## Polish

Include subtle:

- Floating dust particles
- Tiny lens bloom
- Soft vignette
- Motion blur during camera movement
- Filmic tonemapping
- Color grading
- High-end reflections
- Micro animations
- Premium transitions

Everything should feel like an expensive museum exhibit.

## Final Goal

The finished application should resemble a fusion of:

- Unreal Engine 5 MetaHuman rendering
- Apple product presentations
- BioDigital Human
- Visible Body
- Medical museum installations
- Pixar-quality lighting
- High-end scientific visualization

It should feel cinematic, educational, interactive, and visually stunning, with every interaction reinforcing realism and craftsmanship. The code should be modular, well-structured, fully commented, and easy to extend with additional anatomical layers or educational content in the future.
````

## Code tab (verbatim as published)

````text
Live: https://mia-ai.net/tests/human-scalp/scalp/
````
