# Little Ritual

- **Source page:** https://motionpromptgallery.com/p/little-ritual-openai/
- **Author/creator:** Jeff Wang (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/little-ritual
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 720/406
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (8 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits Jeff Wang. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Build an original single-player 3D browser game about delivering coffee, set on a small, walkable spherical planet with a curved horizon. Give it a warm, stylized, cutesy look, mixing a compact town with quieter natural areas connected by paths around the globe. Include vertical exploration through stairs, upper floors, and bridges. Start the player in a café beside a coffee machine. Let them carry four visibly modeled coffees and explore to find neighbors, delivering to each once per round. Use a custom 3D interpretation of the Codex pet as the courier and other pets as neighbors. Keep discovery central, with interesting places to explore and small, playful interactions. Build the game modularly so we can change the world, characters, and mechanics easily. Use editable Blender assets, keep browser performance in mind, and begin with a playable version that we can improve through repeated feedback.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Give the courier a rounded, painted look:
Give the 3D courier a rounded, painted look with soft lighting and clear shapes. Add smiles, blinking, head movements, and small gestures in the game, while keeping the model easy to recognize at gameplay scale.

— Build editable assets in Blender:
Build editable assets in Blender with reproducible Python scripts, then export GLBs with named parts for animation in Three.js. Start with a detailed café espresso machine that fits the game’s rounded, painted style. Retain the editable scenes and verify the exports in the game.

— Expand the town and its quieter corners:
Expand the spherical world with shops, bridges, upper floors, woodland, fields, and rocky paths. Add distinctive destinations such as baths, a kiln, a treehouse archive, and a miniature cinema. Keep routes connected and give players reasons to explore beyond coffee deliveries.

— Add characters and encounters:
Add coffee-making animations, miniature films, musical objects, birds, a grumpy rain-cloud encounter, a disappearing gopher, and a tortoise family. Give inhabitants distinct voices and small interactions. Keep most encounters independent of delivery goals so exploration feels worthwhile on its own.

— Generate the studio mural:
Create an original square flat mural illustration to be applied directly as a texture on the back wall of Sunroom Studio in Little Ritual, a gentle single-player coffee-delivery exploration game. Illustration only, edge-to-edge, no mockup, no perspective, no photograph, no wall or frame rendered around it. Beautiful hand-painted gouache / contemporary folk-art mural with confident large shapes, visible subtle brush grain and carefully balanced negative space. A chubby little periwinkle-blue courier with a scalloped tuft, short rounded arms and legs and a dark navy face panel with two white eyes and a simple white smile carries a wooden tray holding four small takeaway coffee cups. The courier walks along a curling cream-colored path across a tiny rounded world: terracotta neighborhood rooftops, a sage-green café awning, large dusty-rose mushrooms, a weeping willow, warm gray mountain ridges and pale wildflower fields. An oversized cream coffee cup forms a visual centerpiece, its rising steam transforming into flowing cloud ribbons and a warm ochre sun. A tiny bird and a small snail provide a few playful details. Composition must read clearly from a distance, simple big silhouettes and a sense of shared morning life. Muted terracotta, golden ochre, sage, dusty pink, cream and blue, with a warm plaster-colored background. NOT photoreal, no glossy 3D rendering, no black outline cartoon, no busy tiny detail. The only text is a small beautifully hand-painted lowercase signature reading exactly "codex" at the bottom right. No slogans, no other text or lettering, no watermark. Deliver a finished high-quality square illustration suitable for an in-game mural texture.

— Refine movement and mobile controls:
Play through the coffee-delivery loop and exploration routes. Refine paths, signs, stairs, railings, collisions, camera behavior, onboarding, and completion feedback. Add a mobile joystick, pinch zoom, and multitouch controls, and check that movement and interaction remain comfortable on phones.

— Optimize the game and render a trailer:
Optimize the game by reusing geometry and materials, batching scenery, limiting shadow-casting lights, and hiding distant detail. Add original music and sound effects, then render a 30-second cinematic trailer from the game assets. Keep the trailer distinct from a gameplay recording.
````
