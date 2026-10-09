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

test("hype words, bad structure, long copy and the removed plate scene are rejected", () => {
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes[0].text = "Unlock the hidden 32 bytes";
  sb.scenes.push({ type: "hook", beats: 2, text: "x" });
  sb.scenes[1].headline = "x".repeat(70);
  sb.scenes.splice(2, 0, { type: "plate", beats: 4, plate: "p1", headline: "Old image scene" });
  const errs = validate(sb, ARTICLE, "reel").join("\n");
  assert.match(errs, /unlock/);
  assert.match(errs, /plate/);
  assert.match(errs, /last scene must be a cta/);
  assert.match(errs, /headline is 70 chars/);
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
  await assert.rejects(shootOne("http://127.0.0.1:8080/", "x.jpg"), /local host|blocked/);
  await assert.rejects(shootOne("http://localhost/", "x.jpg"), /local host|blocked/);
});

test("editor: fresh run material only (archive is the fallback), Opus picks one, deep dive folds in linked pages", async () => {
  const editor = require("../src/factory/editor");
  const item = (t, n) => ({ title: t, text: `${t} `.repeat(n), slug: t, origin: `x#${t}`, links: [] });
  const run = [item("vague", 30), item("concrete", 90)];
  const { fresh, fallback } = editor.freshSources(run, { now: Number.MAX_SAFE_INTEGER });
  assert.equal(fresh.length, 2);
  assert.deepEqual(fallback, []);
  assert.ok(editor.freshSources([], { now: Number.MAX_SAFE_INTEGER }).fallback.length > 0, "no fresh material falls back to the archive");

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
  const sb = structuredClone(reelOf(FIXTURE));
  sb.scenes[3] = { type: "stat", beats: 6, value: 4096, label: "connections per node" };
  assert.ok(validate(sb, ARTICLE, "reel").some((e) => /4096/.test(e)), "not in the article alone");
  assert.ok(!validate(sb, deep, "reel").some((e) => /4096/.test(e)), "allowed once the linked page says it");
});
