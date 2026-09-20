/**
 * feed-preview.js
 *
 * TERMINAL PREVIEW ONLY — never posts, never tracks.
 * Scans your live LinkedIn Recent feed, drafts a comment per post with the full
 * voice pipeline (SKIP / validate / retry), and prints exactly what WOULD be posted.
 *
 *   node feed-preview.js [--max 3]
 *
 * Check every line. Only when you approve do we flip LINKEDIN_FEED_REPLY=true.
 */
const { logger } = require("./src/utils/helpers");

const args = process.argv.slice(2);
let max = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max" && args[i + 1]) max = Math.max(1, Math.min(10, parseInt(args[i + 1], 10) || 3));
}

(async () => {
  const feedEngage = require("./src/services/feedEngage");
  const r = await feedEngage.runFeedEngagement({ max, dryRun: true });
  console.log("\n================ PREVIEW ================");
  (r.previews || []).forEach((p, i) => {
    const m = (p.postText || "").match(/\d+\s*[smhdw]\s*•/);
    const body = m ? (p.postText || "").slice(m.index + m[0].length).trim() : (p.postText || "");
    console.log(`\n--- [${i + 1}] @${p.author} [${p.sort || p.kind || "peer"}] ---`);
    console.log(`POST: ${body}`);
    console.log(`WOULD COMMENT: ${p.comment}`);
  });
  if (!(r.previews || []).length) console.log("(no commentable drafts — everything skipped or rejected)");
  if ((r.wouldLike || []).length) {
    console.log(`\nWOULD LIKE (${r.wouldLike.length} posts, live-only - previews never like):`);
    r.wouldLike.forEach((w, i) => console.log(`  ${i + 1}. @${w.author} - "${(w.snippet || "").replace(/\s+/g, " ").slice(0, 70)}..."`));
  }
  console.log(`\nDone: ${r.previews ? r.previews.length : 0} previewed, ${r.skipped} skipped (${r.reason}).`);
  if (r.cost) {
    const c = r.cost.openrouter, g = r.cost.gemini;
    console.log(`COST: ~$${(c.usd + g.usd).toFixed(4)} this run (Gemini $${g.usd.toFixed(4)} ${g.prompt}+${g.completion} tok; OpenRouter $${c.usd.toFixed(4)} ${c.prompt}+${c.completion} tok; legacy provider ${r.cost.legacy.prompt}+${r.cost.legacy.completion} tok, billed separately).`);
  }
  process.exit(0);
})().catch((e) => { console.error("preview failed:", e.message); process.exit(1); });
