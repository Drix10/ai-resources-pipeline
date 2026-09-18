#!/usr/bin/env node
// One-shot: publish all DEV.to drafts (sets published:true via PUT /api/articles/:id).
// Usage: node scripts/publish-devto-drafts.js [--dry-run]
require("dotenv").config();

const API_KEY = process.env.DEVTO_API_KEY;
const DRY_RUN = process.argv.includes("--dry-run");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, opts = {}) {
  const res = await fetch(`https://dev.to/api${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "api-key": API_KEY,
      "User-Agent": "ai-resources-pipeline/1.0 (https://blogs.drix10.com)",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { _raw: text }; }
  return { ok: res.ok, status: res.status, data };
}

(async () => {
  if (!API_KEY) throw new Error("DEVTO_API_KEY missing in .env");

  // 1. Page through my articles (drafts come first, then published).
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const { ok, status, data } = await api(`/articles/me?per_page=1000&page=${page}`);
    if (!ok) throw new Error(`GET /articles/me p${page} -> HTTP ${status}: ${JSON.stringify(data).slice(0, 200)}`);
    if (!Array.isArray(data) || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    await sleep(500);
  }
  console.log(`Found ${all.length} total articles.`);

  const isDraft = (a) => a.published === false || (a.published == null && !a.published_at);
  const drafts = all.filter(isDraft);
  console.log(`${drafts.length} draft(s) to publish${DRY_RUN ? " [dry-run, publishing nothing]" : ""}.`);

  // 2. Publish each draft (1.2s spacing to respect DEV.to rate limits).
  let done = 0, failed = 0;
  for (const d of drafts) {
    if (DRY_RUN) { console.log(`  - would publish #${d.id}: ${(d.title || "").slice(0, 60)}`); continue; }
    try {
      const { ok, status, data } = await api(`/articles/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ article: { published: true } }),
      });
      if (ok) { done++; console.log(`  ✔ #${d.id}: ${(d.title || "").slice(0, 60)}`); }
      else { failed++; console.warn(`  ✘ #${d.id} HTTP ${status}: ${JSON.stringify(data).slice(0, 160)}`); }
    } catch (e) { failed++; console.warn(`  ✘ #${d.id}: ${e.message}`); }
    await sleep(1200);
  }
  console.log(`\nDone. Published: ${done}, failed: ${failed}.`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
