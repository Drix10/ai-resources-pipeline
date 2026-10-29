require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const config = require("../config");
const helpers = require("../src/utils/helpers");
const hf = require("../src/services/hfDataset");
const kb = require("../src/services/kbTopics");

for (const t of helpers.logger.transports) t.silent = true;

// X status ids that decode to 2026-10-26 and 2026-09-14 (an id is ms since the Twitter epoch, shifted left by 22).
const statusId = (iso) => ((BigInt(Date.parse(iso)) - 1288834974657n) << 22n).toString();
const OCT = statusId("2026-10-26T12:00:00Z");
const SEP = statusId("2026-09-14T12:00:00Z");

const item = (title, body, id) => `### 🤖 ${title}\n\n${body}\n\n🔗 Resources:\n\n${id ? `- [Original post](https://x.com/a/status/${id})\n` : ""}\n---\n\n`;
const DIGEST_A = [
  item("Anthropic launches Claude Opus 5.5", "Anthropic shipped its new model.", OCT),
  item("Startup raises $5M seed round", "A robotics startup raised money. It uses Claude.\n\nKey points: it also mentions OpenAI.", OCT),
  item("Anthropic revenue $85M after pre-launch investment", "Revenue news.", SEP),
  item("Fern 0.1 release with 10M context", "A small lab's model.", SEP),
  item("An old undated Claude note", "Claude, with no X post.", null),
].join("");
const DIGEST_B = item("Anthropic launches Claude Opus 5.5", "The same story in another category.", OCT) + item("Cats | dogs [and] <tags>", "OpenAI said something.", SEP);

const tarEntry = (name, body = "") => {
  const data = Buffer.from(body);
  const header = Buffer.alloc(512);
  header.write(name, 0);
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header.write("0", 156);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
};
const tar = (extra = []) => Buffer.concat([
  tarEntry("o-r-sha/AI Developer Tools/resources-002.md", DIGEST_A),
  tarEntry("o-r-sha/Tech VIPs/resources-001.md", DIGEST_B),
  ...extra.map((f) => tarEntry(`o-r-sha/${f.path}`, f.content)),
  Buffer.alloc(1024),
]);
const pagesOf = (t = tar()) => Object.fromEntries(kb.buildPages(hf.parseTar(t)).map((f) => [f.path, f.content]));

test("digest rows carry GitHub's heading anchor, with -1 on a repeated heading", () => {
  const rows = hf.parseDigest(item("Same: Title!", "a", null) + item("Same: Title!", "b", null), { category: "C", file: "resources-001.md" });
  assert.deepEqual(rows.map((r) => r.anchor), ["-same-title", "-same-title-1"]);
});

test("topic pages list the briefings whose headline or first paragraph names the topic, newest first, once each", () => {
  const pages = pagesOf();
  const anthropic = pages["topics/anthropic.md"];
  const lines = anthropic.split("\n").filter((l) => l.startsWith("| 20") || l.startsWith("|  |"));
  assert.deepEqual(lines.map((l) => l.split("](")[0].split("[")[1]), [
    "Anthropic launches Claude Opus 5.5", // once, though two categories carry it
    "Startup raises $5M seed round", // "Claude" in its first paragraph
    "Anthropic revenue $85M after pre-launch investment",
    "An old undated Claude note", // undated rows come last
  ]);
  assert.match(anthropic, /^# Anthropic\n/);
  assert.ok(anthropic.includes("(https://github.com/test-owner/test-repo/blob/main/AI%20Developer%20Tools/resources-002.md#-anthropic-launches-claude-opus-55)"));
  assert.ok(!pages["topics/openai.md"].includes("Startup raises"), "a mention past the first paragraph does not count");
  assert.ok(pages["topics/openai.md"].includes("[Cats \\| dogs and &lt;tags>]("), "table cells are escaped");
  assert.ok(pages["topics/funding-and-acquisitions.md"].includes("Startup raises $5M seed round"));
  assert.ok(pages["topics/README.md"].includes("| [Anthropic](anthropic.md) | 4 | 2026-10-26 |"));
  assert.ok(Object.keys(pages).every((p) => !/\d{4}-\d\d-\d\d.*build/i.test(pages[p])), "no build date: an unchanged corpus gives unchanged pages");
});

test("the timeline keeps dated releases by a known lab or of a versioned product, grouped by month", () => {
  const release = (title) => kb.isRelease({ title });
  assert.equal(release("Anthropic launches Claude Opus 5.5"), true);
  assert.equal(release("Fern 0.1 release with 10M context"), true, "a versioned product");
  assert.equal(release("Nvidia releases ~2500 OpenUSD models"), true);
  assert.equal(release("Anthropic revenue $85M after pre-launch investment"), false, "pre-launch is no release");
  assert.equal(release("Startup launches an app"), false, "no lab and no version");
  assert.equal(release("Anthropic revenue grows"), false, "no release verb");

  const timeline = pagesOf()["TIMELINE.md"];
  assert.match(timeline, /^# AI release timeline\n/);
  assert.ok(timeline.indexOf("## October 2026") < timeline.indexOf("## September 2026"));
  assert.ok(timeline.includes("- **Oct 26** · [Anthropic launches Claude Opus 5.5]"));
  assert.ok(timeline.includes("- **Sep 14** · [Fern 0.1 release with 10M context]"));
  assert.equal(timeline.split("Anthropic launches Claude Opus 5.5").length, 2, "listed once");
  assert.ok(!timeline.includes("pre-launch"));
});

test("the daily build commits only changed pages, at most once a day, and respects switches and stops", async () => {
  const commits = [];
  let corpus = tar();
  const saved = { ...kb._steps };
  Object.assign(kb._steps, {
    branch: async () => "run/2026-10-29",
    downloadTar: async (ref) => { assert.equal(ref, "run/2026-10-29", "the run branch is read, with this run's digests"); return corpus; },
    commit: async (owner, repo, files, message) => commits.push({ owner, repo, files, message }),
  });
  try {
    fs.rmSync(process.env.KB_TOPICS_STATE_PATH, { force: true });
    const day1 = new Date("2026-10-29T10:00:00");
    assert.deepEqual(await kb.runKbTopics({ now: day1, shouldStop: () => true }), { skipped: "stopping" });

    const first = await kb.runKbTopics({ now: day1 });
    assert.equal(first.built, true);
    assert.equal(commits.length, 1);
    assert.equal(commits[0].files.length, first.files);
    assert.ok(commits[0].files.some((f) => f.path === "TIMELINE.md") && commits[0].files.some((f) => f.path === "topics/README.md"));

    assert.deepEqual(await kb.runKbTopics({ now: new Date("2026-10-29T23:00:00") }), { skipped: "not due" }, "once a day");

    // Next day, the repo already holds every page but one: only that one is committed.
    const pages = commits[0].files.filter((f) => f.path !== "topics/xai.md");
    corpus = tar(pages);
    const second = await kb.runKbTopics({ now: new Date("2026-10-30T10:00:00") });
    assert.equal(second.changed, 1);
    assert.deepEqual(commits[1].files.map((f) => f.path), ["topics/xai.md"]);

    corpus = tar(commits[0].files);
    const third = await kb.runKbTopics({ now: new Date("2026-10-31T10:00:00") });
    assert.equal(third.changed, 0);
    assert.equal(commits.length, 2, "nothing changed, nothing committed");

    config.kbTopics.enabled = false;
    assert.deepEqual(await kb.runKbTopics({ now: new Date("2026-11-01T10:00:00") }), { skipped: "disabled" });
  } finally {
    config.kbTopics.enabled = true;
    Object.assign(kb._steps, saved);
  }
});

test("KB_TOPICS is on by default", () => {
  assert.deepEqual(config.kbTopics, { enabled: true });
});
