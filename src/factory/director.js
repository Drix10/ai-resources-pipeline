/**
 * The director: turns one story into a gallery-grade prompt before any code is written.
 *
 * Why: the best films in the reference library were not made from a vague brief. Their prompts
 * are director's scripts: one concept, a strict palette in hex, a type system with roles, the
 * message locked word for word, a timed narrative arc on a beat grid, named techniques that
 * are required (mask wipes cut from the outgoing letterforms, print misregistration, sub-frame
 * motion blur...), banned moves and gotchas. Handing the agent "invent a look" got generic
 * kinetic type every time.
 *
 * Two Opus calls, before the agent starts:
 *  1. selectReferences(): reads the WHOLE catalog (413 one-liners) and picks the 6 films whose
 *     craft can serve THIS story, each with the exact technique to take from it.
 *  2. writeDirectorPrompt(): reads those 6 prompts in full and remixes them into one new
 *     director's prompt for this story: their techniques, a concept from the subject itself,
 *     the fixed wording locked in. The agent then builds from that prompt.
 */
const config = require("../../config");
const { logger } = require("../utils/helpers");
const library = require("./library");
const opus = require("./opus");
const { stripTags } = require("./voice");

const PICKS = 6;
const REF_CHARS = 9000;

/**
 * The quality bar for every reel and carousel. P(doom) (repos/pdoom-video, docs/TREATMENT.md) and
 * Tessel (repos/claude-launchvideo) show the LEVEL we hold to, not a template: each piece picks
 * its own form, and the look memory makes consecutive pieces pick different ones. What made our
 * first films generic is what this forbids: text appearing on a dark field, a code card, a list.
 */
const CRAFT_BAR = `THE BAR (the level every piece is held to; P(doom) and Tessel in our library show it, but they are the standard, NOT a template: do not reuse their plates, spark, red dot, palettes or structure)
1. A DESIGNED WORLD, NOT SLIDES. The piece is a world with its own rules, materials and light, built for THIS subject. Pick the FORM that suits the story and differs from the recent pieces, for example: one continuous take where a single element morphs through every state; a machine that physically runs the mechanism; a single impossible camera move through one scene; a series of plates, each in its own idiom; an object that keeps transforming; a document, map or chart that writes itself; a product-film launch; an instrument read live (scope, gauge, ledger); typography as the whole image, done at poster level; a 3D set with real light. Never the same form twice in a row.
2. A THROUGH-LINE. Something carries the eye across every cut: a relay object, one continuous shape, the camera, a line that keeps drawing, a material that changes state. Cuts are hand-offs, not wipes between unrelated frames.
3. THE IMAGE DOES THE EXPLAINING. Each beat turns the idea into something concrete that acts (a visual pun, a transformation, a mechanism you can watch work), never a literal illustration and never boxes with labels beside them.
4. WORDS ARE PART OF THE IMAGE. Copy is written, stamped, typed, etched, printed, carried or revealed BY the world, integrated differently as the piece moves on, never subtitles floating over a background.
5. NUMBERS AND CODE LIVE IN THE WORLD. A number is staged in the world's own idiom (a needle, a counter on a machine, a field on a form, a label on a curve), never a big centred stat. Code is an object or a lit line inside a real screen, never a flat code block on a card.
6. DEPTH AND LIGHT. Layers, parallax, real 3D where it earns it (three.js / @remotion/three), shadows, hairlines, texture or grain, glow only where one signal colour earns it. Type stays crisp.
7. ALWAYS MOVING, LANDING ON THE BEAT. Reframes and camera moves inside every section; strong eases (outExpo, inOutCubic, springs), holds, then snaps on the downbeat. No floaty drift, no dead frames.
8. A POINT OF VIEW. Wit for engineers where the subject allows (deadpan footnotes, stamps, annotations), confidence everywhere. No mascots, no emoji, no cute.
9. CRAFT DETAILS. Kerned display type, real typographic punctuation, grid discipline, asymmetric compositions, generous negative space, a type system with roles (display / machine voice / a rare third register).
GENERIC (reject on sight): text fading in on a dark or gradient background; a code block on a rounded card; a bulleted list; a centred number counting up; a diagram of boxes and arrows; a "glowing" anything; the same layout repeated with new words; a copy of a reference.`;

/**
 * The bar for a narrated reel. The first live reel met CRAFT_BAR and still failed with its owner:
 * no real images, type racing over a designed world, no voice, "looks generated". A reel is a
 * story told over REAL footage and captures, led by the voice, with motion graphics as the layer
 * on top. Hook/hold/pay-off rules adapted from Ootto's claude-content-skills (MIT): going-viral,
 * reel-builder, b-roll-shot-list, on-screen-text-writer.
 */
const REEL_BAR = `THE BAR FOR A REEL (a narrated short a person would send to a friend; it must feel cut by a sharp human editor, never generated)
1. REAL THINGS ON SCREEN. Nearly every second shows real material: the source post, its photos, the captured pages, stock footage of the world the story lives in (people, places, machines, screens), the library clips. Motion graphics are the layer ON TOP: a highlighter sweeping the line that matters, a circle or arrow on the real number, a zoom into a region of a page, a counter riding over footage, a split screen of two real things. A scene of type on an empty background is a failure; a pure graphic only where the storyboard says "graphic".
2. FRAME 0 IS THE HOOK. The first frame already shows the most striking real image, moving (a push-in, a pan, footage in motion) and filling at least 40% of the frame; the hook headline lands at about 1.2-1.6 s, with the voice. No fade from black, no logo, no title card.
3. THE VOICE LEADS. Cut and act on the spoken word (voice.json has every word's time): the picture turns when the voice turns, a highlight hits its exact word, the cut lands about 10 frames before the word it serves. Each beat is ONE forward action, start to finish; nothing ping-pongs.
4. FLOW. One continuous thought, not a deck of slides: hard cuts on the beat between real shots, match cuts that carry a shape or position across, push-ins and whip pans that continue through a cut, the next shot arriving with its line. One recurring device ties the shots together (a highlighter colour, a frame, the source post returning, a cursor).
5. NOTHING STATIC, NOTHING RUSHED. Every still moves (a slow push-in or pan, 4-10% over its shot); footage plays at real speed, trimmed to its best seconds; shots hold 1.5-3.5 s (the hook may cut faster). A headline stays up long enough to read twice: about 0.4 s per word, never under 1.5 s.
6. TEXT IS A HEADLINE, NOT A TRANSCRIPT. One short line per beat (at most 6 words), one punched word in the accent colour, set big (headlines >= 72 px) and readable on any footage (a dark stroke, a shadow, or a solid plate). Never two headlines at once. The spoken words also appear as captions (see CAPTIONS): keep their band clear.
7. ESCALATE TO THE PAYOFF. Each beat out-does the last; the promised payoff lands in the scene before the CTA (on the music's drop when it fits); then one clear CTA with its reason; the last frame flows back into the first.
8. HONEST. Show the real post, the real pages, only the article's numbers. Never fake a UI, a post, a chart with invented values or a person's words. Stock shows the world of the story and never pretends to be a company's own footage.
GENERIC (reject on sight): text fading in over a dark gradient; a scene that is only type; a centred number counting up on an empty field; boxes-and-arrows diagrams; a glowing anything; the same layout repeated with new words; stock that does not cover its line; robots, brains, circuit boards, purple-blue neon, glassmorphism.`;

const FORMATS = {
  reel: { name: "Instagram Reel", size: "1080x1920 (9:16), 30 fps", safe: "headlines and anything to read inside x 90..930, y 250..1170; the band y 1190..1340 belongs to the captions; nothing that matters below y 1340 or right of x 930 (Instagram's caption, handle and buttons cover it)" },
  carousel: { name: "Instagram carousel", size: "1080x1350 (4:5) stills, one per slide", safe: "all type inside x 72..1008, y 96..1250" },
};

/** The fixed copy, in order, as the director must lock it. */
function copyLines(storyboard) {
  const list = storyboard.format === "carousel" ? storyboard.slides : storyboard.scenes;
  return list.map((s, i) => {
    // The voiceover is spoken, not shown: it reaches the agent through voice.json, never as on-screen copy.
    const { type, beats, src, host, voiceover, visual, ...rest } = s;
    return `${i + 1}. [${type}${beats ? `, ~${beats} beats` : ""}] ${JSON.stringify(rest)}`;
  }).join("\n");
}

/** The storyboard's plan for the picture: what each scene shows, from which material, under which spoken line. */
function shotPlan(storyboard, assets = []) {
  const ids = new Set(assets.map((a) => a.id));
  return (storyboard.scenes || []).map((s, i) => {
    const v = (s && s.visual) || {};
    const use = String(v.use || "").trim();
    const stock = assets.find((a) => a.id === `stock-${i + 1}`);
    const material = ids.has(use) ? use
      : stock ? `${stock.id} (${stock.kind === "stock-video" ? `${stock.seconds || "?"} s video` : "photo"}, ${stock.width}x${stock.height}, found for "${stock.query}")`
        : /^(stock|photo)\s*:/i.test(use) ? `nothing was found for "${use.replace(/^(stock|photo)\s*:\s*/i, "")}": use a library clip, a capture or a graphic`
          : use || "graphic";
    return `${i + 1}. SHOWS: ${v.show || "-"} | MATERIAL: ${material}${s && s.voiceover ? ` | SAYS: "${stripTags(s.voiceover)}"` : ""}`;
  }).join("\n");
}

/** Every literal the viewer must read (not the voiceover): the director's prompt must carry each one. */
function lockedStrings(storyboard) {
  const out = [];
  const add = (v) => { if (typeof v === "number" && Number.isFinite(v)) v = String(v); if (typeof v === "string" && v.trim()) out.push(v.trim()); };
  const list = storyboard.format === "carousel" ? storyboard.slides : storyboard.scenes;
  for (const s of list || []) {
    if (!s || typeof s !== "object") continue;
    for (const k of ["text", "headline", "title", "label", "body", "sub", "caption", "kicker", "value"]) add(s[k]);
    for (const it of Array.isArray(s.items) ? s.items : []) add(it);
    for (const side of ["left", "right"]) if (s[side] && typeof s[side] === "object") for (const k of ["label", "value", "note"]) add(s[side][k]);
  }
  return out;
}

/** Compares copy the way a reader would: quotes, dashes, ellipses, case, escapes and spacing do not matter. */
const canon = (t) => String(t || "").replace(/\\"/g, '"').replace(/[‘’‚′]/g, "'").replace(/[“”„″]/g, '"').replace(/[—–‒−]/g, "-").replace(/…/g, "...").replace(/ /g, " ").replace(/\s+/g, " ").trim().toLowerCase();

/** How long the film runs: the storyboard's beats, or longer when the recorded voice needs it. */
function filmSeconds(storyboard, voice = null) {
  const beats = Math.round(((storyboard.scenes || []).reduce((a, s) => a + (Number(s?.beats) || 0), 0) * 60) / (Number(storyboard.bpm) || 120));
  return Math.max(beats, voice ? Math.ceil(voice.seconds + 1.2) : 0);
}

// The standard we hold to: read for the level of craft, never a reference to take techniques from.
const GOLD = new Set(["pdoom-music-video", "tessel-launch"]);

/** Opus reads the whole catalog and picks the films whose craft fits this story. */
async function selectReferences(story, format, { avoid = "" } = {}) {
  const all = library.videos();
  const bySlug = new Map(all.map((v) => [v.slug, v]));
  // A reel borrows overlay and transition craft only: fewer motion films keep the picture real.
  const picks = format === "reel" ? 4 : PICKS;
  const fallback = () => library.heroReferences(story, picks + GOLD.size).filter((v) => !GOLD.has(v.slug)).slice(0, picks).map((v) => ({ ...v, steal: v.why || "" }));
  try {
    const reply = await opus.ask({
      system: "You are a motion design director with encyclopedic taste. You pick reference films for a new piece by craft, not by topic.",
      prompt: `NEW PIECE: one ${FORMATS[format].name} for engineers about the story below.

STORY: ${story.title}
${String(story.baseText ?? story.text).slice(0, 2500)}

RECENT PIECES ON THE CHANNEL (pick references that lead somewhere else):
${avoid || "- none yet"}

CATALOG (every film in our library; slug | title [model, engine] (frames/video/code): its reusable idea):
${library.catalog({ compact: true })}

${format === "reel"
  ? `This reel is cut from REAL footage, photos and page captures under a voiceover; the library's films lend it craft for the layer on top. Pick the ${picks} films whose technique can be laid over real material: a way to highlight or annotate a screenshot, a zoom or camera move into a page, a transition between shots, a headline treatment that reads over footage, a way to stage a number on top of an image, a pacing device. Prefer pieces with full prompts and frames or code. Make them different from each other.`
  : `Pick the ${picks} films whose CRAFT can make this piece extraordinary: a motif or relay object, a transition, a type system, a camera move, a way of explaining a system, a pacing device. Match the craft to what this story needs to SHOW, not the topic. Prefer pieces with full prompts and frames or code. Make the six different from each other (not six kinetic-type pieces).`}

Return only JSON: {"picks": [{"slug": "<exact slug>", "steal": "<the exact technique to take, and how it serves this story, one sentence>"}]}`,
      maxTokens: 1500,
      temperature: 0.4,
    });
    const seen = new Set();
    const chosen = (opus.parseJson(reply).picks || [])
      .filter((p) => p && bySlug.has(p.slug) && !GOLD.has(p.slug) && !seen.has(p.slug) && seen.add(p.slug))
      .slice(0, picks);
    if (chosen.length >= 3) {
      logger.info(`Factory director: references ${chosen.map((p) => p.slug).join(", ")}.`);
      return chosen.map((p) => ({ ...bySlug.get(p.slug), steal: String(p.steal || "") }));
    }
    logger.warn("Factory director: too few valid reference picks; using tag matching.");
  } catch (e) {
    logger.warn(`Factory director: reference pick failed (${e.message}); using tag matching.`);
  }
  return fallback();
}

const REQUIRED = ["CONCEPT", "FORM", "THROUGH-LINE", "PALETTE", "TYPE SYSTEM", "MESSAGE", "REQUIRED TECHNIQUES", "BANNED"];
const REQUIRED_REEL = ["CONCEPT", "THROUGH-LINE", "PALETTE", "TYPE SYSTEM", "MESSAGE", "SHOT LIST", "REQUIRED TECHNIQUES", "BANNED"];
/** A section heading as people write it: plain, numbered, "##", "**bold**" or "> quoted". */
const hasSection = (text, h) => new RegExp(`^[\\s#*>\\d.)(_-]*${h.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`, "mi").test(text);

/** The spoken timeline as the director and agent need it: scene windows and the film's minimum length. */
function voiceBlock(voice) {
  if (!voice) return "";
  const windows = voice.scenes.map((s) => `- scene ${s.scene}: ${s.start.toFixed(2)}-${s.end.toFixed(2)}s "${s.text}"`).join("\n");
  return `VOICEOVER (already recorded, ${voice.seconds.toFixed(2)} s${voice.approximate ? ", word timings estimated" : ""}; the film is timed to it, not the other way round)
${windows}
- The film runs at least ${(voice.seconds + 1.2).toFixed(1)} s. Each scene's visual turn lands on its spoken window; on-screen copy appears with or just after the words that carry it, never ahead of them. Leave the voice room: no busy motion behind the key words.`;
}

/** Opus remixes the references into one director's prompt for this story. Returns null on failure. */
async function writeDirectorPrompt({ story, storyboard, refs, assets = [], avoid = "", engine, voice = null, music = "" }) {
  const format = storyboard.format;
  const f = FORMATS[format];
  const refText = refs.map((r) => `### ${r.slug}: ${r.title}\nTAKE: ${r.steal}\n${String(r.prompt || "").slice(0, REF_CHARS)}`).join("\n\n");
  const material = assets.map((a) => `- ${a.id} (${a.kind}, ${a.width}x${a.height}${a.seconds ? `, ${a.seconds} s` : ""}) ${a.title ? `"${a.title.slice(0, 70)}" ` : ""}${a.page || a.url}`).join("\n");
  const reel = format === "reel";
  const shape = reel
    ? `SHOT LIST (scene by scene, timed to the voice windows: the material on screen and exactly how it is framed and moves (crop region, push-in or pan, which seconds of a clip), the overlay graphics on it, which locked line appears on which spoken word, and the cut into the next scene)
TRANSITIONS (every cut named: hard cut on the beat, match cut, whip, push-through; what carries over)
REQUIRED TECHNIQUES (numbered; each one concrete enough to implement on top of the real material, credited "(from <slug>)" when it comes from a reference; at least 5)
CHECKS (frames to look at before the full render, and what must be true in each: real material on screen, the headline readable over it, the captions band clear)`
    : `SLIDE SYSTEM (grid, margins, where type sits; how every slide belongs to the same designed world)
SWIPE CONTINUITY (how the slides read as one designed object when swiped: an element that crosses slide edges, a line that continues, a numbering system)
SLIDE BY SLIDE (for every slide: layout, what is drawn, which capture if any and how it is framed, the exact copy it carries)
REQUIRED TECHNIQUES (numbered; concrete, credited "(from <slug>)" and adapted; at least 5)
CHECKS (what must be true on every slide before it ships)`;
  const ask = (feedback) => opus.ask({
    system: `You write director's prompts for code-rendered motion pieces, in the exact craft register of the best prompts in our library: specific, numeric, opinionated, no filler. A prompt you write is handed to a world-class motion engineer (Claude Code with ${engine === "hyperframes" ? "HyperFrames: HTML + GSAP" : "Remotion: React"}) who builds it in code.`,
    prompt: `Write the director's prompt for ONE ${f.name} about the story below.

${reel ? REEL_BAR : CRAFT_BAR}

${reel
    ? "TECHNIQUES FROM THE LIBRARY: these references are motion pieces. Take ONLY what is named under TAKE (an overlay, a headline treatment, a transition, a camera move) and apply it to the REAL MATERIAL; the picture is never the reference's world. The result must meet THE BAR FOR A REEL and look like none of the recent pieces."
    : "REMIX, DON'T COPY: take the techniques named under TAKE from these references and combine them around ONE concept that comes from this story's own subject. The result must meet THE BAR, and look like none of the references and none of the recent pieces."}

${refText}

RECENT PIECES ON THE CHANNEL (the new piece must not reuse their form, concept, palette, type pairing or signature technique):
${avoid || "- none yet"}

THE STORY
${story.title}
${String(story.text).slice(0, 8000)}

LOCKED MESSAGE (the copy has passed our fact checks: carry it word for word, in this order; the type label only says what each line is, it is NOT a layout):
${copyLines(storyboard)}

REAL MATERIAL AVAILABLE (${reel ? "the source post, its photos, captures of the pages it links to, and the stock found for the scenes" : "screenshots of the pages the story links to; use what serves the story"}):
${material || "- none"}
${reel ? `\nTHE STORYBOARD'S SHOT PLAN (follow it; improve the framing, never swap real material for a graphic):\n${shotPlan(storyboard, assets)}\n` : ""}
${voice ? `\n${voiceBlock(voice)}\n` : ""}${format === "reel" && music ? `\nMUSIC LIBRARY (the only music this piece may use: pick ONE track whose mood, tempo and energy fit the story and the form; under a voiceover prefer an instrumental; never a track marked "used recently"; its biggest drop will be placed on your climax):\n${music}\n` : ""}
HARD CONSTRAINTS
- Format: ${f.size}; ${f.safe}. Readable with the sound off, on a phone, at a glance: your own type >= 34 px.
- ${format === "reel" ? `About ${filmSeconds(storyboard, voice)} seconds at ${storyboard.bpm} bpm; every frame a pure function of time; the last frame loops into the first.` : `${storyboard.slides.length} slides, rendered as stills, one per locked entry (none dropped); slide 1 is the cover that must stop the scroll.`}
- ${reel ? `Ends on the CTA over real material, flowing back into the first frame: no logo, no end card, no outro (${storyboard.handle} may appear small inside the CTA).` : `Ends on a follow lockup: ${storyboard.author}, ${storyboard.handle}.`}
- Fonts only from @fontsource (name the exact families). At most 4 colours plus neutrals, in hex.
- ${reel ? "The picture is the REAL MATERIAL above (and the VISUAL LIBRARY below for atmosphere and transitions); no other imagery." : "No stock imagery except our VISUAL LIBRARY below, as texture, transition or atmosphere."} No robots/brains/circuit boards, no purple-blue neon, no glassmorphism, no invented UI or fake dashboards, no emoji.
${format === "reel" ? library.visualsBlock(() => "library clip").replace(/ -> library clip/g, "") : ""}

WRITE THE PROMPT WITH THESE SECTIONS, in this order, as plain text with the section names in capitals:
CONCEPT (one sentence: ${reel ? "the story's visual idea, built around the real thing at its centre" : "the visual idea, drawn from the subject"})
${reel ? "" : "FORM (one line naming the form from THE BAR, or a new one, and why it suits this story; it must differ from the recent pieces' forms)\n"}THROUGH-LINE (${reel ? "the recurring device that ties the shots together, and how it changes" : "what carries the eye across every cut or slide, and how it changes"})
PALETTE (strict hex list with a role for each${reel ? "; for a reel: the overlay accent, the headline colours and the plate or stroke colour" : ""})
${format === "reel" && music ? "MUSIC (first line exactly `MUSIC: <track id>` from the MUSIC LIBRARY; then one line on why it fits and where its drop lands in your arc)\n" : ""}TYPE SYSTEM (each face, its role, weights, tracking)
MESSAGE (the locked copy, verbatim, in order)
${shape}
BANNED (what would make this generic, specific to this piece)
GOTCHAS (the traps in building it)
${feedback ? `\nYOUR PREVIOUS DRAFT WAS REJECTED: ${feedback}\n` : ""}
Return only the prompt.`,
    maxTokens: 12000,
    // Six full reference prompts in, a long brief out, at xhigh effort: well past the default limit.
    timeoutMs: Math.max(config.factory.anthropic.requestTimeoutMs, 25 * 60 * 1000),
    temperature: 0.8,
  });
  const locked = lockedStrings(storyboard);
  let feedback = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = String(await ask(feedback)).trim();
      const missingSections = (reel ? REQUIRED_REEL : REQUIRED).filter((h) => !hasSection(text, h));
      if (!missingSections.length && text.length > 1500) {
        // A brief that paraphrases some copy is still a good brief: the exact words are appended
        // as the authority (the agent also gets them as FIXED WORDING), instead of a 25-minute redo.
        const body = canon(text);
        const lost = locked.filter((l) => !body.includes(canon(l)));
        if (!lost.length) return text;
        logger.info(`Factory director: ${lost.length} locked line(s) paraphrased; appending the exact copy.`);
        return `${text}\n\nLOCKED MESSAGE (authoritative: wherever the prompt above words the copy differently, use exactly these words)\n${copyLines(storyboard)}`;
      }
      feedback = [missingSections.length && `missing sections: ${missingSections.join(", ")}`, text.length <= 1500 && "too short to direct a piece"].filter(Boolean).join("; ");
      logger.warn(`Factory director: draft ${attempt} rejected (${feedback}).`);
    } catch (e) {
      logger.warn(`Factory director: prompt failed (${e.message}).`);
      return null;
    }
  }
  return null;
}

module.exports = { selectReferences, writeDirectorPrompt, copyLines, shotPlan, lockedStrings, voiceBlock, filmSeconds, hasSection, canon, FORMATS, CRAFT_BAR, REEL_BAR, GOLD };
