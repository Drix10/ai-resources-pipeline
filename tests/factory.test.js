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
const ARTICLE = fromInsight(path.join(ROOT, "LinkedIn Insights/c-struct-padding-why-your-16-byte-payload-becomes--1790208355844.md"));
const reelOf = (sb) => ({ ...sb, slides: [] });
const carouselOf = (sb) => ({ ...sb, format: "carousel", scenes: [] });

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
  const twin = fromInsight(path.join(ROOT, "LinkedIn Insights/why-careless-struct-member-ordering-turns-a-16-byt-1789680166457.md"));
  const other = fromInsight(path.join(ROOT, "LinkedIn Insights/the-hidden-knobs-of-vector-search-tuning-1788869383457.md"));
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
  const long = { title: "Long one", why: "w", prompt: "x".repeat(20000), promptFile: "/lib/long/prompt.md", repoDir: "/lib/repos/long" };
  const p = heroPrompt({ storyboard: reelOf(FIXTURE), article: ARTICLE, references: [long], catalog, engine: "remotion", skills: [], avoid: "" });
  assert.match(p, /REFERENCE LIBRARY \(read access: /);
  assert.match(p, /continues: read \/lib\/long\/prompt\.md/);
  assert.match(p, /Code you may read for technique: \/lib\/repos\/long/);
  assert.ok(!/PLATES \(|public\/plates|staticFile\("plates/.test(p), "no image plates left in the agent prompt");
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
  assert.match(p, /page1-desktop \(desktop, 2160x1350\)/);
  assert.match(p, /staticFile\("assets\/<id>\.jpg"\)/);
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
  const recentInsight = editor.freshSources([], { now: 1790536700285 + 3600 * 1000 }).fresh;
  assert.ok(recentInsight.some((a) => /1790536700285/.test(a.origin)), "an Insight written an hour ago is fresh");

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
