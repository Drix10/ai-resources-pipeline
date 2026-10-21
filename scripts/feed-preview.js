/**
 * scripts/feed-preview.js
 *
 * Terminal preview of the LinkedIn passes: posts nothing, tracks nothing. It reads LinkedIn through Claude in
 * Chrome on your own Chrome (stay logged in there); no action session is ever started.
 * Scans your live LinkedIn post sources (the people who engaged with you, config/creators.json and AI/founder/finance content search,
 * or the home feed with LINKEDIN_SOURCE=feed), drafts a comment per post with the full voice
 * pipeline (SKIP / validate / retry), and prints exactly what WOULD be posted.
 *
 *   node scripts/feed-preview.js [--max 3]
 *
 * Check every line; set LINKEDIN_FEED_REPLY=true only once they all read right.
 *
 *   node scripts/feed-preview.js --viral [--max 3]
 *
 * The viral pass: posts by the big names in config/viral.js and the day's most-engaged launches and
 * funding news, with the comment each would get (score, reactions and age shown). Posts nothing.
 *
 *   node scripts/feed-preview.js --connect [--live N]
 *
 * Connection requests: a dry run lists who would be invited. With --live it REALLY sends N
 * requests (within the daily/weekly caps) and records them in the tracker.
 *
 *   node scripts/feed-preview.js --likes
 *
 * The like pass: the posts it would like and the authors it would follow. Likes and follows nothing.
 */
const fs = require("fs");
const path = require("path");
const { REPO_ROOT } = require("../src/utils/helpers");

const args = process.argv.slice(2);
let max = 3;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--max" && args[i + 1]) max = Math.max(1, Math.min(10, parseInt(args[i + 1], 10) || 3));
}

// A running pipeline owns the tracker file: two writers would lose tracker entries. A lock whose pid is gone is stale.
function pipelineRunning() {
  const lockPath = process.env.PIPELINE_LOCK_PATH || path.join(REPO_ROOT, ".pipeline.lock");
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
  const feedEngage = require("../src/services/feedEngage");
  // --connect [--live N]: preview (or, with --live, really send) N connection requests.
  if (args.includes("--connect")) {
    const li = args.indexOf("--live");
    const n = li >= 0 ? Math.max(1, parseInt(args[li + 1], 10) || 2) : 5;
    const r = await feedEngage.runConnectPass({ min: n, max: n, dryRun: li < 0 });
    (r.previews || []).forEach((p, i) => console.log(`${i + 1}. ${p.name} [${p.kw}] ${p.text}`));
    console.log(`\nConnect ${li < 0 ? "DRY RUN" : "LIVE"}: ${r.sent}/${r.target} (scanned ${r.scanned}) ${r.reason || ""}`);
    process.exit(0);
  }
  // --likes: what the like pass would like and follow (dry: no action session).
  if (args.includes("--likes")) {
    const r = await feedEngage.runLikePass({ min: max, max, dryRun: true });
    (r.picks || []).forEach((p, i) => console.log(`${i + 1}. @${p.author} (score ${p.score})${p.follow ? " +follow" : ""}: "${p.snippet.replace(/\s+/g, " ")}..."`));
    console.log(`\nLikes DRY RUN: ${r.picked}/${r.target} picked. ${r.reason || ""}`);
    process.exit(0);
  }
  const viral = args.includes("--viral");
  const r = await (viral ? feedEngage.runViralPass : feedEngage.runFeedEngagement)({ max, dryRun: true });
  console.log("\n================ PREVIEW ================");
  (r.previews || []).forEach((p, i) => {
    const m = (p.postText || "").match(/\d+\s*(?:mo|yr|[smhdw])\s*•/);
    const body = m ? (p.postText || "").slice(m.index + m[0].length).trim() : (p.postText || "");
    console.log(`\n--- [${i + 1}] @${p.author} [${p.sort || p.kind || "peer"}]${viral ? ` score ${p.score}, ${p.reactions} reactions, ${Math.round(p.ageH)}h old` : ""} ---`);
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
    console.log(`COST: ~$${c.usd.toFixed(4)} this run (OpenRouter ${c.prompt}+${c.completion} tok; NVIDIA ${r.cost.nvidia.prompt}+${r.cost.nvidia.completion} tok).`);
  }
  process.exit(0);
})().catch((e) => { console.error("preview failed:", e.message); process.exit(1); });
