# Velocity Loop

- **Source page:** https://motionpromptgallery.com/p/velocity-loop-openai/
- **Author/creator:** VB Srivastav (OpenAI) @OpenAIDevs
- **Model:** GPT-6 Astra
- **Tools/engine:** Codex · single-file web (HTML/WebGL)
- **Original post:** https://developers.openai.com/showcase/velocity-loop
- **Site tags:** official showcase, 3d, webgl
- **Aspect ratio:** 720/406
- **Provenance note (from the gallery):** Official OpenAI Developers showcase page labelled GPT-6 Astra; initial prompt copied verbatim from the page's build process (13 prompts total, follow-ups in the Code tab). Handle is OpenAI Developers' account, the page credits VB Srivastav. Post date not shown on the page. Media from cdn.openai.com.

## Prompt (verbatim as published)

````text
Generate a menu concept for a realistic, die-cast-style 3D racing game with loop-the-loop tracks and nitrous. Show five course choices, varying difficulty, three assist levels, and best-time records in a clear, readable layout.
````

## Code tab (verbatim as published)

````text
Follow-up prompts in the published build process:

— Explore the racing concept:
Generate an on-track concept for the same die-cast-style racing game. Show a blue car racing toward orange loop-the-loop track, with a readable lap timer and nitro indicator. Make the course, car, and racing direction clear.

— Build the first course menu:
Build the first running menu for the racing game. Let players choose among five courses, select an assist level, inspect their best times, and start a race. Keep the layout readable on desktop and mobile.

— Build the first playable racer:
Build a playable die-cast-style 3D racer with five continuous courses, including loop-the-loops and varying difficulty. Add nitrous, three assist levels, timers, medals, and personal-best ghosts. Support keyboard, touch, and gamepad controls, sound, camera switching, and mobile layouts. Play races across all five courses to check how they feel.

— Research, implement and playtest:
Review and playtest the racer, then improve grip, banking, loop contact, and landings. Keep the React, TypeScript, and Three.js architecture with deterministic simulation. Make recorded inputs and ghost playback consistent across frame rates, add adaptive graphics and WebGL recovery, and repeat complete races to evaluate the changes.

— Build a miniature workshop:
Develop miniature workshop environments with warmer lighting, detailed cars, licensed scenery, and generated surface materials. Refine suspension, tire contact, jumps, rivals, and the camera so the vehicles feel grounded. Playtest steering and visibility through loops.

— Generate the workshop materials:
Generate a nine-region material atlas for a miniature 3D workshop, including plaster, oak, painted timber, brass, limestone, leather, and terracotta. Make each region useful as a surface texture on modeled geometry, with consistent scale and lighting. Do not paint the whole workshop as a backdrop.

— Add reasons to replay:
Add a multi-race Workshop Series and a five-course Grand Tour. Tie rewards and clear feedback to controlled drifting, clean recovery, timed boosts, braking, and racing personal-best ghosts. Improve the mobile HUD and retry flow while preserving earned records and older ghosts.

— Add a four-car garage:
Add Atelier GT, Comet Sprint, Apex Needle, and Titan RS, each with different speed, acceleration, grip, braking, and nitro. Keep the home flow focused on choosing a car, choosing a track, and racing. Balance the cars across tracks and assist levels.

— Unify the cars and add shared competition:
Keep each car’s garage model, portrait, and on-track model consistent. Add sign-in and persistent shared rankings, with server-side replay verification that checks submitted times against race inputs. Show standings from the home screen and after a race.

— Refine the camera, nitro and track flow:
Make the chase camera comfortable through loops, jumps, and landings. Refine nitro duration and recharge, improve jump approaches and landing visibility, and lengthen Ignition, Neon, and Skyline. Check responsive gamepad input and mobile multitouch across every car and track.

— Finish the gameplay and interface:
Play through the complete racing flow and refine Next, Retry, car switching, finish clocks, and medal targets. Make account recovery, rankings, model loading, camera transitions, and imported-record eligibility reliable. Preserve older replays and earned records, and keep the racing interface clear.

— Check the final mobile controls:
Check the completed home screen on a narrow phone viewport. Keep car and track choices, leaderboard access, Settings, and Race visible and easy to use. Verify touch controls and preserve the desktop layout.
````
