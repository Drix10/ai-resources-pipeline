require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const github = require("../src/services/github");
const config = require("../config");
const helpers = require("../src/utils/helpers");
for (const t of helpers.logger.transports) t.silent = true;

const { digestHeadlines, renderCategorySection, readmeFooter, README_CATEGORIES_HEADING } = github.readme;
const README_FOOTER = readmeFooter("Drix10", "ai-resources");

const digest = [
  "### 🤖 Nemotron 3.5 Super VL runs at 500+ tokens/sec",
  "",
  "Body text.",
  "",
  "### 💡 GPT-6.1 Sol uses 53% fewer credits",
  "### 🚀 [Bito] adds <Bitbucket> review",
  "### 🧠 A fourth headline",
  "### Read More & Connect",
].join("\n");

test("digest headlines drop the leading emoji and stop at three", () => {
  assert.deepEqual(digestHeadlines(digest), [
    "Nemotron 3.5 Super VL runs at 500+ tokens/sec",
    "GPT-6.1 Sol uses 53% fewer credits",
    "[Bito] adds <Bitbucket> review",
  ]);
  assert.deepEqual(digestHeadlines(""), []);
  assert.deepEqual(digestHeadlines("### One\n### Read More & Connect"), ["One"]);
});

test("a category section names the newest digest, its headlines and the count", () => {
  const files = [{ name: "resources-012.md", number: 12, url: "https://x/12" }, { name: "resources-011.md", number: 11, url: "https://x/11" }];
  const out = renderCategorySection({ name: "AI Developer Tools" }, files, digestHeadlines(digest));
  assert.match(out, /^### AI Developer Tools\n\n/);
  assert.match(out, /2 digests · \[latest: #012\]\(https:\/\/x\/12\)/);
  assert.match(out, /\*   Bito adds &lt;Bitbucket> review/);
  assert.equal(renderCategorySection({ name: "Empty" }, []), "### Empty\n\n*   No resources yet.\n\n");
  assert.match(renderCategorySection({ name: "A" }, files, []), /\[Latest Update \(#012\)\]\(https:\/\/x\/12\)/);
});

test("the category index totals the digests and links GitHub's heading anchors", () => {
  const out = github.readme.renderCategoryIndex([{ name: "Devs, Designers, DevRel", count: 1200 }, { name: "AR VR Companies and Development", count: 3 }]);
  assert.match(out, /^\*\*1,203 digests in 2 categories\.\*\*/);
  assert.match(out, /\(#devs-designers-devrel\) · \[AR VR Companies and Development\]\(#ar-vr-companies-and-development\)/);
});

test("the README keeps the owner's text, rebuilds the list and ends with the footer once", async () => {
  const owner = "Drix10";
  const repo = "ai-resources";
  const head = "# AI Resources\n\nOwner text.\n\n";
  let readme = `${head}${README_CATEGORIES_HEADING}\n\n### Old\n\nstale\n${README_FOOTER}`;
  const files = { "AI Developer Tools/resources-001.md": "### 🤖 Old one", "AI Developer Tools/resources-002.md": digest };
  const b64 = (t) => Buffer.from(t).toString("base64");
  let commits = 0;
  github.octokit = {
    repos: {
      getContent: async ({ path }) => {
        if (path === "README.md") return { data: { encoding: "base64", content: b64(readme), sha: "r1" } };
        if (files[path]) return { data: { encoding: "base64", content: b64(files[path]) } };
        const inFolder = Object.keys(files).filter((k) => k.startsWith(`${path}/`)).map((k) => ({ name: k.slice(path.length + 1) }));
        if (inFolder.length) return { data: inFolder };
        throw Object.assign(new Error("Not Found"), { status: 404 });
      },
      createOrUpdateFileContents: async ({ content }) => {
        commits++;
        readme = Buffer.from(content, "base64").toString("utf8");
        return { data: { content: { sha: "r2" } } };
      },
    },
  };
  const folders = config.folders;
  config.folders = [{ name: "AI Developer Tools" }, { name: "Nothing Here" }];
  try {
    await github.updateReadmeWithNewFile(owner, repo);
    assert.equal(commits, 1);
    assert.ok(readme.startsWith(head + README_CATEGORIES_HEADING));
    assert.ok(!readme.includes("stale"));
    assert.match(readme, /2 digests · \[latest: #002\]/);
    assert.match(readme, /\*   Nemotron 3\.5 Super VL runs at 500\+ tokens\/sec/);
    assert.match(readme, /### Nothing Here\n\n\*   No resources yet\./);
    assert.match(readme, /\*\*2 digests in 2 categories\.\*\*/);
    assert.match(readme, /\[AI Developer Tools\]\(#ai-developer-tools\) · \[Nothing Here\]\(#nothing-here\)/);
    assert.ok(readme.endsWith(README_FOOTER));
    assert.equal(readme.split("Star the repo").length, 2, "footer appears once");
    await github.updateReadmeWithNewFile(owner, repo);
    assert.equal(commits, 1, "an unchanged README is not committed again");
  } finally {
    config.folders = folders;
  }
});
