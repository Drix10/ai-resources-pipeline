// Content factory: storyboard gates, timeline, sources, soundtrack, queue. No network, no Claude, no renders.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { validate, finalize } = require("../src/factory/storyboard");
const { reelTimeline, reelDuration } = require("../src/factory/timeline");
const { fromDigest, fromInsight, rankSources } = require("../src/factory/sources");
const { synthesize } = require("../src/factory/soundtrack");
const { composeCaption } = require("../src/factory/instagram");
const library = require("../src/factory/library");
const opus = require("../src/factory/opus");

const ROOT = path.resolve(__dirname, "..");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "factory/fixtures/struct-padding.json"), "utf8"));
const ARTICLE = fromInsight(path.join(ROOT, "factory/fixtures/insights/c-struct-padding-why-your-16-byte-payload-becomes--1790208355844.md"));
const reelOf = (sb) => ({ ...sb, slides: [] });
const carouselOf = (sb) => ({ ...sb, format: "carousel", scenes: [] });
// An agent reel: narrated, 37 s at 120 bpm, a real visual for every scene, headlines of <= 6 words.
const agentReel = () => ({
  ...reelOf(FIXTURE),
  bpm: 120,
  scenes: [
    { type: "hook", beats: 10, text: "Your 16-byte struct is 32 bytes.", emphasis: ["32 bytes."], visual: { show: "Hands typing C at night, slow push-in", use: "stock: developer typing code at night" }, voiceover: "Your 16-byte struct is eating 32 bytes. And the last line is why." },
    { type: "statement", beats: 10, headline: "Double the L1 cache misses.", visual: { show: "The repo page, pushed in on the struct", use: "page1-desktop" }, voiceover: "I hit a bottleneck where a tiny struct doubled the L1 cache misses." },
    { type: "code", beats: 10, lang: "c", code: "struct {\n  char a;\n  int  b;\n  char c;\n};", caption: "6 bytes on paper.", visual: { show: "The struct typed out, line by line", use: "graphic" }, voiceover: "On paper this struct is 1 plus 4 plus 1. Six bytes." },
    { type: "stat", beats: 14, from: 6, value: 12, suffix: " bytes", label: "sizeof says 12.", visual: { show: "Server racks, the number riding over them", use: "stock: server racks in a data center" }, voiceover: "But int b needs 4-byte alignment, so it starts at address 4. Three padding bytes. sizeof says 12." },
    { type: "statement", beats: 10, headline: "It scales: 16 becomes 32.", visual: { show: "Memory chips in macro, a slow pan", use: "stock: memory chips close up" }, voiceover: "Scale that up and a 16-byte payload lands in 32 bytes of memory." },
    { type: "list", beats: 10, title: "Fix it in review", items: ["Order members largest first", "Check sizeof in a test"], visual: { show: "Two people reviewing code on a laptop", use: "stock: code review on a laptop" }, voiceover: "The fix is boring. Order members largest first, and check sizeof in a test." },
    { type: "cta", beats: 10, text: "Send this to your C reviewer.", visual: { show: "Back to the typing hands, the loop closes", use: "stock: developer typing code at night" }, voiceover: "Send this to the person who reviews your C. They'll thank you." },
  ],
});

test("sample storyboard passes the reel and carousel gates against its own article", () => {
  assert.deepEqual(validate(reelOf(FIXTURE), ARTICLE, "reel"), []);
  assert.deepEqual(validate(carouselOf(FIXTURE), ARTICLE, "carousel"), []);
});

test("an invented number is rejected", () => {
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes[3] = { ...sb.scenes[3], value: 47 };
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /47/.test(e)));
});

test("numbers inside code blocks and small counts are exempt from the fact gate", () => {
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes[2].code = "int arr[4096];";
  assert.deepEqual(validate(sb, ARTICLE, "reel"), []);
});

test("bad structure, long copy and the removed plate scene are rejected; hype words in any inflection too", () => {
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes.push({ type: "hook", beats: 2, text: "x" });
  sb.scenes[1].headline = "x".repeat(70);
  sb.scenes.splice(2, 0, { type: "plate", beats: 4, plate: "p1", headline: "Old image scene" });
  const errs = validate(sb, ARTICLE, "reel").join("\n");
  assert.match(errs, /plate/);
  assert.match(errs, /last scene must be a cta/);
  assert.match(errs, /headline is 70 chars/);
  // Content gates run once the shape is right.
  const hype = structuredClone(reelOf(FIXTURE));
  delete hype.scenes[0].emphasis;
  for (const text of ["Unlock the hidden 32 bytes", "It unlocks the cache", "A game changer for C"]) {
    hype.scenes[0].text = text;
    assert.match(validate(hype, ARTICLE, "reel").join("\n"), /Remove these words: (unlock|game-changer)/, text);
  }
});

test("finalize pins handle, author, theme and id", () => {
  const sb = finalize({ theme: "neon", bpm: "121.6", scenes: [], slides: [{ type: "cover" }], hashtags: ["#C"] }, { article: ARTICLE, format: "carousel" });
  assert.equal(sb.theme, "night");
  assert.equal(sb.bpm, 122);
  assert.equal(sb.handle, "@drix10");
  assert.match(sb.id, /^carousel-/);
  assert.deepEqual(sb.hashtags, ["#c"]);
  assert.deepEqual(sb.scenes, []);
});

test("timeline snaps scenes to the beat grid (120 bpm @ 30 fps = 15 frames/beat)", () => {
  const tl = reelTimeline(FIXTURE);
  assert.deepEqual(tl.map((s) => s.from), [0, 90, 180, 330, 420, 570]);
  assert.equal(reelDuration(FIXTURE), 660);
  // Matches factory/src/Reel.tsx#reelTimeline (same arithmetic, duplicated for Node).
  const tsx = fs.readFileSync(path.join(ROOT, "factory/src/Reel.tsx"), "utf8");
  assert.match(tsx, /const from = Math\.round\(t\);\s*t \+= s\.beats \* beat;/);
});

test("digest files split into one source per item and skip thin items", () => {
  const md = "### 🚀 Real Item Title\n\n" + "word ".repeat(80) + "\n\n🔗 Resources:\n• [x](https://x.com)\n\n---\n### Thin one\n\nshort\n";
  const items = fromDigest(md, { topic: "AI Developer Tools", url: "https://example.com/r.md" });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Real Item Title");
  assert.ok(!items[0].text.includes("Resources"));
  assert.deepEqual(items[0].tags, ["ai developer tools"]);
});

test("LinkedIn Insight sources drop the reference footer and sign-off", () => {
  assert.ok(!ARTICLE.text.includes("Reference & Source Breakdown"));
  assert.ok(!/Follow for daily/.test(ARTICLE.text));
  assert.ok(ARTICLE.text.includes("16-byte"));
  assert.equal(rankSources([{ text: "a b c" }, ARTICLE])[0], ARTICLE);
});

test("soundtrack has the requested length and stays under 0 dBFS", () => {
  const { L, R } = synthesize({ bpm: 120, seconds: 3, cuts: [0, 1.5], seed: 3 });
  assert.equal(L.length, Math.ceil(3 * 44100));
  let peak = 0;
  for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  assert.ok(peak > 0.3 && peak < 1, `peak ${peak}`);
});

test("caption adds hashtags and respects Instagram's 2,200 chars", () => {
  const cap = composeCaption({ caption: "x".repeat(3000), hashtags: ["#a", "#b"] });
  assert.equal(cap.length, 2200);
  assert.match(composeCaption({ caption: "Hi", hashtags: ["#a", "#b"] }), /Hi\n\n#a #b$/);
});

test("library ranks patterns by article tags and includes video notes", () => {
  const block = library.patternsFor(ARTICLE, "reel");
  assert.match(block, /myth-number/);
  assert.ok(library.videos().length >= 2);
});

test("parseJson tolerates fences and prose", () => {
  assert.deepEqual(opus.parseJson('Sure!\n```json\n{"a": "b}", "c": [1]}\n```\nDone'), { a: "b}", c: [1] });
  assert.throws(() => opus.parseJson("no json here"));
});

test("queue retries a failed source once, then leaves it", () => {
  const queue = require("../src/factory/queue");
  const file = path.join(queue.STATE_DIR, "queue.json");
  const backup = fs.existsSync(file) ? fs.readFileSync(file) : null;
  try {
    fs.rmSync(file, { force: true });
    const a = { origin: "t", slug: "s" };
    const k = queue.key("t", "s", "reel");
    assert.equal(queue.has(a, "reel"), false);
    queue.add({ key: k, status: "failed" });
    assert.equal(queue.has(a, "reel"), false);
    queue.add({ key: k, status: "failed" });
    assert.equal(queue.has(a, "reel"), true);
  } finally {
    if (backup) fs.writeFileSync(file, backup);
    else fs.rmSync(file, { force: true });
  }
});

test("factory is off by default", () => {
  assert.equal(require("../config").factory.enabled, process.env.FACTORY_ENABLED === "true");
  assert.equal(require("../config").instagram.post, process.env.IG_POST === "true");
  void os;
});

test("novelty: duplicate topics in the archive collapse to one, distinct topics survive", () => {
  const novelty = require("../src/factory/novelty");
  const { listInsights } = require("../src/factory/sources");
  const all = listInsights();
  const kept = novelty.orderForNovelty(all, []);
  const count = (re) => kept.filter((a) => re.test(a.title)).length;
  assert.equal(count(/struct (padding|member)/i), 1);
  assert.equal(count(/webhooks?.*hmac/i), 1);
  assert.equal(count(/^AST /), 1);
  assert.ok(count(/vector search/i) === 1 && count(/hedging/i) === 1);
});

test("novelty: a topic already made is not fresh; looks are listed for the next agent", () => {
  const novelty = require("../src/factory/novelty");
  const made = { origin: "x", title: ARTICLE.title, topicText: novelty.topicText(ARTICLE), look: { idea: "relay dot", palette: ["#000"], fonts: ["A", "B"], technique: "svg", engine: "remotion" } };
  const twin = fromInsight(path.join(ROOT, "factory/fixtures/insights/why-careless-struct-member-ordering-turns-a-16-byt-1789680166457.md"));
  const other = fromInsight(path.join(ROOT, "factory/fixtures/insights/the-hidden-knobs-of-vector-search-tuning-1788869383457.md"));
  assert.equal(novelty.isFreshTopic(twin, [made]), false);
  assert.equal(novelty.isFreshTopic(other, [made]), true);
  assert.match(novelty.looksToAvoid([made]), /relay dot.*svg.*remotion/);
});

test("agent prompt carries fixed wording, recent looks and the engine block", () => {
  const { heroPrompt } = require("../src/factory/hero");
  const p = heroPrompt({ storyboard: reelOf(FIXTURE), article: ARTICLE, references: [], engine: "hyperframes", skills: ["/hyperframes:hyperframes"], avoid: "1. idea: relay dot" });
  assert.match(p, /FIXED WORDING/);
  assert.match(p, /Your 16-byte struct is secretly 32 bytes\./);
  assert.match(p, /idea: relay dot/);
  assert.match(p, /npx hyperframes init/);
  assert.match(p, /\/hyperframes:hyperframes/);
  assert.match(p, /out\/look\.json/);
});

test("gate: missing required text, pictographic emoji, small magnitudes and extended quotes are rejected", () => {
  const base = () => structuredClone(reelOf(FIXTURE));
  let sb = base(); delete sb.scenes[5].text;
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /text is required/.test(e)));
  sb = base(); sb.scenes[1].headline = "Padding wastes memory ✅";
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /emoji/i.test(e)));
  sb = base(); sb.scenes[3] = { type: "stat", beats: 6, value: 5, suffix: "M", label: "structs affected" };
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /not in the article: 5/.test(e)));
  sb = base(); sb.scenes.splice(4, 0, { type: "quote", beats: 6, text: "LeetCode graph tricks are useless and Linus agrees completely" });
  sb.scenes[1].beats = 4; sb.scenes[2].beats = 6;
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /verbatim/.test(e)));
  const car = finalize({ slides: [{ type: "stat", value: 87, label: "x" }] }, { article: ARTICLE, format: "carousel" });
  assert.equal(car.slides[0].value, "87");
});

test("on Windows the claude .cmd shim resolves to the exe it launches; other platforms are untouched", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-bin-"));
  try {
    fs.mkdirSync(path.join(dir, "node_modules/@anthropic-ai/claude-code/bin"), { recursive: true });
    const exe = path.join(dir, "node_modules/@anthropic-ai/claude-code/bin/claude.exe");
    fs.writeFileSync(exe, "");
    fs.writeFileSync(path.join(dir, "claude.cmd"), `@ECHO off\r\n"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);
    assert.equal(path.resolve(opus.resolveBin("claude", { platform: "win32", pathEnv: dir })), path.resolve(exe));
    assert.equal(opus.resolveBin("claude", { platform: "linux", pathEnv: dir }), "claude");
    assert.equal(opus.resolveBin("claude", { platform: "win32", pathEnv: "" }), "claude");
    assert.equal(opus.resolveBin("C:\\x\\claude.exe", { platform: "win32", pathEnv: dir }), "C:\\x\\claude.exe");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the agent sees the whole library: every entry in the catalog, the closest prompts inline, long ones clipped", () => {
  const { heroPrompt } = require("../src/factory/hero");
  const all = library.videos();
  const catalog = library.catalog();
  for (const v of all) assert.ok(catalog.includes(v.title), `catalog misses ${v.slug}`);
  const compact = library.catalog({ compact: true });
  for (const v of all) assert.ok(compact.includes(`- ${v.slug} | `), `compact catalog misses ${v.slug}`);
  assert.deepEqual(library.parseRepo("https://github.com/heygen-com/hyperframes-community-skills/tree/master/skills/session-story"), { clone: "https://github.com/heygen-com/hyperframes-community-skills", name: "hyperframes-community-skills", sub: "skills/session-story" });
  assert.deepEqual(library.parseRepo("https://github.com/a/b.git"), { clone: "https://github.com/a/b", name: "b", sub: "" });
  assert.equal(library.parseRepo("https://example.com/a/b"), null);
  const ref = { slug: "pm-x", title: "Picked one", steal: "the mask wipe from outgoing letterforms", promptFile: "/lib/x/prompt.md", contact: "/lib/x/contact.jpg", repoDir: "/lib/repos/x" };
  const p = heroPrompt({ storyboard: reelOf(FIXTURE), article: ARTICLE, references: [ref], director: "CONCEPT\nA ledger that balances itself.", engine: "remotion", skills: [], avoid: "" });
  assert.match(p, /DIRECTOR'S PROMPT[^\n]*\nCONCEPT\nA ledger that balances itself\./, "the director's prompt is the brief");
  assert.match(p, /^You are a world-class short-form video editor[^\n]*Build one Instagram Reel: a ~\d+-second film, cut from the REAL MATERIAL/, "a reel is an edit of real material");
  assert.match(p, /THE BAR FOR A REEL/);
  assert.match(p, /THE STORYBOARD'S SHOT PLAN/);
  assert.match(p, /no logo, no end card, no outro/, "a reel loops instead of ending on a lockup");
  assert.ok(!/THE STANDARD/.test(p), "a reel is not held to the motion films' look");
  assert.match(p, /- pm-x: Picked one\n  TAKE: the mask wipe from outgoing letterforms\n  prompt \/lib\/x\/prompt\.md \| frames \/lib\/x\/contact\.jpg \| code \/lib\/repos\/x/);
  const c = heroPrompt({ storyboard: carouselOf(FIXTURE), article: ARTICLE, references: [ref], director: null, engine: "remotion", skills: [], avoid: "" });
  assert.match(c, /NOT a template/, "P(doom) and Tessel are the carousels' standard, not a look to copy");
  assert.match(c, /THE STANDARD[^\n]*pdoom-music-video[\s\S]*tessel-launch/, "the gold standard is referenced for carousels");
  assert.match(p, /LIBRARY\.md/);
  assert.ok(p.length < 60000, `the catalog lives in LIBRARY.md, not the prompt (${p.length} chars)`);
  assert.match(p, /"form": "<one line>"/, "the look memory records the form");
  assert.ok(!/PLATES \(|public\/plates|staticFile\("plates/.test(p), "no image plates left in the agent prompt");
});

test("carousels are agent-built stills with an exact output contract", () => {
  const { heroPrompt } = require("../src/factory/hero");
  const car = { ...carouselOf(FIXTURE), format: "carousel" };
  const p = heroPrompt({ storyboard: car, article: ARTICLE, references: [], director: null, engine: "remotion", skills: [], avoid: "" });
  const n = String(car.slides.length).padStart(2, "0");
  assert.match(p, new RegExp(`${car.slides.length} designed slides`));
  assert.match(p, /registers a composition with id "Slides": 1080x1350/);
  assert.match(p, new RegExp(`out/slide-01\\.png \\.\\. out/slide-${n}\\.png \\(1080x1350\\)`));
  assert.match(p, /none this time: before building, write your own director's prompt/, "no director prompt: the agent writes its own brief");
  assert.equal(require("../config").factory.carouselMode, process.env.FACTORY_CAROUSEL_MODE === "template" ? "template" : "agent");
});

test("director: references come from the whole catalog; a draft missing sections or locked lines is sent back", async () => {
  const director = require("../src/factory/director");
  const saved = opus.ask;
  const sb = reelOf(FIXTURE);
  const slugs = library.videos().slice(0, 6).map((v) => v.slug);
  try {
    let seenCatalog = false;
    opus.ask = async ({ prompt }) => { seenCatalog = prompt.includes(`- ${slugs[5]} | `); return JSON.stringify({ picks: [...slugs.slice(0, 5).map((slug) => ({ slug, steal: "x" })), { slug: "not-a-real-slug", steal: "y" }] }); };
    const refs = await director.selectReferences(ARTICLE, "carousel");
    assert.ok(seenCatalog, "the picker reads the whole catalog");
    assert.deepEqual(refs.map((r) => r.slug), slugs.slice(0, 5), "unknown slugs are dropped");
    assert.deepEqual((await director.selectReferences(ARTICLE, "reel")).map((r) => r.slug), slugs.slice(0, 4), "a reel borrows craft from 4 films");

    const car = carouselOf(FIXTURE);
    const locked = director.lockedStrings(car);
    // Headings as people write them: numbered, markdown, bold.
    const heads = ["1. CONCEPT", "## FORM", "**THROUGH-LINE**", "PALETTE", "TYPE SYSTEM", "MESSAGE", "REQUIRED TECHNIQUES (numbered)", "BANNED"];
    const body = heads.map((h) => `${h}\nfilled in with real direction ${"x".repeat(220)}`).join("\n");
    // Typographic quotes/dashes and a different case still count as carrying the copy.
    const good = `${body}\n${locked.map((l) => l.replace(/'/g, "’").replace(/ - /g, " — ").toUpperCase()).join("\n")}`;
    const asked = [];
    opus.ask = async ({ prompt }) => { asked.push(prompt); return asked.length === 1 ? "CONCEPT only, too short" : good; };
    const text = await director.writeDirectorPrompt({ story: ARTICLE, storyboard: car, refs, engine: "remotion" });
    assert.equal(text, good);
    assert.equal(asked.length, 2, "the first draft was rejected");
    assert.match(asked[1], /YOUR PREVIOUS DRAFT WAS REJECTED: missing sections: FORM, THROUGH-LINE/);
    assert.match(asked[0], /THE BAR/);
    assert.match(asked[0], /REMIX, DON'T COPY/);
    // A brief that paraphrases the copy is kept, with the exact copy appended as the authority.
    opus.ask = async () => body;
    const kept = await director.writeDirectorPrompt({ story: ARTICLE, storyboard: car, refs, engine: "remotion" });
    assert.ok(kept.startsWith(body));
    assert.match(kept, /LOCKED MESSAGE \(authoritative/);
    assert.ok(!/voiceover/.test(director.copyLines({ ...sb, scenes: sb.scenes.map((s) => ({ ...s, voiceover: "[curious] spoken" })) })), "the voiceover is never on-screen copy");
    // A reel: the reel bar, the storyboard's shot plan, and a SHOT LIST instead of FORM.
    const reel = agentReel();
    const reelAssets = [{ id: "page1-desktop", kind: "desktop", width: 2160, height: 1350, url: "https://github.com/Drix10/Grind" }, { id: "stock-4", kind: "stock-video", width: 1080, height: 1920, seconds: 12, query: "server racks in a data center", url: "https://videos.pexels.com/x.mp4", page: "https://www.pexels.com/video/1/" }];
    const reelHeads = ["CONCEPT", "THROUGH-LINE", "PALETTE", "TYPE SYSTEM", "MESSAGE", "SHOT LIST", "REQUIRED TECHNIQUES", "BANNED"];
    const reelBody = `${reelHeads.map((h) => `${h}\nreal direction ${"x".repeat(220)}`).join("\n")}\n${director.lockedStrings(reel).join("\n")}`;
    const reelAsked = [];
    opus.ask = async ({ prompt }) => { reelAsked.push(prompt); return reelBody; };
    assert.equal(await director.writeDirectorPrompt({ story: ARTICLE, storyboard: reel, refs, assets: reelAssets, engine: "remotion" }), reelBody, "a reel brief needs no FORM section");
    assert.match(reelAsked[0], /THE BAR FOR A REEL/);
    assert.match(reelAsked[0], /TECHNIQUES FROM THE LIBRARY/);
    assert.match(reelAsked[0], /4\. SHOWS: Server racks, the number riding over them \| MATERIAL: stock-4 \(12 s video, 1080x1920, found for "server racks in a data center"\) \| SAYS: "But int b/);
    assert.match(reelAsked[0], /5\. SHOWS: [^\n]*MATERIAL: nothing was found for "memory chips close up"/);
    assert.ok(!/"visual"/.test(director.copyLines(reel)), "the visual plan is not on-screen copy");
    // The gold-standard films are never remix references.
    opus.ask = async () => JSON.stringify({ picks: [{ slug: "pdoom-music-video", steal: "x" }, ...slugs.map((slug) => ({ slug, steal: "x" })), { slug: slugs[0], steal: "dup" }] });
    const picks = await director.selectReferences(ARTICLE, "reel");
    assert.ok(!picks.some((p) => director.GOLD.has(p.slug)));
    assert.equal(new Set(picks.map((p) => p.slug)).size, picks.length, "no duplicates");
  } finally {
    opus.ask = saved;
  }
});

test("sources keep their public links, repo first, login-walled hosts dropped", () => {
  const { linksOf } = require("../src/factory/sources");
  const md = "see https://x.com/a/status/1 and [docs](https://docs.example.com/guide). Repo: https://github.com/Drix10/idolchat, file https://github.com/a/b/blob/main/x.md";
  assert.deepEqual(linksOf(md), ["https://github.com/Drix10/idolchat", "https://github.com/a/b/blob/main/x.md", "https://docs.example.com/guide"]);
});

test("a carousel shot slide must point at a captured screenshot", () => {
  const assets = [{ id: "page1-card", kind: "card", url: "https://github.com/a/b", title: "a/b" }, { id: "page1-mobile", kind: "mobile", url: "https://github.com/a/b" }];
  const art = { ...ARTICLE, assets };
  const sb = structuredClone(carouselOf(FIXTURE));
  sb.slides.splice(2, 0, { type: "shot", asset: "page1-card", title: "The repo behind it" });
  assert.deepEqual(validate(sb, art, "carousel"), []);
  sb.slides[2].asset = "page1-mobile";
  assert.ok(validate(sb, art, "carousel").some((e) => /not one of the REAL SCREENSHOTS/.test(e)));
});

test("the agent gets the captured pages and a shot tool limited to the article's hosts", () => {
  const { heroPrompt } = require("../src/factory/hero");
  const art = { ...ARTICLE, links: ["https://github.com/Drix10/idolchat", "https://blogs.drix10.com/"] };
  const assets = [{ id: "page1-desktop", kind: "desktop", width: 2160, height: 1350, title: "Drix10/idolchat", url: "https://github.com/Drix10/idolchat" }];
  const p = heroPrompt({ storyboard: reelOf(FIXTURE), article: art, references: [], assets, engine: "remotion", skills: [], avoid: "" });
  assert.match(p, /REAL MATERIAL/);
  assert.match(p, /page1-desktop -> public\/assets\/page1-desktop\.jpg \(desktop, 2160x1350\)/);
  assert.match(p, /staticFile\("assets\/<file>"\)/);
  const withPost = heroPrompt({ storyboard: reelOf(FIXTURE), article: art, references: [], assets: [{ id: "post", kind: "post", width: 1644, height: 1211, file: "C:/x/assets/post.png", url: "https://x.com/a/status/1" }, { id: "stock-3", kind: "stock-video", width: 1080, height: 1920, seconds: 12, file: "C:/x/assets/stock-3.mp4", url: "https://videos.pexels.com/x.mp4" }], engine: "hyperframes", skills: [], avoid: "" });
  assert.match(withPost, /- post -> assets\/post\.png \(post, 1644x1211\)/, "the post keeps its PNG extension");
  assert.match(withPost, /- stock-3 -> footage\/stock-3\.mp4 \(stock-video, 1080x1920, 12 s\)/, "clips live outside the project, to be trimmed in");
  assert.match(p, /only these hosts: github\.com, blogs\.drix10\.com/);
});

test("the shot tool refuses hosts the article does not link to, and local addresses", async () => {
  const { spawnSync } = require("child_process");
  const run = (url, hosts) => spawnSync(process.execPath, [path.join(ROOT, "src/factory/shot.js"), url, "out.jpg"], { encoding: "utf8", env: { ...process.env, FACTORY_SHOT_HOSTS: hosts } });
  const r = run("https://evil.example.com/", "github.com");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not linked from the article/);
  const { shootOne } = require("../src/factory/assets");
  await assert.rejects(shootOne("http://127.0.0.1:8080/", "x.jpg"), /refusing port/);
  await assert.rejects(shootOne("http://127.0.0.1/", "x.jpg"), /blocked address/);
  await assert.rejects(shootOne("http://localhost/", "x.jpg"), /blocked host/);
  await assert.rejects(shootOne("file://github.com/share/x", "x.jpg"), /refusing file:/);
  const bad = run("file://github.com/share/x", "github.com");
  assert.match(bad.stderr, /only http\(s\)/);
});

test("editor: fresh run material only, Opus picks one, deep dive folds in linked pages", async () => {
  const editor = require("../src/factory/editor");
  const item = (t, n) => ({ title: t, text: `${t} `.repeat(n), slug: t, origin: `x#${t}`, links: [] });
  const run = [item("vague", 30), item("concrete", 90)];
  assert.equal(editor.freshSources(run, { now: Number.MAX_SAFE_INTEGER }).fresh.length, 2, "only this run's items when no Insight is recent");
  // Freshness comes from the epoch in the Insight's file name, not its (git-touched) mtime.
  assert.equal(editor.writtenAt("LinkedIn Insights/x-1790536700285.md"), 1790536700285);
  // Checked against the live archive only while that Insight is in it.
  if (fs.readdirSync(path.join(ROOT, "LinkedIn Insights")).some((f) => f.endsWith("-1790536700285.md"))) {
    const recentInsight = editor.freshSources([], { now: 1790536700285 + 3600 * 1000 }).fresh;
    assert.ok(recentInsight.some((a) => /1790536700285/.test(a.origin)), "an Insight written an hour ago is fresh");
  }

  const saved = opus.ask;
  try {
    opus.ask = async () => '{"pick": 2, "why": "showable"}';
    const order = await editor.pickStory(run);
    assert.equal(order[0].title, "vague", "the editor's pick wins over the digit ranking");
    opus.ask = async () => { throw new Error("down"); };
    assert.equal((await editor.pickStory(run))[0].title, "concrete", "a failed pick falls back to the ranking");
  } finally {
    opus.ask = saved;
  }

  const art = { ...ARTICLE, links: ["https://github.com/a/b", "https://empty.example.com/"] };
  const fetch = async (u) => (u.includes("github") ? { url: u, title: "a/b README", text: "Measured 4096 connections per node. ".repeat(20) } : null);
  const deep = await editor.deepDive(art, { fetch });
  assert.match(deep.text, /RESEARCH \(pages the article links to\)/);
  assert.equal(deep.research.length, 1);
  assert.equal(deep.slug, art.slug, "same story identity for the ledger and novelty");
  assert.equal(deep.baseText, art.text, "the story's own text is kept apart from the research");
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes[3] = { type: "stat", beats: 6, value: 4096, label: "connections per node" };
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /4096/.test(e)), "not in the article alone");
  assert.ok(!validate(sb, deep, "reel").some((e) => /4096/.test(e)), "allowed once the linked page says it");
});

// ---------------------------------------------------------------- hardening (review fixes)

test("fact gate: numbers split across stat fields, glued units, decimals, words, hashtags and research URLs are all claims", () => {
  const base = () => { const sb = structuredClone(reelOf(FIXTURE)); delete sb.scenes[0].emphasis; return sb; };
  const hook = (text, art = ARTICLE) => { const sb = base(); sb.scenes[0].text = text; return validate(sb, art, "reel").join("\n"); };
  let sb = base(); sb.scenes[3] = { type: "stat", beats: 6, suffix: "x", value: 9, label: "faster at startup" };
  assert.match(validate(sb, ARTICLE, "reel").join("\n"), /not in the article: 9/, "9x drawn from suffix + value");
  sb = base(); sb.scenes[3] = { type: "stat", beats: 6, prefix: "1", value: 5, suffix: "0", label: "x" };
  assert.match(validate(sb, ARTICLE, "reel").join("\n"), /may not contain digits/);
  sb = base(); sb.scenes[3] = { type: "stat", beats: 6, value: 3.25, label: "x" };
  assert.match(validate(sb, ARTICLE, "reel").join("\n"), /display rounded/);
  assert.match(hook("Builds took 40s on this struct"), /not in the article: 40/);
  assert.match(hook("Handles 5000qps on one core"), /not in the article: 5000/);
  assert.match(hook("Saves 7.5 seconds per call"), /not in the article: 7.5/);
  assert.match(hook("A million users hit this"), /amounts are not in the article: million/);
  sb = base(); sb.hashtags = ["#cprog", "#top9999", "#systems"];
  assert.match(validate(sb, ARTICLE, "reel").join("\n"), /not in the article: 9999/);
  assert.equal(hook("3 fields, one bad order"), "", "bare counting numbers are fine");
  const deep = { ...ARTICLE, baseText: ARTICLE.text, text: `${ARTICLE.text}\n\nRESEARCH (pages the article links to):\n--- issue (https://github.com/org/repo/issues/8123)\nThe README says revolutionary seamless layouts. It measured 342 cache lines.` };
  assert.match(hook("8123 bugs fixed in padding", deep), /not in the article: 8123/, "a number only in a research URL is not a fact");
  assert.match(hook("A revolutionary seamless way", deep), /Remove these words/, "hype in a linked README is not the author's voice");
  assert.equal(hook("It measured 342 cache lines", deep), "", "a number the research text states is allowed");
});

test("gate: wrong field types, smuggled text and emoji are rejected instead of crashing", () => {
  const base = () => structuredClone(reelOf(FIXTURE));
  const errs = (mut) => { const sb = base(); mut(sb); return validate(sb, ARTICLE, "reel").join("\n"); };
  assert.match(errs((sb) => { sb.scenes[2].highlight = 3; }), /highlight must be a list/);
  assert.match(errs((sb) => { sb.scenes[3] = { type: "stat", beats: 6, value: 2.5, decimals: 50, label: "x" }; }), /decimals must be 0-3/);
  assert.match(errs((sb) => { sb.scenes[0].emphasis = 5; }), /emphasis must be a list/);
  assert.match(errs((sb) => { sb.scenes[1] = null; }), /must be an object/);
  assert.match(errs((sb) => { sb.scenes[2].lang = "UNLOCK 10000x FASTER"; }), /lang must be a short language name/);
  assert.match(errs((sb) => { sb.caption = "Save this \u{1F680}"; }), /No emojis in the caption/);
  assert.match(errs((sb) => { sb.scenes[1].headline = "Flag \u{1F1FA}\u{1F1F8} here"; }), /No emojis/);
  assert.equal(errs((sb) => { sb.scenes[1].headline = "Rust™ and C©"; }), "", "trademark signs are not emoji");
  assert.match(errs((sb) => { sb.scenes[1].headline = "see averyveryverylongpathname/thing"; }), /too long for on-screen type/);
  for (const raw of [null, { slides: {} }, { hashtags: "#a #b" }, { scenes: [null] }]) {
    assert.doesNotThrow(() => validate(finalize(raw, { article: ARTICLE, format: "reel" }), ARTICLE, "reel"));
  }
  const car = finalize({ slides: [{ type: "shot", asset: "x", title: "t", src: "https://evil.example/x.png", host: "unlock" }] }, { article: ARTICLE, format: "carousel" });
  assert.equal(car.slides[0].src, undefined, "src/host never come from the model");
  assert.equal(car.slides[0].host, undefined);
});

test("quote gate is word-bounded and Unicode-aware", () => {
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes[1].beats = 4; sb.scenes[2].beats = 6;
  for (const text of ["这是编造的引语", "Code graph", "!!!"]) {
    const s = structuredClone(sb);
    s.scenes.splice(4, 0, { type: "quote", beats: 4, text });
    assert.match(validate(s, ARTICLE, "reel").join("\n"), /verbatim/, text);
  }
});

test("ledger: a corrupt or locked file never reads as empty; live items are never replaced or reposted; a broken item stops blocking", () => {
  const queue = require("../src/factory/queue");
  const file = path.join(queue.STATE_DIR, "queue.json");
  const backup = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const asideBefore = new Set(fs.readdirSync(queue.STATE_DIR));
  try {
    fs.rmSync(file, { force: true });
    assert.deepEqual(queue.load(), { items: [] }, "a missing ledger is empty");
    fs.writeFileSync(file, "{ not json");
    assert.throws(() => queue.load(), /unreadable/);
    const aside = fs.readdirSync(queue.STATE_DIR).filter((f) => f.startsWith("queue.json.corrupt-") && !asideBefore.has(f));
    assert.equal(aside.length, 1, "the corrupt file is kept aside");
    for (const f of aside) fs.rmSync(path.join(queue.STATE_DIR, f));

    fs.rmSync(file, { force: true });
    const up = path.join(os.tmpdir(), `factory-up-${process.pid}.mp4`);
    fs.writeFileSync(up, "x");
    queue.add({ key: "k1", status: "rendered", upload: [up] });
    queue.add({ key: "k2", status: "rendered", upload: [path.join(os.tmpdir(), "missing-file.mp4")] });
    queue.add({ key: "k3", status: "rendered", upload: [up] });
    assert.equal(queue.nextToPost().key, "k1");
    for (let i = 0; i < queue.MAX_PUBLISH_ATTEMPTS; i++) queue.publishFailed("k1", "boom");
    assert.equal(queue.load().items.find((x) => x.key === "k1").status, "publish_failed");
    assert.equal(queue.nextToPost().key, "k3", "a broken item and one with missing files are skipped");

    queue.update("k3", { status: "sharing", shareClickedAt: new Date().toISOString() });
    assert.equal(queue.postedSince(3600 * 1000).length, 1, "a share in flight counts toward the cap");
    assert.throws(() => queue.add({ key: "k3", status: "rendered", upload: [up] }), /already sharing/);
    queue.update("k3", { status: "unconfirmed" });
    assert.equal(queue.nextToPost(), null, "an unconfirmed share is never retried automatically");
    fs.rmSync(up, { force: true });
  } finally {
    if (backup) fs.writeFileSync(file, backup);
    else fs.rmSync(file, { force: true });
  }
});

test("factory lock: one run at a time, a dead owner's lock is taken over", async () => {
  const { withFactoryLock, FILE } = require("../src/factory/lock");
  const quiet = { warn: () => {} };
  fs.rmSync(FILE, { force: true });
  const inner = await withFactoryLock("outer", async () => {
    // A second process would be refused while the first holds it: simulate with a foreign live pid.
    const mine = fs.readFileSync(FILE, "utf8");
    fs.writeFileSync(FILE, JSON.stringify({ pid: process.ppid || 4, label: "other", at: Date.now() }));
    const r = await withFactoryLock("second", async () => "ran", { logger: quiet });
    fs.writeFileSync(FILE, mine);
    return r;
  }, { logger: quiet });
  assert.equal(inner, null, "refused while another live run holds the lock");
  assert.equal(fs.existsSync(FILE), false, "released after the run");
  fs.writeFileSync(FILE, JSON.stringify({ pid: 999999, label: "crashed", at: Date.now() }));
  assert.equal(await withFactoryLock("after-crash", async () => "ran", { logger: quiet }), "ran", "a dead owner's lock is stale");
  assert.equal(fs.existsSync(FILE), false);
});

test("capture proxy refuses private, local and non-web destinations", async () => {
  const { startProxy, resolvePublic, assertCapturable } = require("../src/factory/assets");
  for (const h of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "[::1]", "localhost", "router", "printer.lan", "x.home.arpa"]) {
    await assert.rejects(resolvePublic(h), /blocked/, h);
  }
  await assert.rejects(assertCapturable("http://example.com:22/"), /refusing port 22/);
  await assert.rejects(assertCapturable("ftp://example.com/"), /refusing ftp:/);
  const proxy = await startProxy();
  const connect = (target) => new Promise((resolve) => {
    const s = require("net").connect(proxy.port, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let got = "";
    s.on("data", (d) => { got += d; if (got.includes("\r\n\r\n")) { s.destroy(); resolve(got.split("\r\n")[0]); } });
    s.on("error", () => resolve("error"));
  });
  try {
    assert.match(await connect("127.0.0.1:443"), /403/);
    assert.match(await connect("10.0.0.1:443"), /403/);
    assert.match(await connect("example.com:22"), /403/);
  } finally {
    await proxy.close();
  }
});

test("soundtrack clamps hostile cue values instead of hanging or allocating gigabytes", () => {
  for (const cue of [{ bpm: -120, seconds: 5 }, { bpm: Infinity, seconds: 3 }, { bpm: 1e6, seconds: 3 }, { bpm: 120, seconds: -5 }, { bpm: 120, seconds: 1e6, cuts: "x" }]) {
    const { L } = synthesize(cue);
    assert.ok(L.length > 0 && L.length <= 180 * 44100, JSON.stringify(cue));
  }
});

test("links: balanced parentheses kept, one entry per page, local and credentialed links dropped; digest slugs never collide", () => {
  const { linksOf } = require("../src/factory/sources");
  assert.deepEqual(
    linksOf("[w](https://en.wikipedia.org/wiki/Rust_(programming_language)). https://github.com/foo/bar and https://GitHub.com/foo/bar/ and https://www.example.com/a_b_ and http://localhost:3000/x and https://u:p@evil.com/"),
    ["https://github.com/foo/bar", "https://en.wikipedia.org/wiki/Rust_(programming_language)", "https://www.example.com/a_b_"],
  );
  const md = (t) => `### ${t}\n\n${"word ".repeat(70)}\n`;
  const items = fromDigest(`${md("Very long title about rust async runtimes and more")}---\n${md("Very long title about rust async runtimes and less")}`, { topic: "Artificial Intelligence and Machine Learning" });
  assert.equal(items.length, 2);
  assert.notEqual(items[0].slug, items[1].slug);
});

test("resolveBin handles absolute, quoted and extensionless claude paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-bin2-"));
  try {
    const exe = path.join(dir, "claude.exe");
    fs.writeFileSync(exe, "");
    assert.equal(opus.resolveBin(path.join(dir, "claude"), { platform: "win32", pathEnv: "" }), exe, "absolute without extension");
    assert.equal(opus.resolveBin(`"${exe}"`, { platform: "win32", pathEnv: "" }), exe, "quoted");
    assert.equal(opus.resolveBin("claude", { platform: "win32", pathEnv: `"${dir}"` }), exe, "quoted PATH entry");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- voice (ElevenLabs main, OpenRouter fallback)

test("voice: alignment becomes word timings (tags echoed or not); a mismatch falls back to estimates", () => {
  const voice = require("../src/factory/voice");
  const expected = voice.wordsOf("[curious] Hello there. [pause] Bye");
  assert.deepEqual(expected, ["Hello", "there.", "Bye"]);
  const align = (s) => ({ characters: [...s], character_start_times_seconds: [...s].map((_, i) => i * 0.1), character_end_times_seconds: [...s].map((_, i) => i * 0.1 + 0.08) });
  for (const said of ["Hello there. Bye", "[curious] Hello there. [pause] Bye"]) {
    const words = voice.wordsFromAlignment(align(said), expected);
    assert.equal(words.length, 3, said);
    assert.ok(words.every((w, i) => w.end >= w.start && (i === 0 || w.start >= words[i - 1].end)), "ordered, non-overlapping");
  }
  assert.equal(voice.wordsFromAlignment(align("Hello there"), expected), null, "a word-count mismatch is not trusted");
  const est = voice.estimateWords(["One.", "two", "three,", "four"], 0.5, 4.5);
  assert.ok(est[0].start >= 0.5 && est[3].end <= 4.5 && est.every((w, i) => i === 0 || w.start >= est[i - 1].end));
  const script = [{ scene: 1, text: "[curious] Hello there." }, { scene: 3, text: "Bye" }];
  assert.deepEqual(voice.sceneWindows(script, [{ start: 0, end: 0.3 }, { start: 0.4, end: 0.9 }, { start: 1.2, end: 1.5 }]).map((s) => [s.scene, s.start, s.end]), [[1, 0, 0.9], [3, 1.2, 1.5]]);
  assert.ok(voice.similarity("Mobile sockets die silently.", "Mobile sockets die silently") > 0.99);
  assert.ok(voice.similarity("Mobile sockets die silently.", "I'm here to help you understand what's going on with mobile sockets") < 0.5, "a reply instead of a read fails");
});

test("voice gates: word budget per scene, well-formed tags, no SSML, and the same facts as the screen", () => {
  const config = require("../config");
  const base = () => { const sb = structuredClone(reelOf(FIXTURE)); delete sb.scenes[0].emphasis; return sb; };
  const errs = (mut, opts) => { const sb = base(); mut(sb); return validate(sb, ARTICLE, "reel", opts).join("\n"); };
  assert.equal(errs((sb) => { sb.scenes[0].voiceover = "[curious] Your struct is secretly bigger than you think."; }), "");
  assert.match(errs((sb) => { sb.scenes[0].voiceover = "word ".repeat(40); }), /voiceover is 40 words; this scene can carry/);
  assert.match(errs((sb) => { sb.scenes[0].voiceover = "[a] [b] [c] [d] Hello"; }), /at most 3 audio tags/);
  assert.match(errs((sb) => { sb.scenes[0].voiceover = "[whisper 2x louder] Hello"; }), /may not contain numbers/);
  assert.match(errs((sb) => { sb.scenes[0].voiceover = "Hello <break time=\"1s\"/> there"; }), /SSML or a broken \[tag\]/);
  assert.match(errs((sb) => { sb.scenes[0].voiceover = "It costs 9000 bytes [pause"; }), /SSML or a broken \[tag\]/);
  assert.match(errs((sb) => { sb.scenes[1].voiceover = "It saves 4096 cycles every call."; }), /not in the article: 4096/, "the voice cannot claim a number the article lacks");
  assert.match(errs((sb) => { sb.scenes[1].voiceover = "A revolutionary fix."; }), /Remove these words: revolutionary/);
  assert.match(errs((sb) => { sb.scenes[1].voiceover = "Nice \u{1F680}"; }), /No emojis in the voiceover/);
  assert.equal(errs((sb) => { sb.scenes[1].voiceover = "This line is spoken, not shown, so averyveryverylongwordthatwouldoverflow is fine."; }).includes("too long for on-screen type"), false, "voiceover is not on-screen type");
  // A narrated (agent) reel needs a spoken hook and enough words; template reels have no voice,
  // and neither does any reel when no provider key is set.
  const saved = { enabled: config.factory.voice.enabled, key: config.factory.voice.elevenlabsKey };
  try {
    Object.assign(config.factory.voice, { enabled: true, elevenlabsKey: "test-key" });
    const art = { ...ARTICLE, assets: [{ id: "page1-desktop", kind: "desktop", url: "https://github.com/Drix10/Grind" }] };
    const agent = (mut) => { const sb = agentReel(); mut(sb); return validate(sb, art, "reel", { mode: "agent" }).join("\n"); };
    assert.match(agent((sb) => { delete sb.scenes[0].voiceover; }), /The hook needs a voiceover line/);
    assert.equal(errs(() => {}, { mode: "template" }), "");
    config.factory.voice.elevenlabsKey = "";
    assert.equal(agent((sb) => { for (const sc of sb.scenes) delete sc.voiceover; }), "", "no provider: nothing to narrate with");
  } finally {
    Object.assign(config.factory.voice, { enabled: saved.enabled, elevenlabsKey: saved.key });
  }
});

test("voice: ElevenLabs first (falling back across models on refusal), exact timings; no key and no fallback means music only", async () => {
  const config = require("../config");
  const voice = require("../src/factory/voice");
  const v = config.factory.voice;
  const saved = { ...v, fetch: global.fetch, orKey: config.llm.openrouter.apiKey };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-voice-"));
  const mp3 = path.join(dir, "tone.mp3");
  require("child_process").spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=f=220:d=1.2", "-c:a", "libmp3lame", mp3]);
  const nonce = `n${Date.now()}`;
  const line = `Hello ${nonce} world.`;
  const sb = { scenes: [{ type: "hook", beats: 6, text: "x", voiceover: `[curious] ${line}` }, { type: "cta", beats: 6, text: "x" }] };
  const calls = [];
  try {
    Object.assign(v, { enabled: true, elevenlabsKey: "test-key", model: "eleven_v4", fallbackModels: ["eleven_v3"] });
    global.fetch = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url: String(url), model: body.model_id, key: init.headers["xi-api-key"] });
      if (body.model_id === "eleven_v4") return new Response("model not available", { status: 400 });
      const chars = [...body.text];
      return new Response(JSON.stringify({ audio_base64: fs.readFileSync(mp3).toString("base64"), alignment: { characters: chars, character_start_times_seconds: chars.map((_, i) => i * 0.03), character_end_times_seconds: chars.map((_, i) => i * 0.03 + 0.02) } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const out = await voice.synthesizeVoice(sb, dir);
    assert.deepEqual(calls.map((c) => c.model), ["eleven_v4", "eleven_v3"], "a refused model falls back to the next, without retrying a 400");
    assert.ok(calls.every((c) => c.key === "test-key" && /\/v1\/text-to-speech\/[^/]+\/with-timestamps\?output_format=mp3_44100_128$/.test(c.url)));
    assert.equal(out.provider, "elevenlabs");
    assert.equal(out.model, "eleven_v3");
    assert.equal(out.approximate, false, "ElevenLabs alignment gives exact timings");
    assert.deepEqual(out.words.map((w) => w.w), ["Hello", nonce, "world."]);
    assert.deepEqual(out.scenes.map((s) => s.scene), [1], "scenes without a voiceover line are silent");
    assert.ok(fs.existsSync(path.join(dir, "voice.wav")) && fs.existsSync(path.join(dir, "voice.json")));
    // Cached: the same script never pays twice.
    calls.length = 0;
    await voice.synthesizeVoice(sb, dir);
    assert.equal(calls.length, 0);

    Object.assign(v, { elevenlabsKey: "" });
    config.llm.openrouter.apiKey = "";
    assert.equal(await voice.synthesizeVoice({ scenes: [{ type: "hook", beats: 6, text: "x", voiceover: `Other ${nonce}` }] }, dir), null);
    Object.assign(v, { enabled: false });
    assert.equal(await voice.synthesizeVoice(sb, dir), null, "FACTORY_VOICE=off");
  } finally {
    Object.assign(v, { enabled: saved.enabled, elevenlabsKey: saved.elevenlabsKey, model: saved.model, fallbackModels: saved.fallbackModels });
    global.fetch = saved.fetch;
    config.llm.openrouter.apiKey = saved.orKey;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("voice mix: voice over ducked music, mastered near -14 LUFS, as long as the film", () => {
  const { voiceMixArgs } = require("../src/factory/voice");
  const { ffmpeg } = require("../src/factory/render");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-mix-"));
  try {
    const f = (n) => path.join(dir, n);
    ffmpeg(["-f", "lavfi", "-i", "color=c=black:s=320x568:d=3:r=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", f("v.mp4")]);
    ffmpeg(["-f", "lavfi", "-i", "sine=f=110:d=3", "-ar", "48000", f("m.wav")]);
    ffmpeg(["-f", "lavfi", "-i", "sine=f=440:d=1.5", "-ar", "48000", "-ac", "1", f("vo.wav")]);
    ffmpeg(voiceMixArgs({ video: f("v.mp4"), music: f("m.wav"), voice: f("vo.wav"), out: f("out.mp4") }));
    const probe = require("child_process").spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type:format=duration", "-of", "json", f("out.mp4")], { encoding: "utf8" });
    const info = JSON.parse(probe.stdout);
    assert.deepEqual(info.streams.map((s) => s.codec_type).sort(), ["audio", "video"]);
    assert.ok(Math.abs(Number(info.format.duration) - 3) < 0.15, `duration ${info.format.duration}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("editor: picks for virality and orders the runner-ups by viral score", async () => {
  const editor = require("../src/factory/editor");
  const item = (t) => ({ title: t, text: `${t} `.repeat(70), slug: t, origin: `x#${t}`, links: [] });
  const list = [item("a"), item("b"), item("c"), item("d")];
  const saved = opus.ask;
  let prompt = "";
  try {
    opus.ask = async (o) => { prompt = o.prompt; return JSON.stringify({ scores: [{ n: 1, viral: 3 }, { n: 2, viral: 9 }, { n: 3, viral: 5 }, { n: 4, viral: 8 }], pick: 2, why: "myth broken" }); };
    const order = await editor.pickStory(list);
    const ranked = rankSources(list).map((a) => a.title);
    assert.equal(order[0].title, ranked[1], "the pick comes first");
    assert.deepEqual(order.slice(1).map((a) => a.title), [ranked[3], ranked[2], ranked[0]], "then by viral score");
    for (const k of ["STOP", "STAKES", "PROOF", "REACH", "NOW", "SHARE", "SHOW"]) assert.match(prompt, new RegExp(`- ${k}:`));
  } finally {
    opus.ask = saved;
  }
});

test("claude -p: a long non-stream reply is parsed whole, a stream reply keeps only what it needs", async () => {
  const big = "x".repeat(30000);
  const fake = (code) => [process.execPath, ["-e", code]];
  const [bin, args] = fake(`process.stdout.write(JSON.stringify({ type: "result", result: ${JSON.stringify(big)}, usage: { input_tokens: 1, output_tokens: 2 } }))`);
  const r = await opus.runClaude(args, { input: "", cwd: os.tmpdir(), timeoutMs: 20000, bin });
  assert.equal(r.text.length, 30000, "the result, not the last 20k chars of the JSON envelope");
  assert.ok(r.raw);
  const [bin2, args2] = fake(`for (let i = 0; i < 50; i++) console.log(JSON.stringify({ type: "assistant", pad: "y".repeat(2000) })); console.log(JSON.stringify({ type: "result", result: "DONE" }))`);
  const s = await opus.runClaude([...args2, "--", "--output-format", "json"], { input: "", cwd: os.tmpdir(), timeoutMs: 20000, stream: true, bin: bin2 });
  assert.equal(s.text, "DONE");
  // An early exit before the prompt is read must reject, not crash the process.
  const [bin3, args3] = fake("process.exit(3)");
  await assert.rejects(opus.runClaude(args3, { input: "z".repeat(5 * 1024 * 1024), cwd: os.tmpdir(), timeoutMs: 20000, bin: bin3 }), /exited 3/);
});

// ---------------------------------------------------------------- hardening, round 2

test("voice read check: a cut-off read, a noise tail and a gap fail; a whisper and a full read pass", () => {
  const { analyzeLevels } = require("../src/factory/voice");
  const speech = (sec, db = -20) => Array.from({ length: Math.round(sec / 0.05) }, (_, i) => db + (i % 7) - 3);
  const quiet = (sec, db = -70) => Array.from({ length: Math.round(sec / 0.05) }, () => db);
  // 12 words read in full (~4.3 s of speech), then silence.
  const full = analyzeLevels([...quiet(0.3), ...speech(4.3), ...quiet(2)], 12);
  assert.ok(full.ok, full.reason);
  assert.ok(full.start >= 0.2 && full.start <= 0.3, `leading silence trimmed (${full.start})`);
  assert.ok(full.end > 4.4 && full.end < 4.8, `ends at the speech (${full.end})`);
  // The same 12 words stopping after 1.5 s: not a full read.
  assert.equal(analyzeLevels([...speech(1.5), ...quiet(3)], 12).ok, false);
  // A whisper at -40 dBFS is speech relative to its own peak.
  assert.ok(analyzeLevels([...speech(4.3, -40), ...quiet(1)], 12).ok);
  // Speech, a 2 s hole, more speech: the model lost its place.
  assert.match(String(analyzeLevels([...speech(1.6), ...quiet(2), ...speech(2.5)], 12).reason), /gap mid-read/);
  // A noise bed after the speech never makes the clip longer than a slow natural read.
  const noisy = analyzeLevels([...speech(4.3), ...speech(6, -30)], 12);
  assert.ok(noisy.end <= 12 / 1.9 + 0.9, `capped (${noisy.end})`);
});

test("voice: read similarity survives numbers, units and acronyms; a reply instead of a read fails", () => {
  const { similarity } = require("../src/factory/voice");
  assert.ok(similarity("Shipped in 2024 and nobody noticed the padding.", "Shipped in two thousand twenty-four and nobody noticed the padding") > 0.95);
  assert.ok(similarity("It took 800ms over gRPC and HTTP/2.", "It took 800 milliseconds over G R P C and HTTP 2") > 0.8);
  assert.ok(similarity("9,000 requests a second.", "9000 requests a second") > 0.95);
  assert.ok(similarity("Your mobile socket is already dead.", "I'm here to help you understand what's going on with your mobile socket today and what to do next") < 0.6);
});

test("voice: refusals by cause, tags only for models that perform them, stability snapped for v3/v4", () => {
  const voice = require("../src/factory/voice");
  const err = (status, message) => Object.assign(new Error(message), { status });
  assert.deepEqual(voice.refusalOf(err(401, "invalid_api_key")), { scope: "provider", ms: 6 * 3600 * 1000 });
  assert.equal(voice.refusalOf(err(401, "quota_exceeded: out of credits")), null, "out of credits: try again next reel");
  assert.equal(voice.refusalOf(err(402, "payment required")), null);
  assert.deepEqual(voice.refusalOf(err(422, "model eleven_v4 is not available")), { scope: "model", ms: 24 * 3600 * 1000 });
  assert.equal(voice.refusalOf(err(400, "text too long")), null, "a script-specific error blocks nothing");
  assert.equal(voice.refusalOf(err(503, "busy")), null);
  assert.equal(voice.untagged("[curious] Wait. [pause] Really? [whispers] yes"), "Wait. ... Really? yes");
  assert.ok(voice.TAG_MODELS.test("eleven_v4") && voice.TAG_MODELS.test("eleven_v3") && !voice.TAG_MODELS.test("eleven_multilingual_v2"));
  assert.equal(voice.stabilityFor("eleven_v3", 0.3), 0.5);
  assert.equal(voice.stabilityFor("eleven_v4", 0.1), 0);
  assert.equal(voice.stabilityFor("eleven_multilingual_v2", 0.3), 0.3);
  // A tag glued to words still ends the word before it.
  assert.equal(voice.wordsFromAlignment({ characters: [..."Wait[pause]what"], character_start_times_seconds: Array(15).fill(0).map((_, i) => i / 10), character_end_times_seconds: Array(15).fill(0).map((_, i) => i / 10 + 0.05) }, ["Wait", "what"]).length, 2);
});

test("voice fallback stream: an in-stream error is an error; a last event without a newline still counts", async () => {
  const { openrouterSpeech } = require("../src/factory/voice");
  const saved = global.fetch;
  const sse = (body) => async () => new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  const opts = { model: "m", voice: "v", apiKey: "k", baseUrl: "https://example.invalid", delivery: "d" };
  try {
    global.fetch = sse(`data: {"error":{"message":"insufficient credits","code":402}}\n\n`);
    await assert.rejects(openrouterSpeech("Hello there", opts, 5000), (e) => e.status === 402 && /insufficient credits/.test(e.message));
    const pcm = Buffer.alloc(4800).toString("base64");
    global.fetch = sse(`data: {"choices":[{"delta":{"audio":{"transcript":"Hello"}}}]}\r\n\r\ndata:{"choices":[{"delta":{"audio":{"data":"${pcm}","transcript":" there"}}}]}`);
    const got = await openrouterSpeech("Hello there", opts, 5000);
    assert.equal(got.transcript, "Hello there");
    assert.equal(got.audio.length, 4800);
  } finally {
    global.fetch = saved;
  }
});

test("inbox: a run's stories survive a skipped pass for 36 h and are not duplicated", () => {
  const editor = require("../src/factory/editor");
  const item = (o) => ({ title: o, text: "x ".repeat(80), slug: o, origin: `digest#${o}` });
  const t0 = 1_800_000_000_000;
  editor.rememberRun([item("a"), item("b")], { now: t0 });
  editor.rememberRun([item("b"), item("c")], { now: t0 + 3600e3 });
  const later = editor.freshSources([], { now: t0 + 24 * 3600e3 }).fresh.map((a) => a.origin).filter((o) => o.startsWith("digest#"));
  assert.deepEqual(later.sort(), ["digest#a", "digest#b", "digest#c"]);
  const expired = editor.freshSources([], { now: t0 + 36.5 * 3600e3 }).fresh.filter((a) => a.origin.startsWith("digest#"));
  assert.deepEqual(expired.map((a) => a.origin), ["digest#c"], "older than 36 h is gone");
});

test("lock: an unreadable lock is only taken over when the file is old; infra failures are not story failures", () => {
  const { tryAcquire, FILE, STALE_MS } = require("../src/factory/lock");
  fs.rmSync(FILE, { force: true });
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, "{ half-writ");
  assert.equal(tryAcquire("t"), false, "a fresh, half-written lock is someone's");
  const old = (Date.now() - STALE_MS - 60000) / 1000;
  fs.utimesSync(FILE, old, old);
  assert.equal(tryAcquire("t"), true, "an old unreadable lock is stale");
  fs.rmSync(FILE, { force: true });
  const { isInfraFailure } = require("../src/factory/index");
  assert.ok(isInfraFailure({ code: "ABORTED" }));
  assert.ok(isInfraFailure(new Error("Claude usage limit reached; resets at 5pm")));
  assert.ok(!isInfraFailure(new Error("Storyboard failed the gates twice")));
});

test("pruning old jobs keeps the shared node_modules behind a workspace junction", () => {
  const { pruneState } = require("../src/factory/index");
  const queue = require("../src/factory/queue");
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "factory-shared-nm-"));
  fs.writeFileSync(path.join(shared, "keep.txt"), "do not delete");
  const job = path.join(queue.STATE_DIR, "jobs", "2020-01-01-reel-old");
  const ws = path.join(job, "agent-remotion");
  try {
    fs.mkdirSync(path.join(ws, "out"), { recursive: true });
    fs.symlinkSync(shared, path.join(ws, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    fs.writeFileSync(path.join(job, "reel.mp4"), "film");
    fs.writeFileSync(path.join(job, "agent.log"), "log");
    const old = (Date.now() - 30 * 24 * 3600e3) / 1000;
    fs.utimesSync(job, old, old);
    pruneState();
    assert.ok(fs.existsSync(path.join(shared, "keep.txt")), "the junction target survives");
    assert.ok(!fs.existsSync(ws), "the workspace is gone");
    assert.ok(!fs.existsSync(path.join(job, "agent.log")));
    assert.ok(fs.existsSync(path.join(job, "reel.mp4")), "the finished piece stays");
  } finally {
    fs.rmSync(job, { recursive: true, force: true });
    fs.rmSync(shared, { recursive: true, force: true });
  }
});
