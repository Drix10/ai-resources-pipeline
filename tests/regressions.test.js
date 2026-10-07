const test = require("node:test");
const assert = require("node:assert/strict");
const llm = require("../src/services/llm");
const { fetchPage } = require("../src/utils/pageFetch");

const PUBLIC = "93.184.216.34";
const para = (n) => `<p>${Array.from({ length: n }, (_, i) => `engineers ship real systems and measure the results ${i}.`).join(" ")}</p>`;

test("cited page URLs lose tracking parameters but keep real ones", async () => {
  const u = `https://${PUBLIC}/post?id=7&utm_source=x&utm_medium=email&fbclid=abc&ref=home#section`;
  const page = await fetchPage(u, {
    fetchImpl: async () => new Response(`<html><head><title>A long enough title here</title></head><body><article>${para(30)}</article></body></html>`, { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(page.url, `https://${PUBLIC}/post?id=7`);
});

test("page titles keep the headline and drop the site suffix", async () => {
  const u = `https://${PUBLIC}/t`;
  const page = await fetchPage(u, {
    fetchImpl: async () => new Response(`<html><head><title>What a dbt project is worth to an agent | Blog | Fivetran</title></head><body><article>${para(30)}</article></body></html>`, { status: 200, headers: { "content-type": "text/html" } }),
  });
  assert.equal(page.title, "What a dbt project is worth to an agent");
});

test("hype words are allowed when the source itself uses them, rejected otherwise", () => {
  const article = { title: "Exploit chain leverages parser bug", summary: "Researchers describe how the exploit chain leverages a parser bug in the update service to reach the host. Patches are available now.", points: [{ label: "Bug", text: "the parser bug leverages unchecked lengths" }] };
  assert.deepEqual(llm.validateArticle(article, "Researchers show an exploit chain that leverages a parser bug in the update service to reach the host. Patches are available now. Unchecked lengths are the root cause."), []);
  assert.match(llm.validateArticle(article, "Researchers show an exploit chain using a parser bug in the update service to reach the host. Patches are available now. Unchecked lengths are the root cause.").join(" "), /leverag/);
});
