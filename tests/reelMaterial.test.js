const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { validate } = require("../src/factory/storyboard");
const { fromInsight, fromDigest, postOf, mediaOf } = require("../src/factory/sources");
const { queryOf, photoQueryOf, mixkitSlugs, bestFile, creditsOf, SEARCHERS } = require("../src/factory/stock");
const { composeCaption } = require("../src/factory/instagram");
const config = require("../config");

const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, "factory/fixtures/struct-padding.json"), "utf8"));
const ARTICLE = fromInsight(path.join(ROOT, "factory/fixtures/insights/c-struct-padding-why-your-16-byte-payload-becomes--1790208355844.md"));

// An agent reel: narrated, 37 s at 120 bpm, a real visual for every scene, headlines of <= 6 words.
const agentReel = () => ({
  ...FIXTURE,
  slides: [],
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

const ART = { ...ARTICLE, assets: [{ id: "page1-desktop", kind: "desktop", url: "https://github.com/Drix10/Grind" }] };

function withVoice(fn) {
  const saved = { enabled: config.factory.voice.enabled, key: config.factory.voice.elevenlabsKey };
  Object.assign(config.factory.voice, { enabled: true, elevenlabsKey: "test-key" });
  try { return fn(); } finally { Object.assign(config.factory.voice, { enabled: saved.enabled, elevenlabsKey: saved.key }); }
}

test("agent reels: 32-50 s, headline-length copy, a real visual for every scene, every scene narrated", () => withVoice(() => {
  const errs = (mut = () => {}, art = ART) => { const sb = agentReel(); mut(sb); return validate(sb, art, "reel", { mode: "agent" }).join("\n"); };
  assert.equal(errs(), "", "the fixture passes");
  assert.match(errs((sb) => { sb.scenes[1].headline = "Double the L1 cache misses every call."; }), /headline is 7 words; on-screen lines are at most 6/);
  assert.match(errs((sb) => { delete sb.scenes[2].visual; }), /needs "visual"/);
  assert.match(errs((sb) => { sb.scenes[1].visual.use = "page9-desktop"; }), /must be a REAL MATERIAL id \(page1-desktop\)/);
  assert.match(errs((sb) => { sb.scenes[0].visual.use = "graphic"; }), /The hook must open on real material/);
  assert.match(errs((sb) => { for (const s of sb.scenes.slice(3)) s.visual.use = "graphic"; }), /scenes are "graphic"; at most 2/);
  assert.match(errs((sb) => { sb.scenes[1].visual.use = "stock: a long search that goes on and on"; }), /the stock search is 8 words/);
  assert.match(errs((sb) => { delete sb.scenes[4].voiceover; }), /Scene\(s\) 5 have no voiceover/);
  assert.match(errs((sb) => { sb.scenes[0].voiceover = `[curious] [slowly] ${sb.scenes[0].voiceover}`; }), /at most 1 audio tag per scene/);
  assert.match(errs((sb) => { sb.scenes = sb.scenes.map((s) => ({ ...s, beats: 6 })); }), /add up to 21\.0 s/);
  const withPost = { ...ART, assets: [...ART.assets, { id: "post", kind: "post", url: "https://x.com/a/status/1" }, { id: "post-video1", kind: "post-video", url: "https://video.twimg.com/a.mp4" }] };
  assert.match(errs(() => {}, withPost), /The source post is in REAL MATERIAL: show it \(post, post-video1\) in one scene/);
  assert.equal(errs((sb) => { sb.scenes[0].visual.use = "post-video1"; }, withPost), "", "the post's own video puts the source on screen");
  assert.match(errs((sb) => { sb.hashtags = ["#aa", "#bb", "#cc", "#dd", "#ee", "#ff"]; }), /3-5 hashtags/);
  assert.match(errs((sb) => { sb.scenes[3].voiceover = "It costs 9999 cycles."; }), /not in the article: 9999/, "the voice is fact-checked like the screen");
  // The visual plan is direction, not on-screen copy: its words are not fact-checked or length-gated.
  assert.equal(errs((sb) => { sb.scenes[1].visual.show = "The repo page at 400% zoom, averyveryverylongwordthatwouldoverflow"; }), "");
}));

test("template reels keep their own spec (no visuals, 17-28 s)", () => {
  assert.deepEqual(validate({ ...FIXTURE, slides: [] }, ARTICLE, "reel"), []);
});

test("digest items keep the X post they came from and its photos, at full size", () => {
  assert.deepEqual(postOf("- [Original post](https://x.com/jd_pressman/status/2104734007590289720)"), { url: "https://x.com/jd_pressman/status/2104734007590289720", user: "jd_pressman", id: "2104734007590289720" });
  assert.deepEqual(postOf("https://twitter.com/a_b/status/12345?s=20"), { url: "https://x.com/a_b/status/12345", user: "a_b", id: "12345" });
  assert.equal(postOf("[profile](https://x.com/jd_pressman)"), null, "a profile link is not a post");
  assert.deepEqual(mediaOf("![Image](https://pbs.twimg.com/media/HUNs0QTX0AAkODL?format=jpg&name=small)\n![x](https://pbs.twimg.com/media/HUNs0QTX0AAkODL?format=jpg&name=small)\n![y](https://evil.example.com/a.jpg)"),
    ["https://pbs.twimg.com/media/HUNs0QTX0AAkODL?format=jpg&name=large"], "deduplicated, upgraded to large, twimg only");
  const md = `### 🤖 Agent loops cost 100x\n\nScoring 21 bids with an agent loop cost $1.58 while a single structured call scored 268 bids for $0.19. ${"The loop re-reads its own context on every turn. ".repeat(8)}\n\n![Image](https://pbs.twimg.com/media/ABC123?format=jpg&name=small)\n\n🔗 Resources:\n\n- [Original post](https://x.com/someone/status/2108648698150302043)\n- [Docs](https://docs.example.com/guide)\n`;
  const [item] = fromDigest(md, { topic: "AI" });
  assert.deepEqual(item.post, { url: "https://x.com/someone/status/2108648698150302043", user: "someone", id: "2108648698150302043" });
  assert.deepEqual(item.media, ["https://pbs.twimg.com/media/ABC123?format=jpg&name=large"]);
  assert.deepEqual(item.links, ["https://docs.example.com/guide"], "x.com stays out of the page links");
});

test("stock: search terms are parsed, the best file fills a 1080x1920 frame, CC BY needs a credit", async () => {
  assert.equal(queryOf("stock: server racks in a data center"), "server racks in a data center");
  assert.equal(queryOf("Stock:  rainy street, night!"), "rainy street night");
  assert.equal(queryOf("graphic"), "");
  assert.equal(queryOf("stock: x"), "");
  assert.equal(queryOf(`stock: ${"word ".repeat(20)}`), "", "an over-long search is no search");
  const files = [
    { link: "a", width: 3840, height: 2160, file_type: "video/mp4" },
    { link: "b", width: 1920, height: 1080, file_type: "video/mp4" },
    { link: "c", width: 1080, height: 1920, file_type: "video/mp4" },
    { link: "d", width: 2160, height: 3840, file_type: "video/mp4" },
  ];
  assert.equal(bestFile(files).link, "c", "portrait HD beats 4K and landscape");
  assert.equal(bestFile(files.slice(0, 2)).link, "b", "landscape HD beats 4K");
  const saved = global.fetch;
  try {
    global.fetch = async () => new Response(JSON.stringify({ results: [
      { url: "https://live.staticflickr.com/1/a.jpg", width: 2000, height: 3000, license: "by", license_version: "2.0", title: "Racks", creator: "jane", foreign_landing_url: "https://flickr.com/p/1" },
      { url: "https://upload.wikimedia.org/b.jpg", width: 2400, height: 1600, license: "cc0", title: "Chip" },
      { url: "https://x/small.jpg", width: 300, height: 200, license: "by" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } });
    const got = await SEARCHERS.openversePhoto("server racks");
    assert.equal(got.length, 2, "too-small images are dropped");
    assert.equal(got[0].credit, "\"Racks\" by jane, CC BY 2.0");
    assert.equal(got[1].credit, null, "CC0 needs no credit");
    assert.deepEqual(creditsOf([{ credit: got[0].credit }, { credit: got[0].credit }, { credit: null }]), ["\"Racks\" by jane, CC BY 2.0"]);
  } finally {
    global.fetch = saved;
  }
});

test("a scene can ask for a real photo of a named person or thing", () => withVoice(() => {
  const errs = (use) => { const sb = agentReel(); sb.scenes[4].visual.use = use; return validate(sb, ART, "reel", { mode: "agent" }).join("\n"); };
  assert.equal(errs("photo: Jensen Huang"), "");
  assert.equal(photoQueryOf("photo: TSMC fab, Taiwan!"), "TSMC fab Taiwan");
  assert.match(errs("photo: the very long name of a thing nobody can find"), /the photo search is 10 words/);
  assert.match(errs("picture: Jensen Huang"), /"photo: <named person, company, product or place>"/);
}));

test("open-web sources: Mixkit tag slugs, Commons credits, the post's own video", async () => {
  assert.deepEqual(mixkitSlugs("server racks in a data center"), ["server-racks-in-a-data-center", "data-center", "server-racks", "center"]);
  assert.deepEqual(mixkitSlugs("typing"), ["typing"]);
  const saved = global.fetch;
  try {
    global.fetch = async (url) => {
      assert.match(String(url), /commons\.wikimedia\.org\/w\/api\.php\?.*gsrsearch=Jensen%20Huang%20filetype%3Abitmap/);
      return new Response(JSON.stringify({ query: { pages: {
        2: { index: 2, title: "File:B.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/b-1600.jpg", width: 3888, height: 5184, thumbwidth: 1600, thumbheight: 2133, descriptionurl: "https://commons.wikimedia.org/wiki/File:B.jpg", extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<a href=\"x\">Anders</a>" } } }] },
        1: { index: 1, title: "File:A.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/a-1600.jpg", width: 4000, height: 3000, thumbwidth: 1600, thumbheight: 1200, extmetadata: { LicenseShortName: { value: "Public domain" }, Artist: { value: "NASA" } } }] },
        3: { index: 3, title: "File:C.svg", imageinfo: [{ mime: "image/svg+xml", thumburl: "https://upload.wikimedia.org/c.png", thumbwidth: 1600, thumbheight: 900, extmetadata: {} }] },
      } } }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    const got = await SEARCHERS.commonsPhoto("Jensen Huang");
    assert.deepEqual(got.map((c) => c.src), ["https://upload.wikimedia.org/a-1600.jpg", "https://upload.wikimedia.org/b-1600.jpg"], "search order kept, drawings dropped");
    assert.equal(got[0].credit, null, "public domain needs no credit");
    assert.equal(got[1].credit, "Anders (CC BY-SA 4.0, Wikimedia Commons)");
  } finally {
    global.fetch = saved;
  }
  const { bestPostVariant, syndicationToken } = require("../src/factory/assets");
  const info = { duration_millis: 62833, variants: [
    { content_type: "application/x-mpegURL", url: "https://video.twimg.com/a.m3u8" },
    { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/360.mp4" },
    { content_type: "video/mp4", bitrate: 2176000, url: "https://video.twimg.com/720.mp4" },
    { content_type: "video/mp4", bitrate: 10368000, url: "https://video.twimg.com/1080.mp4" },
  ] };
  assert.equal(bestPostVariant(info).url, "https://video.twimg.com/1080.mp4", "the sharpest that fits");
  assert.equal(bestPostVariant(info, 40 * 1024 * 1024).url, "https://video.twimg.com/720.mp4", "a long 1080p clip over the cap steps down");
  assert.equal(bestPostVariant({ variants: [{ content_type: "application/x-mpegURL", url: "x" }] }), null, "no MP4, no video");
  assert.match(syndicationToken("2108648698150302043"), /^[a-z0-9]+$/);
});

test("stock from an earlier storyboard of the job is reused only for the same request", async () => {
  const { fetchStock } = require("../src/factory/stock");
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stock-"));
  fs.mkdirSync(path.join(dir, "assets"));
  const file = (n) => { const f = path.join(dir, "assets", n); fs.writeFileSync(f, "x"); return f; };
  const assets = [
    { id: "post", kind: "post", url: "https://x.com/a/status/1", file: file("post.png") },
    { id: "stock-2", kind: "stock-video", query: "server racks", url: "https://assets.mixkit.co/a.mp4", file: file("stock-2.mp4") },
    { id: "stock-3", kind: "stock-photo", query: "captcha on laptop screen", url: "https://upload.wikimedia.org/b.jpg", credit: "B (CC BY 2.0, Wikimedia Commons)", file: file("stock-3.jpg") },
  ];
  const saved = { stock: config.factory.stock };
  config.factory.stock = { mixkit: false, commons: false, openverse: false };
  try {
    const sb = { scenes: [{ visual: { use: "post" } }, { visual: { use: "stock: server racks" } }, { visual: { use: "stock: scrolling job applications" } }] };
    const out = await fetchStock(sb, dir, assets);
    assert.deepEqual(out.map((a) => a.id), ["post", "stock-2"], "the same request keeps its clip; a different one drops the old file");
    assert.ok(!fs.existsSync(assets[2].file), "the stale file is gone, so its credit cannot leak into the caption");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "assets", "assets.json"), "utf8")).map((a) => a.id), ["post", "stock-2"]);
  } finally {
    config.factory.stock = saved.stock;
  }
});

test("the film agent is one headless run: no background renders, no waiting for a later turn", () => {
  const { heroPrompt, DISALLOWED_TOOLS } = require("../src/factory/hero");
  const p = heroPrompt({ storyboard: { ...FIXTURE, slides: [] }, article: ARTICLE, references: [], engine: "remotion", skills: [], avoid: "" });
  assert.match(p, /This is ONE headless run/);
  assert.match(p, /Never run a command in the background, never schedule a wake-up/);
  for (const t of ["ScheduleWakeup", "Monitor", "CronCreate"]) assert.ok(DISALLOWED_TOOLS.includes(t), `${t} is blocked`);
});

test("the Instagram caption carries the credits and at most 5 hashtags", () => {
  const cap = composeCaption({ caption: "Line one.\n\nMore.", hashtags: ["#a1", "#b2", "#c3", "#d4", "#e5", "#f6"], credits: ["Source: x.com/someone", "Stock footage: Pexels"] });
  assert.equal(cap, "Line one.\n\nMore.\n\nSource: x.com/someone\nStock footage: Pexels\n\n#a1 #b2 #c3 #d4 #e5");
  assert.equal(composeCaption({ caption: "Only.", hashtags: ["#a1"] }), "Only.\n\n#a1");
});
