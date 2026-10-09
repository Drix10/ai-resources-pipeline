# Hollowflux

- **Source page:** https://motionpromptgallery.com/p/hollowflux-openai/
- **Author/creator:** Thomas Ricouard (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/hollowflux
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 960/540
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (18 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits Thomas Ricouard. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Generate five concept images for a top-down pixel dungeon crawler with real-time combat and a procedural fluid engine. Keep characters, equipment, and monsters simple and readable. Explore distinct environments with reactive water, blood particles, metal sparks, and responsive lighting. Aim for the atmosphere of Animal Well and the systemic variety of Caves of Qud, without ASCII.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Build a playable encounter:
Build a short, polished combat encounter from the attached Tideglass Caverns concept. Draw the graphics in code and make the character controllable, with enemies to fight. Put dynamic fluid at the center of the encounter, and make the lighting and combat effects match the selected visual direction.

— Tune movement and attacks:
Play through the first combat encounter and identify where movement or attacks feel awkward. Improve the character's movement and attack animations so actions feel responsive and are easy to follow. Test the encounter again while preserving the existing fluid interactions.

— Add experience points:
Add experience points to the playable prototype. Award experience for defeating enemies, track the total, and show progress clearly in the interface. Play through an encounter to check that rewards are recorded correctly.

— Refine the cape and facing:
Give the adventurer a clearly readable red cape. Adjust the character's facing and cape layering for each movement direction, especially when facing upward, so the cape sits correctly behind the character. Check the result while moving and attacking.

— Connect water and electricity:
Make electrical attacks propagate through connected water and damage creatures in the charged area. Keep stone surfaces safe from water-borne electricity. Make the charged water readable, then test the same attack with the player standing in water and on stone.

— Make currents move objects:
Let water currents move physical loot and environmental debris. Make the objects respond to the existing fluid simulation while remaining easy to identify and collect. Test drops in flowing water and on dry ground without changing the electricity and safe-stone rules.

— Build distinct floor themes:
Expand the playable dungeon into seven distinct floor themes. Give each theme its own environment and atmosphere while preserving the established movement, combat, and fluid rules. Connect the floors into a descent that the player can progress through.

— Add inventory and equipment:
Add an inventory and equipment system for the loot found in the dungeon. Let players inspect, store, and equip items, and show how equipped gear affects character stats. Check that collecting and changing gear works during a run.

— Add boss encounters:
Add boss encounters to the dungeon descent. Build on the existing combat and fluid rules, with readable attacks and opportunities to respond. Playtest each encounter to make sure it works with the player's equipment and progression.

— Build the sanctuary:
Add a sanctuary to the dungeon descent with trading, upgrades, and pacts. Make the available choices and their effects clear, and connect them to the player's inventory and progression. Preserve the existing dungeon and fluid interactions when returning to play.

— Keep the action readable:
Review gameplay in areas with bright water, darkness, and overlapping effects. Improve the contrast and silhouettes of the player and enemies so their movement and attacks remain easy to follow. Keep the cavern atmosphere and fluid effects intact.

— Simplify the interface:
Simplify the gameplay and inventory interfaces. Prioritize the information players need to understand their character, equipment, and current choices. Reduce visual clutter and clarify spacing and labels without removing existing actions or stats.

— Rebalance progression:
Play through the dungeon descent and review how experience, equipment, and upgrades affect difficulty. Identify uneven progression and adjust the relevant values. Retest those sections so rewards feel useful and the challenge develops steadily.

— Refine the ambient sound:
Refine the ambient sound across the dungeon themes. Keep the cavern atmosphere while balancing ambience against combat and interaction sounds. Listen during quiet exploration and busy fights, and adjust anything that distracts from important gameplay cues.

— Give weapons distinct attacks:
Expand combat to six weapon families with distinct attacks and physical effects. Differentiate how their reach, timing, and movement feel while keeping attacks readable. Test each family against the same encounter to check that the differences are useful in play.

— Make weapon drops easy to compare:
Make dropped weapons visible as physical objects in the dungeon. Before pickup, compare their damage, reach, attack speed, and movement against the equipped weapon. Keep the comparison readable and verify that collecting and equipping the drop updates the inventory correctly.

— Connect attacks to the water:
Connect each weapon family's attacks to the fluid simulation. Add persistent wakes, eddies, foam, and disturbances that match the attack's motion and physical effect. Test the weapons near water and keep the resulting effects from obscuring characters or loot.
````
