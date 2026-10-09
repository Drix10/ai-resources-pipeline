# "Enter the K": Kimi K3 launch site as a scroll-driven type film

- **Source page:** https://motionpromptgallery.com/p/kimi-k3-launch-site-enter-the-k-jumperz/
- **Author/creator:** JUMPERZ @jumperz
- **Model:** Kimi K3
- **Tools/engine:** Next.js + React + TypeScript + GSAP ScrollTrigger + Lenis
- **Original post:** https://x.com/jumperz/status/2077841331037094042
- **Posted:** 2026-07-16
- **Site tags:** motion, web, scroll, typography, one-shot, video
- **Aspect ratio:** 1280/720
- **Provenance note (from the gallery):** The creator says the site "was made from a single prompt" with Kimi K3. He posted the full prompt in a self-reply (https://x.com/jumperz/status/2077884505612750861), noting "this was one generation with no follow-ups". The prompt is copied verbatim from that reply. Preview clip and poster from the creator's own video in the X post (re-encoded excerpt).

## Prompt (verbatim as published)

````text
Build a complete, production-quality launch website for Kimi K3 using Next.js, React, TypeScript, GSAP ScrollTrigger, and restrained Lenis smooth scrolling.

REFERENCE:
andonorris official website

Study its cinematic scroll control and level of craft, but do not copy its layout, assets, branding, colors, copy, or exact animations.

CREATIVE DIRECTION

Create one continuous, scroll-controlled typographic film—not a conventional landing page with separate sections fading in.

Central concept: “ENTER THE K.”

The letter K is a portal. The user approaches it, enters it, travels through it, and exits it. Reuse the K as solid type, outline, mask, negative space, cropped geometry, grid, and navigation marker.

Every scene must transform from the geometry already on screen:

- Letters become masks and architecture
- Typography expands into backgrounds
- Lines become grids
- Numbers transform into new scenes
- Existing elements move, scale, crop, or align into the next composition
- Never reset the screen with a basic crossfade

The motion should feel heavy, controlled, cinematic, and directly connected to scrolling.

VISUAL SYSTEM

Colors:
- Ink: #090A0A
- Warm paper: #F1EFE8
- Gray: #B8B8B0
- Dark gray: #222422
- Signal: #D6FF3F

Keep at least 80% monochrome. Use the signal color rarely for active details and one major climax. Use hard, meaningful theme changes:

Dark → warm paper → dark → signal color → quiet dark.

Typography is the main visual material. Use a heavy wide grotesk such as Mona Sans Variable or Archivo Black, with Instrument Sans or Mona Sans for interface text.

Use extreme scale and intentional cropping:
- Hero type: 25–40vw
- Tight leading and tracking
- Asymmetrical editorial layouts
- Small uppercase technical labels
- Tabular numerals
- No generic centered headline/subtitle/button stacks

SCROLL STORYBOARD

Build approximately 900–1200vh of cinematic pinned scenes.

00 — LOADER

Show “KIMI / K3,” a calibration line, and “INITIALIZING 000%.” Rapidly reach 100%. Transform the loader line directly into the hero composition. Maximum 1.5 seconds.

01 — KIMI K3 HERO

Nearly black background with enormous KIMI typography, smaller K3, minimal navigation, metadata, progress rail, and “SCROLL TO ENTER.”

During scroll:
- Metadata enters through clipped reveals
- “IMI” moves beyond the viewport while K remains
- K scales to 8–12× the viewport
- Use K as a mask containing subtle monochrome motion
- Move through its negative space
- Its diagonal stroke becomes the next scene

Copy:
KIMI K3
A NEW SCALE OF INTELLIGENCE
MOONSHOTAI / KIMI-K3
AVAILABLE THROUGH OPENROUTER

02 — INSIDE THE K

Create an abstract editorial environment from diagonal planes, cropped letter fragments, measurement lines, coordinates, and subtle texture. Avoid a literal sci-fi tunnel.

Scrolling assembles:

THINK
ACROSS
THE ENTIRE
PROBLEM

Move planes at controlled depths. Transform the K’s diagonal into a horizontal line leading into the next scene.

03 — ONE MILLION CONTEXT

Invert to warm paper. Pin the scene while vertical scrolling drives horizontal movement.

Begin with a viewport-sized “1,” then spatially reveal:

1 → 1,0 → 1,048 → 1,048,576

Keep the number as the composition’s architecture. Move restrained document, code, and structured-data fragments beneath it.

Include:
LONG CONTEXT
CONNECTED REASONING
COMPLETE PROJECT AWARENESS
FEWER ARTIFICIAL BOUNDARIES

Enlarge the final “6” into a mask revealing the next dark scene.

04 — CAPABILITIES

Create three full-screen typographic transformations, not cards:

01 / REASON
FOLLOW THE PROBLEM BEYOND THE FIRST ANSWER.

02 / CODE
MOVE FROM INTENT TO WORKING SYSTEMS.

03 / BUILD
PLAN. EXECUTE. VERIFY. ITERATE.

Expand REASON’s font width. Align its strokes into code-like columns. Use those columns as CODE’s negative space, then collapse them into structural planes forming BUILD.

05 — K3 INDEX

Keep a huge K3 stationary on the left. On the right, vertically move precisely aligned specification rows:

MODEL — KIMI K3
MODEL ID — MOONSHOTAI/KIMI-K3
ACCESS — OPENROUTER
INTERFACE — CHAT COMPLETIONS
CONTEXT — 1,048,576
STATUS — AVAILABLE

As each row aligns with the K’s horizontal arm, turn it signal green. Compress all rows into one line at the end.

06 — CLIMAX

Use the signal color as the background—the only large color moment.

Display oversized black typography:

NOT A CHAT WINDOW.
A WORKING INTELLIGENCE.

Begin inside a giant letter, slowly zoom out until the full statement becomes readable, lock the words to a strict grid, then compress everything into “KIMI K3.”

07 — FINAL CTA

Shrink the signal-colored KIMI K3 mark into a small header and return to near-black.

Display:

KIMI K3
NOW AVAILABLE
Try the model through OpenRouter.

CTA: TRY KIMI K3
Technical line: moonshotai/kimi-k3

Use a sharp rectangular or underlined CTA. On hover, wipe the background horizontally and move the arrow 6–8px. End with a huge cropped K below the viewport.

MOTION AND ENGINEERING

- One GSAP timeline per major scene
- Restrained scrub values around 0.6–1.2
- No bounce, spring, overshoot, or excessive scroll lag
- Reuse geometry between scenes
- Prefer transforms, masks, and clip-path
- Keep text as real HTML
- Use WebGL only if genuinely necessary
- Wait for fonts before calculating timelines
- Clean up GSAP contexts
- Recalculate animations at responsive breakpoints
- Maintain sharp typography and smooth 60fps motion
- No scroll traps or scroll-jacking

Create a minimal fixed navigation:
K3 / 01 MODEL / 02 CAPABILITIES / 03 CONTEXT / 04 ACCESS / TRY K3 ↗

Update its color and progress state according to the active scene.

RESPONSIVE AND ACCESSIBILITY

Art-direct desktop, tablet, and mobile separately. On mobile, replace horizontal sequences with controlled vertical transformations while preserving the K-portal story.

Support 1440, 1280, 1024, 768, 430, 390, and 360px.

Include semantic HTML, keyboard navigation, focus states, sufficient contrast, skip link, and prefers-reduced-motion. Reduced-motion mode must remove pinning and zoom effects while keeping all content accessible.

STRICTLY AVOID

- Gradients and gradient text
- Glassmorphism
- Neon blobs or glowing orbs
- Bento grids and feature cards
- Rounded floating containers
- Fake terminals
- Random particles
- Stock illustrations
- Generic icons
- Constant fade-up animations
- Excessive blur
- Pill-shaped buttons
- SaaS-template layouts
- Decorative animation without narrative purpose
- Fake benchmarks, testimonials, or logos

The final result should feel like a digital fashion editorial, motorsport identity, experimental type specimen, and interactive title sequence—not an AI-generated SaaS homepage.

Build the complete functioning website. Prioritize strong static composition first, then add the connected scroll choreography. Test every transition, responsive breakpoint, navigation action, reduced-motion mode, and CTA. Fix all console errors and maintain smooth performance.
````
