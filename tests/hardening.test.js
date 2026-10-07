const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../src/services/llm");

const POST = "Acme released Fooql 2.0 with 40% faster joins. Benchmarks on TPC-H show 120 ms down from 360 ms per query. Metadata sync is unchanged. It is open source under the MIT license.";
const tweet = (over = {}) => [{ text: POST, url: "https://x.com/acme/status/1", links: [], images: [], ...over }];
const reply = (over = {}) => {
  const f = {
    emoji: "🚀",
    value: "4",
    title: "Acme Fooql 2.0 makes joins 40% faster",
    summary: "Acme released Fooql 2.0, a query engine release with joins that run 40% faster than before. TPC-H benchmarks drop from 360 ms to 120 ms per query. The project is open source under the MIT license.",
    points: ["Speed: joins are 40% faster, from 360 ms to 120 ms on TPC-H", "License: MIT, open source"],
    ...over,
  };
  return [`EMOJI: ${f.emoji}`, `VALUE: ${f.value}`, `TITLE: ${f.title}`, `SUMMARY: ${f.summary}`, "POINTS:", ...f.points.map((p) => `- ${p}`)].join("\n");
};
const errors = (over) => llm.validateArticle(llm.parseArticleReply(reply(over)), POST);

async function withStubs({ text, page = null }, fn) {
  const orig = { text: llm.generateArticleText, page: llm.fetchLinkedPage };
  llm.generateArticleText = async (p) => (typeof text === "function" ? text(p) : text);
  llm.fetchLinkedPage = async () => page;
  try { return await fn(); } finally { llm.generateArticleText = orig.text; llm.fetchLinkedPage = orig.page; }
}

test("the baseline article validates cleanly", () => assert.deepEqual(errors({}), []));

test("markup in model output is rejected: it is committed as markdown and rendered on the blog", () => {
  for (const bad of [
    { title: "Acme <img src=x onerror=alert(1)> Fooql 2.0 faster" },
    { title: "Acme Fooql 2.0 [click me](https://evil.example) faster" },
    { summary: "Acme released Fooql 2.0 <script>alert(1)</script> with joins that run 40% faster than before. TPC-H drop from 360 ms to 120 ms per query. Open source." },
    { summary: "Acme released Fooql 2.0 with `joins` that run 40% faster than before. TPC-H benchmarks drop from 360 ms to 120 ms per query today. Open source MIT." },
    { points: ["Speed: joins are 40% faster, see [docs](https://evil.example) for 360 ms", "License: MIT, open source"] },
  ]) {
    assert.match(errors(bad).join(" "), /plain text only/i, JSON.stringify(bad).slice(0, 60));
  }
});

test("a summary or title that starts with a markdown block marker is rejected", () => {
  const body = "Acme released Fooql 2.0 with joins that run 40% faster than before. TPC-H benchmarks drop from 360 ms to 120 ms per query. Open source under the MIT license.";
  for (const lead of ["# ", "> ", "- ", "* ", "1. ", "| "]) {
    assert.match(errors({ summary: lead + body }).join(" "), /start with a word/i, lead);
  }
  // A leading "#" on the title line is stripped by the parser, so it can never become a heading.
  assert.equal(llm.parseArticleReply(reply({ title: "# Acme Fooql 2.0 makes joins 40% faster" })).title, "Acme Fooql 2.0 makes joins 40% faster");
  assert.deepEqual(errors({ summary: "40% faster joins are the headline of Fooql 2.0, and TPC-H drops from 360 ms to 120 ms per query. Open source under the MIT license." }), [], "a number may open a sentence");
});

test("point text that begins with a marker is cleaned, not published as a heading or quote", () => {
  const a = llm.parseArticleReply(reply({ points: ["Speed: # joins are 40% faster from 360 ms to 120 ms", "> License: MIT open source here"] }));
  assert.ok(a.points.every((p) => !/^[#>]/.test(p.text)));
});

test("numbers must match whole: 4 and 0 are not 40, 2 is not 2.0, 36 is not 360", () => {
  for (const n of ["4", "0", "36", "12"]) {
    const e = errors({ summary: `Acme released Fooql 2.0 and joins run ${n} faster than before, TPC-H drops from 360 ms to 120 ms per query. Open source under the MIT license.` });
    assert.match(e.join(" "), new RegExp(`number ${n} is not`), n);
  }
  assert.match(errors({ points: ["Version: 2 is the new release for everyone here", "License: MIT, open source"] }).join(" "), /number 2 is not/);
  assert.deepEqual(errors({ points: ["Version: 2.0 is the new release for everyone here", "License: MIT, open source"] }), []);
});

test("names must be whole words from the post, not a prefix match", () => {
  // "Metadata" is in the post; "Meta" is a different company.
  assert.match(errors({ summary: "Acme released Fooql 2.0 and Meta adopted joins that run 40% faster than before. TPC-H drops from 360 ms to 120 ms per query. Open source under the MIT license." }).join(" "), /names are not in the post: Meta/);
  assert.deepEqual(errors({ summary: "Acme released Fooql 2.0 with joins that run 40% faster than before. Metadata sync is unchanged and TPC-H drops from 360 ms to 120 ms per query. Open source under MIT." }), []);
  assert.deepEqual(errors({ points: ["Benchmark: TPC-H shows 120 ms down from 360 ms per query", "License: MIT, open source"] }), [], "hyphenated names match as a whole");
});

test("negations the post never used are rejected; ordinary verbs like drop are fine", () => {
  const e = errors({ summary: "Acme did not release Fooql 2.0 with joins that run 40% faster than before. TPC-H drops from 360 ms to 120 ms per query. Open source under the MIT license." });
  assert.match(e.join(" "), /"not" are not in the post|"not"/);
  assert.deepEqual(errors({}), [], "'drop' in the baseline is allowed");
  assert.match(errors({ points: ["Speed: Fooql 2.0 is deprecated for 120 ms joins here", "License: MIT, open source"] }).join(" "), /deprecat/);
});

test("VALUE is read as a whole number and clamped to the scale", () => {
  assert.equal(llm.parseArticleReply(reply({ value: "10" })).value, 5);
  assert.equal(llm.parseArticleReply(reply({ value: "4" })).value, 4);
  assert.equal(llm.parseArticleReply(reply({ value: "1-5" })).value, 1);
  assert.equal(llm.parseArticleReply(reply({ value: "high" })).value, 0);
});

test("a fetched page's title cannot inject markup into the published resources", async () => {
  const page = { url: "https://acme.dev/a(b)c", from: "https://t.co/x", title: "Big <img src=x onerror=alert(1)> news *bold* [x](javascript:alert(2)) `tick` | pipe", text: POST + " " + "Detail text goes here. ".repeat(30) };
  await withStubs({ text: reply({}), page }, async () => {
    const md = await llm.generateArticle(tweet({ links: ["https://t.co/x"] }));
    const line = md.split("\n").find((l) => l.includes("Linked page"));
    assert.ok(line, "the page is still cited");
    assert.doesNotMatch(line, /[<>`*|]|\]\(javascript/);
    assert.match(line, /\]\(https:\/\/acme\.dev\/a%28b%29c\)/, "parentheses in the URL are escaped");
    assert.ok(line.replace(/\]\(.*?\)\s-\sLinked page$/, "").length < 100, "label is capped");
  });
});

test("URLs with parentheses survive normalisation; sentence punctuation is still stripped", () => {
  assert.equal(llm.normalizeResourceUrl("https://en.wikipedia.org/wiki/Foo_(bar)"), "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(llm.normalizeResourceUrl("https://example.com/page)."), "https://example.com/page");
  assert.equal(llm.normalizeResourceUrl("https://example.com/a_(b))"), "https://example.com/a_(b)");
  assert.equal(llm.normalizeResourceUrl("https://example.com/path,"), "https://example.com/path");
});

test("a rejected API key aborts the run instead of silently skipping every post", async () => {
  const authError = Object.assign(new Error("OpenRouter generation failed (401)"), { status: 401 });
  await withStubs({ text: () => { throw authError; } }, async () => {
    await assert.rejects(llm.generateArticle(tweet()), { code: "LOCAL_LLM_UNAVAILABLE" });
  });
  const transient = Object.assign(new Error("503"), { status: 503 });
  await withStubs({ text: () => { throw transient; } }, async () => {
    assert.equal(await llm.generateArticle(tweet()), null, "transient errors still just skip");
  });
});

test("when one source fails fatally the other workers stop instead of burning budget", async () => {
  const orig = llm.generateArticle;
  let calls = 0;
  const mk = (i) => [{ text: POST, url: `https://x.com/a/status/${i}`, links: [], images: [] }];
  llm.generateArticle = async () => {
    const n = ++calls;
    await new Promise((r) => setTimeout(r, 5));
    if (n === 1) throw Object.assign(new Error("down"), { code: "LOCAL_LLM_UNAVAILABLE" });
    return null;
  };
  try {
    await assert.rejects(llm.generateMarkdownBatched(Array.from({ length: 20 }, (_, i) => mk(i)), "T", 3), { code: "LOCAL_LLM_UNAVAILABLE" });
    const settled = calls;
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(calls, settled, "no calls after the rejection");
    assert.ok(calls < 20, `stopped early (${calls}/20)`);
  } finally { llm.generateArticle = orig; }
});
