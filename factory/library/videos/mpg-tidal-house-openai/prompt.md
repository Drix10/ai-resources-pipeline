# Tidal House

- **Source page:** https://motionpromptgallery.com/p/tidal-house-openai/
- **Author/creator:** Katia Gil Guzman (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/tidal-house
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 960/600
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (5 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits Katia Gil Guzman. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Build a complete, polished, interactive landing page. Use clear, natural copy and a restrained layout with purposeful controls. Keep native scrolling, support phone and desktop layouts, keyboard controls, and reduced motion. The main interaction should work without a runtime AI call or account.

Scenario: Tidal House is an imagined small coastal retreat with three cabins around a sheltered inlet. The visitor is choosing the kind of stay and view they prefer. Show cinematic environmental design and a clear hospitality experience.

Art direction: slate, pale sea-green, weathered timber and clean ivory. Wide photographs/rendered landscapes, a restrained editorial serif paired with very legible labels, generous breathing room and gentle scene depth. It should feel quiet and specific to a coast.

Page and signature interaction:
- Hero: “Cabins beside the water.” Show the inlet and three distinct cabins in one coherent landscape. “Explore the cabins” advances to the interactive scene.
- A pinned landscape/cutaway scene lets the visitor choose a cabin. Selecting it moves the camera closer, lifts or fades the roof to reveal its small floor plan, and shows the matching interior and window view. All views must describe the same architecture and orientation.
- A simple morning/evening control changes light and interior window illumination. A low/high-tide preview changes the shoreline and exposed path while preserving the site geometry. These are authored previews, not live tide forecasts. Do not publish a tide schedule or safety recommendation.
- Give each cabin a concrete difference, such as a covered deck, a bathtub facing the inlet, or a reading nook. Compare those differences in one useful, compact comparison instead of repeating three identical cards.
- Include a short photographic section about the rooms and shared spaces, with restrained parallax that preserves image readability.
- Finish with “Save a stay plan”: visitors choose a cabin and a few stay preferences and get a downloadable summary with the selected view. Use direct wording that does not imply an actual reservation or message was sent. Do not add payment or a fake availability calendar.

Build the landscape and cabin geometry with spatial consistency; high-quality still assets are suitable for rich interiors, paired with a real interactive exterior/cutaway. Keep camera transitions bounded and comfortable. On mobile preserve cabin selection and useful views without requiring a drag gesture to scroll. Verify every cabin, time/tide combination, and return to the overview. Let the setting and useful exploration carry the page.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Generate the cabin landscape:
Generate a wide editorial landscape of a quiet sheltered inlet with exactly three small weathered-timber cabins along the far bank. Give them charcoal pitched roofs and front windows facing the water and camera. The left cabin has a covered deck, the middle cabin shows a bathtub through its window, and the right cabin has a reading nook. Use a rocky shore, pale sea-green grasses, calm slate water, low distant hills, and soft morning light. Keep the cabins separate and readable, with no people, text, logos, boats, or extra buildings.

— Refine the hospitality copy:
Rewrite the copy in clear, natural language that explains the cabins and helps visitors choose a stay. Keep the existing interface, layout, and visuals unchanged.

— Clarify the content hierarchy:
Keep the presentation restrained, with a clear purpose for each section and useful headings. Remove redundant wording while preserving the existing interface, layout, and visuals.

— Give the hero a clearer title and tagline:
Give the hero one clear title and a short tagline that explain the coastal cabin retreat. Remove redundant captions and preserve the existing visuals and layout.
````
