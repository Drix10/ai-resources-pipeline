/**
 * feed-preview.js
 *
 * TERMINAL PREVIEW ONLY — never posts, never tracks.
 * Scans your live LinkedIn post sources (finance/AI/founder content search plus config/creators.json,
 * or the home feed with LINKEDIN_SOURCE=feed), drafts a comment per post with the full voice
 * pipeline (SKIP / validate / retry), and prints exactly what WOULD be posted.
 *
 *   node feed-preview.js [--max 3] [--wait-login]
 *
 * Check every line. Only when you approve do we flip LINKEDIN_FEED_REPLY=true.
 */
const { logger } = require("./src/utils/helpers");

const args = process.argv.slice(2);
let max = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max" && args[i + 1]) max = Math.max(1, Math.min(10, parseInt(args[i + 1], 10) || 3));
}

// A running pipeline owns the LinkedIn tab and the tracker file: a preview would drive the
// same Chrome and two writers would lose tracker entries. A lock whose pid is gone is stale.
function pipelineRunning() {
  const fs = require("fs");
  const lockPath = require("path").join(process.cwd(), ".pipeline.lock");
  if (!fs.existsSync(lockPath)) return false;
  try {
    const { pid } = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    process.kill(pid, 0); // throws ESRCH when the process is gone
    return true;
  } catch (e) {
    return e.code === "EPERM" || e instanceof SyntaxError; // alive but not ours / lock mid-write
  }
}

(async () => {
  if (pipelineRunning()) {
    console.error("The pipeline is running (.pipeline.lock with a live pid). Run the preview after it finishes.");
    process.exit(1);
  }
  // --wait-login: you are at the keyboard, so wait up to 5 min for a manual LinkedIn login
  // (unattended runs never wait; they switch LinkedIn off for the run instead).
  if (args.includes("--wait-login")) process.env.LINKEDIN_INTERACTIVE_LOGIN = "true";
  const feedEngage = require("./src/services/feedEngage");
  // node feed-preview.js --connect [--live N]: preview (or, with --live, really send) N connection requests.
  if (args.includes("--connect")) {
    const li = args.indexOf("--live");
    const n = li >= 0 ? Math.max(1, parseInt(args[li + 1], 10) || 2) : 5;
    const r = await feedEngage.runConnectPass({ min: n, max: n, dryRun: li < 0 });
    (r.previews || []).forEach((p, i) => console.log(`${i + 1}. ${p.name} [${p.kw}] ${p.text}`));
    console.log(`\nConnect ${li < 0 ? "DRY RUN" : "LIVE"}: ${r.sent}/${r.target} (scanned ${r.scanned}) ${r.reason || ""}`);
    await feedEngage.cleanup().catch(() => {});
    process.exit(0);
  }
  const r = await feedEngage.runFeedEngagement({ max, dryRun: true });
  console.log("\n================ PREVIEW ================");
  (r.previews || []).forEach((p, i) => {
    const m = (p.postText || "").match(/\d+\s*(?:mo|yr|[smhdw])\s*•/);
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
    const c = r.cost.openrouter;
    console.log(`COST: ~$${c.usd.toFixed(4)} this run (OpenRouter ${c.prompt}+${c.completion} tok; NVIDIA ${r.cost.legacy.prompt}+${r.cost.legacy.completion} tok).`);
  }
  await feedEngage.cleanup().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("preview failed:", e.message); process.exit(1); });
