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

const FORMATS = {
  reel: { name: "Instagram Reel", size: "1080x1920 (9:16), 30 fps", safe: "all type inside x 84..930, y 230..1520 (Instagram UI covers the rest)" },
  carousel: { name: "Instagram carousel", size: "1080x1350 (4:5) stills, one per slide", safe: "all type inside x 72..1008, y 96..1250" },
};

/** The fixed copy, in order, as the director must lock it. */
function copyLines(storyboard) {
  const list = storyboard.format === "carousel" ? storyboard.slides : storyboard.scenes;
  return list.map((s, i) => {
    // The voiceover is spoken, not shown: it reaches the agent through voice.json, never as on-screen copy.
    const { type, beats, src, host, voiceover, ...rest } = s;
    return `${i + 1}. [${type}${beats ? `, ~${beats} beats` : ""}] ${JSON.stringify(rest)}`;
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
  const fallback = () => library.heroReferences(story, PICKS + GOLD.size).filter((v) => !GOLD.has(v.slug)).slice(0, PICKS).map((v) => ({ ...v, steal: v.why || "" }));
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

Pick the ${PICKS} films whose CRAFT can make this piece extraordinary: a motif or relay object, a transition, a type system, a camera move, a way of explaining a system, a pacing device. Match the craft to what this story needs to SHOW, not the topic. Prefer pieces with full prompts and frames or code. Make the six different from each other (not six kinetic-type pieces).

Return only JSON: {"picks": [{"slug": "<exact slug>", "steal": "<the exact technique to take, and how it serves this story, one sentence>"}]}`,
      maxTokens: 1500,
      temperature: 0.4,
    });
    const seen = new Set();
    const picks = (opus.parseJson(reply).picks || [])
      .filter((p) => p && bySlug.has(p.slug) && !GOLD.has(p.slug) && !seen.has(p.slug) && seen.add(p.slug))
      .slice(0, PICKS);
    if (picks.length >= 3) {
      logger.info(`Factory director: references ${picks.map((p) => p.slug).join(", ")}.`);
      return picks.map((p) => ({ ...bySlug.get(p.slug), steal: String(p.steal || "") }));
    }
    logger.warn("Factory director: too few valid reference picks; using tag matching.");
  } catch (e) {
    logger.warn(`Factory director: reference pick failed (${e.message}); using tag matching.`);
  }
  return fallback();
}

const REQUIRED = ["CONCEPT", "FORM", "THROUGH-LINE", "PALETTE", "TYPE SYSTEM", "MESSAGE", "REQUIRED TECHNIQUES", "BANNED"];
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
  const material = assets.map((a) => `- ${a.id} (${a.kind}, ${a.width}x${a.height}) ${a.title ? `"${a.title.slice(0, 70)}" ` : ""}${a.url}`).join("\n");
  const shape = format === "reel"
    ? `SECTIONS (for each section of the form: what the image does, which locked lines it carries and HOW they are integrated into the image, the in-world staging of any number or code)
NARRATIVE ARC (timed sections on the bar grid of the track you chose under MUSIC (${storyboard.bpm} bpm if none), e.g. "0.0-2.0s COLD OPEN ..."; every beat of the message placed; what moves, what cuts, where the camera goes)
TRANSITIONS (every cut named and specified: what carries over, what masks what)
REAL MATERIAL PLAN (which capture appears where, framed how, what is pushed in on)
REQUIRED TECHNIQUES (numbered; each one concrete enough to implement, credited "(from <slug>)" and adapted to this story; at least 6)
CHECKS (frames to look at before the full render, and what must be true in each)`
    : `SLIDE SYSTEM (grid, margins, where type sits; how every slide belongs to the same designed world)
SWIPE CONTINUITY (how the slides read as one designed object when swiped: an element that crosses slide edges, a line that continues, a numbering system)
SLIDE BY SLIDE (for every slide: layout, what is drawn, which capture if any and how it is framed, the exact copy it carries)
REQUIRED TECHNIQUES (numbered; concrete, credited "(from <slug>)" and adapted; at least 5)
CHECKS (what must be true on every slide before it ships)`;
  const ask = (feedback) => opus.ask({
    system: `You write director's prompts for code-rendered motion pieces, in the exact craft register of the best prompts in our library: specific, numeric, opinionated, no filler. A prompt you write is handed to a world-class motion engineer (Claude Code with ${engine === "hyperframes" ? "HyperFrames: HTML + GSAP" : "Remotion: React"}) who builds it in code.`,
    prompt: `Write the director's prompt for ONE ${f.name} about the story below.

${CRAFT_BAR}

REMIX, DON'T COPY: take the techniques named under TAKE from these references and combine them around ONE concept that comes from this story's own subject. The result must meet THE BAR, and look like none of the references and none of the recent pieces.

${refText}

RECENT PIECES ON THE CHANNEL (the new piece must not reuse their form, concept, palette, type pairing or signature technique):
${avoid || "- none yet"}

THE STORY
${story.title}
${String(story.text).slice(0, 8000)}

LOCKED MESSAGE (the copy has passed our fact checks: carry it word for word, in this order; the type label only says what each line is, it is NOT a layout):
${copyLines(storyboard)}

REAL MATERIAL AVAILABLE (screenshots of the pages the story links to; use what serves the story):
${material || "- none"}
${voice ? `\n${voiceBlock(voice)}\n` : ""}${format === "reel" && music ? `\nMUSIC LIBRARY (the only music this piece may use: pick ONE track whose mood, tempo and energy fit the story and the form; under a voiceover prefer an instrumental; never a track marked "used recently"; its biggest drop will be placed on your climax):\n${music}\n` : ""}
HARD CONSTRAINTS
- Format: ${f.size}; ${f.safe}. Readable with the sound off, on a phone, at a glance: your own type >= 34 px.
- ${format === "reel" ? `About ${filmSeconds(storyboard, voice)} seconds at ${storyboard.bpm} bpm; every frame a pure function of time; the last frame loops into the first.` : `${storyboard.slides.length} slides, rendered as stills, one per locked entry (none dropped); slide 1 is the cover that must stop the scroll.`}
- Ends on a follow lockup: ${storyboard.author}, ${storyboard.handle}.
- Fonts only from @fontsource (name the exact families). At most 4 colours plus neutrals, in hex.
- No stock imagery except our VISUAL LIBRARY below, as texture, transition or atmosphere. No robots/brains/circuit boards, no purple-blue neon, no glassmorphism, no invented UI or fake dashboards, no emoji.
${format === "reel" ? library.visualsBlock(() => "library clip").replace(/ -> library clip/g, "") : ""}

WRITE THE PROMPT WITH THESE SECTIONS, in this order, as plain text with the section names in capitals:
CONCEPT (one sentence: the visual idea, drawn from the subject)
FORM (one line naming the form from THE BAR, or a new one, and why it suits this story; it must differ from the recent pieces' forms)
THROUGH-LINE (what carries the eye across every cut or slide, and how it changes)
PALETTE (strict hex list with a role for each)
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
      const missingSections = REQUIRED.filter((h) => !hasSection(text, h));
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

module.exports = { selectReferences, writeDirectorPrompt, copyLines, lockedStrings, voiceBlock, filmSeconds, hasSection, canon, FORMATS, CRAFT_BAR, GOLD };
