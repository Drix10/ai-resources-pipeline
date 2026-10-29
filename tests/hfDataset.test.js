require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const config = require("../config");
const helpers = require("../src/utils/helpers");
const hf = require("../src/services/hfDataset");

for (const t of helpers.logger.transports) t.silent = true;

const TOKEN = `hf_${"a1B2".repeat(8)}`;
const DEFAULT_CONFIG = { ...config.hfDataset };
const FILE_BASE = "https://github.com/test-owner/test-repo/blob/main";

const SAMPLE = `Some preamble that is not a briefing.

### 🤖 Raycast Enterprise MDM deployment

Raycast Enterprise adds MDM support.

Key Points:

- Signed PKG for every release.

🔗 Resources:

- [Original post](https://x.com/raycast/status/2114743580862603438)
- [MDM Deployment](https://manual.raycast.com/enterprise/mdm-deployment) - Linked page
![Image](https://pbs.twimg.com/media/HVkUFCkaQAAsKDx?format=jpg&name=small)

---

### **Bold Wrapped Title**

Body ends with double separators.


---


---

### 📊 Links only

🔗 Resources:

- [Original post](https://x.com/a/status/2114747892342661504)

---

### ✨ Old style

• First point.

🔗 Resources:

No resources provided in the original tweet.

---

### ⭐️ Support

If you liked reading this report, please star this repository.

---
`;
const parse = (md = SAMPLE) => hf.parseDigest(md, { category: "AI Developer Tools", file: "resources-007.md" });

// A tar with a pax long-path header, like the archives GitHub serves.
const tarEntry = (name, body = "", type = "0") => {
  const data = Buffer.from(body);
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0);
  header.write(data.length.toString(8).padStart(11, "0"), 124);
  header.write(type, 156);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
};
const longCategory = "L".repeat(90);
const makeTar = () => Buffer.concat([
  tarEntry("pax_global_header", "52 comment=abc\n", "g"),
  tarEntry("repo-abc/", "", "5"),
  tarEntry("repo-abc/.github/ISSUE_TEMPLATE/config.yml", "### not a digest\n"),
  tarEntry("repo-abc/README.md", "### not a digest\n"),
  tarEntry("repo-abc/Zeta/resources-010.md", "### 🤖 Zeta ten\n\nText ten.\n"),
  tarEntry("repo-abc/Zeta/resources-002.md", "### 🤖 Zeta two\n\nText two.\n"),
  tarEntry("repo-abc/Alpha/resources-001.md", "### 🤖 Alpha one\n\nText one.\n"),
  tarEntry("repo-abc/Alpha/notes.md", "### 🤖 not a digest file\n\nNope.\n"),
  tarEntry("pax", `120 path=repo-abc/${longCategory}/resources-001.md\n`, "x"),
  tarEntry(`repo-abc/${longCategory}/resources-001.md`.slice(0, 100), "### 🤖 Long category\n\nText long.\n"),
  Buffer.alloc(1024),
]);

test("a digest is split into briefings: titles, text, links, the date of the first X post, the file link", () => {
  const rows = parse();
  assert.deepEqual(rows.map((r) => r.title), ["Raycast Enterprise MDM deployment", "Bold Wrapped Title", "Old style"], "the preamble, the link-only item and the Support footer are not briefings");
  const [first, bold, old] = rows;
  assert.equal(first.category, "AI Developer Tools");
  assert.equal(first.digest_file, "resources-007.md");
  assert.equal(first.digest_number, 7);
  assert.equal(first.text, "Raycast Enterprise adds MDM support.\n\nKey Points:\n\n- Signed PKG for every release.", "no resource list, image or separator in the text");
  assert.deepEqual(first.source_urls, ["https://x.com/raycast/status/2114743580862603438", "https://manual.raycast.com/enterprise/mdm-deployment"], "the image is not a source");
  assert.equal(first.date, "2026-10-26", "the day embedded in the X status id");
  assert.equal(first.github_url, `${FILE_BASE}/AI%20Developer%20Tools/resources-007.md`);
  assert.equal(bold.text, "Body ends with double separators.");
  assert.equal(old.text, "• First point.");
  assert.deepEqual(old.source_urls, []);
  assert.equal(old.date, null, "no X post, no date");
  assert.deepEqual(parse(SAMPLE.replace(/\n/g, "\r\n")).map((r) => [r.title, r.text.replace(/\r/g, "")]), rows.map((r) => [r.title, r.text]), "CRLF digests parse the same");
});

test("ids are stable: the same briefing keeps its id across builds and edits, and no two collide", () => {
  const a = parse();
  const b = parse();
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
  assert.ok(a.every((r) => /^[0-9a-f]{16}$/.test(r.id)));
  assert.equal(new Set(a.map((r) => r.id)).size, a.length);
  assert.equal(parse(SAMPLE.replace("Raycast Enterprise adds MDM support.", "A reworded summary."))[0].id, a[0].id, "an edited text keeps its id");
  const other = hf.parseDigest(SAMPLE, { category: "VC Firms", file: "resources-007.md" });
  assert.ok(other.every((r, i) => r.id !== a[i].id), "the same digest number in another category is another id");
});

test("the repo's tar gives every digest in category then number order, long paths included", () => {
  const rows = hf.parseTar(makeTar());
  assert.deepEqual(rows.map((r) => `${r.category.slice(0, 5)}/${r.digest_number}/${r.title}`), ["Alpha/1/Alpha one", "LLLLL/1/Long category", "Zeta/2/Zeta two", "Zeta/10/Zeta ten"]);
  assert.equal(rows[1].category, longCategory, "the path past 100 bytes comes from the pax header");
});

test("the Parquet file reads back with source_urls as a list and a null date", async () => {
  const rows = parse();
  const buf = await hf.writeParquet(rows);
  const bytes = Buffer.from(buf);
  assert.equal(bytes.subarray(0, 4).toString(), "PAR1");
  assert.equal(bytes.subarray(-4).toString(), "PAR1");
  const { parquetReadObjects } = await import("hyparquet");
  const back = await parquetReadObjects({ file: buf });
  assert.equal(back.length, rows.length);
  assert.deepEqual(back.map((r) => r.id), rows.map((r) => r.id));
  assert.deepEqual(back[0].source_urls, rows[0].source_urls);
  assert.deepEqual(back[2].source_urls, []);
  assert.equal(back[0].date, "2026-10-26");
  assert.equal(back[2].date, null);
  assert.equal(back[0].digest_number, 7);
  assert.equal(back[0].text, rows[0].text);
});

test("the dataset card has the YAML header, the fields and the links back to GitHub", () => {
  const card = hf.datasetCard(parse(), { now: new Date("2026-10-29T12:00:00Z") });
  assert.ok(card.startsWith("---\nlicense: cc-by-4.0\n"));
  for (const line of ["language:\n- en", "pretty_name: AI Resources", "size_categories:\n- n<1K", "task_categories:\n- text-generation\n- summarization\n- question-answering", "path: data/train.parquet"]) assert.ok(card.includes(line), line);
  const yaml = card.split("---")[1];
  assert.ok(!yaml.includes("\t"), "plain YAML");
  for (const field of ["id", "category", "digest_file", "digest_number", "title", "text", "source_urls", "date", "github_url"]) assert.ok(card.includes(`| \`${field}\` |`), field);
  assert.ok(card.includes("(https://github.com/Drix10/ai-resources-pipeline)"), "how it is built links the pipeline");
  assert.ok(card.includes("## Star the repo") && card.includes("(https://github.com/test-owner/test-repo)"), "the star link goes to the resources repo");
  assert.ok(card.includes("@misc{ai_resources") && card.includes("year = {2026}"));
  assert.ok(card.includes("The newest dated briefing is from 2026-10-26."));
  assert.ok(!/@[a-z0-9-]+\.(com|dev|io)/i.test(card), "no email address");
  const row = parse()[0];
  assert.ok(hf.datasetCard(Array.from({ length: 100649 }, () => row)).includes("- 100K<n<1M"), "the size category follows the row count");
});

// ---- The weekly gate ----

const harness = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hf-test-"));
  process.env.HF_DATASET_STATE_PATH = path.join(dir, "data", "hf-dataset.json");
  config.hfDataset = { enabled: true, token: TOKEN, repo: "test/dataset" };
  const seen = { downloads: 0, uploads: [] };
  const original = { ...hf._steps };
  hf._steps.downloadTar = async () => { seen.downloads++; return makeTar(); };
  hf._steps.upload = async (args) => { seen.uploads.push(args); if (seen.fail) throw new Error(seen.fail); };
  const done = () => { Object.assign(hf._steps, original); config.hfDataset = { ...DEFAULT_CONFIG }; fs.rmSync(dir, { recursive: true, force: true }); };
  return { seen, state: () => JSON.parse(fs.readFileSync(process.env.HF_DATASET_STATE_PATH, "utf8")), stateExists: () => fs.existsSync(process.env.HF_DATASET_STATE_PATH), done };
};

test("the defaults: on, no token, the dataset repo Drix10/ai-resources", () => {
  assert.deepEqual(DEFAULT_CONFIG, { enabled: true, token: "", repo: "Drix10/ai-resources" });
});

test("without HF_TOKEN the step is skipped with one info line; HF_DATASET=false skips it silently", async () => {
  const h = harness();
  const info = helpers.logger.info;
  const lines = [];
  helpers.logger.info = (m) => { lines.push(String(m)); };
  try {
    config.hfDataset.token = "";
    assert.deepEqual(await hf.runHfDataset(), { skipped: "no token" });
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("HF_TOKEN"));
    lines.length = 0;
    config.hfDataset = { enabled: false, token: TOKEN, repo: "test/dataset" };
    assert.deepEqual(await hf.runHfDataset(), { skipped: "disabled" });
    assert.equal(lines.length, 0);
    assert.equal(h.seen.downloads, 0, "nothing is downloaded");
    assert.ok(!h.stateExists());
  } finally {
    helpers.logger.info = info;
    h.done();
  }
});

test("a first run uploads the Parquet file and the card, then waits 7 days", async () => {
  const h = harness();
  const now = Date.parse("2026-10-29T12:00:00Z");
  try {
    const first = await hf.runHfDataset({ now });
    assert.equal(first.uploaded, true);
    assert.equal(first.rows, 4);
    assert.equal(h.seen.uploads.length, 1);
    const [up] = h.seen.uploads;
    assert.equal(Buffer.from(up.parquet).subarray(0, 4).toString(), "PAR1");
    assert.ok(up.card.startsWith("---\nlicense: cc-by-4.0") && up.title.includes("4"));
    assert.deepEqual(h.state(), { uploadedAt: new Date(now).toISOString(), rows: 4, bytes: first.bytes, repo: "test/dataset" });

    assert.deepEqual(await hf.runHfDataset({ now: now + 6.9 * 86400000 }), { skipped: "not due" });
    assert.equal(h.seen.downloads, 1, "no second download inside the week");
    const later = await hf.runHfDataset({ now: now + 7 * 86400000 });
    assert.equal(later.uploaded, true, "due again after 7 days");
    assert.equal(h.seen.uploads.length, 2);
  } finally {
    h.done();
  }
});

test("a stop request skips the upload, before or after the build, and keeps the week unspent", async () => {
  const h = harness();
  try {
    assert.deepEqual(await hf.runHfDataset({ shouldStop: () => true }), { skipped: "stopping" });
    assert.equal(h.seen.downloads, 0);
    let asked = 0;
    assert.deepEqual(await hf.runHfDataset({ shouldStop: () => ++asked === 2 }), { skipped: "stopping" });
    assert.equal(h.seen.downloads, 1);
    assert.equal(h.seen.uploads.length, 0);
    assert.ok(!h.stateExists(), "the next run tries again");
  } finally {
    h.done();
  }
});

test("a failed upload is thrown without the token and leaves no state, so the next run retries", async () => {
  const h = harness();
  try {
    h.seen.fail = `401 Unauthorized for ${TOKEN} on the Hub`;
    await assert.rejects(() => hf.runHfDataset(), (error) => {
      assert.ok(!error.message.includes(TOKEN), "the token is scrubbed");
      assert.ok(error.message.includes("401"));
      return true;
    });
    assert.ok(!h.stateExists());
    h.seen.fail = null;
    assert.equal((await hf.runHfDataset()).uploaded, true);
  } finally {
    h.done();
  }
});

test("a repository with no briefings is an error, not an empty dataset", async () => {
  const h = harness();
  hf._steps.downloadTar = async () => Buffer.concat([tarEntry("repo-abc/README.md", "hello"), Buffer.alloc(1024)]);
  try {
    await assert.rejects(() => hf.runHfDataset(), /no briefings/);
    assert.equal(h.seen.uploads.length, 0);
  } finally {
    h.done();
  }
});
