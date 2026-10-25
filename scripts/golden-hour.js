/**
 * scripts/golden-hour.js
 *
 * Run it right after you publish a LinkedIn post: for the post's first 90 minutes (the stretch that decides its
 * reach) it reads the comments on your posts under 3 hours old every 4-6 minutes and answers each new one, a
 * drafted and judged reply as the pipeline's replies pass writes them. A comment only you can answer (your own
 * experience, a number, a plan) is printed for you, never guessed.
 *
 *   npm run golden [-- --minutes 90] [--dry]
 *
 * --dry drafts and prints the replies and posts nothing. Not while the pipeline runs (it owns the LinkedIn tab;
 * the pipeline's own replies pass covers the start of a run and every batch).
 */
const { pipelineRunning } = require("./pipeline-lock");

const args = process.argv.slice(2);
const at = args.indexOf("--minutes");
const minutes = at >= 0 ? Math.max(5, Math.min(240, parseInt(args[at + 1], 10) || 90)) : 90;
const dryRun = args.includes("--dry");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (pipelineRunning()) {
    console.error("The pipeline is running (.pipeline.lock with a live pid): its replies pass answers comments after each batch. Run this after it finishes.");
    process.exit(1);
  }
  const feedEngage = require("../src/services/feedEngage");
  let stop = false;
  process.on("SIGINT", () => { stop = true; console.log("\nStopping after this round."); });
  const end = Date.now() + minutes * 60000;
  const owner = new Map();
  let replied = 0;
  console.log(`Golden hour: watching your posts under 3 h old for ${minutes} min${dryRun ? " (dry run: nothing is posted)" : ""}.`);
  while (!stop && Date.now() < end) {
    const r = await feedEngage.runOwnRepliesPass({ max: 10, maxAgeH: 3, dryRun, shouldStop: () => stop });
    replied += r.replied;
    for (const p of r.previews) console.log(`\n${p.name}: "${p.comment}"\n  -> ${p.reply}`);
    for (const o of r.owner) owner.set(`${o.name}|${o.comment}`, o);
    console.log(`[${new Date().toLocaleTimeString()}] ${dryRun ? "would post" : "posted"} ${r.replied}, ${r.owner.length} for you, ${r.skipped} skipped${r.reason ? ` (${r.reason})` : ""}.`);
    // A blocked LinkedIn (signed out, checkpoint, cap) will not clear within the hour.
    if (/linkedin unavailable|cap reached/.test(r.reason)) break;
    const wait = 240000 + Math.random() * 120000;
    for (const t = Date.now(); !stop && Date.now() - t < wait && Date.now() < end;) await sleep(1000);
  }
  if (owner.size) {
    console.log("\nAnswer these yourself (your own experience or a decision the post does not hold):");
    for (const o of owner.values()) console.log(`- ${o.name}: "${o.comment}"\n  ${o.question}`);
  }
  console.log(`\nDone: ${replied} ${dryRun ? "replies drafted" : "replies posted"}.`);
  await feedEngage.cleanup().catch(() => {});
  process.exit(0);
})().catch((e) => { console.error("golden hour failed:", e.message); process.exit(1); });
