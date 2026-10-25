/**
 * scripts/post-check.js
 *
 * Check a LinkedIn post before you publish it: what LinkedIn's ranking holds against it (links in the body,
 * hashtag stacks, engagement bait, a weak opening), checked in code, then a review of the draft and three
 * stronger openings built only from its own facts. Posts nothing.
 *
 *   npm run post-check -- draft.txt
 *   npm run post-check < draft.txt
 *
 * After publishing, run `npm run golden` to answer the comments in the post's first 90 minutes.
 */
const fs = require("fs");
const { checkPost, postHook } = require("../src/utils/postCheck");

(async () => {
  const file = process.argv[2];
  const draft = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  if (!draft.trim()) {
    console.error("Give the draft as a file (npm run post-check -- draft.txt) or on stdin.");
    process.exit(1);
  }
  console.log(`What readers see before "...more":\n---\n${postHook(draft)}\n---\n`);
  const found = checkPost(draft);
  for (const f of found) console.log(`${f.level === "fix" ? "FIX " : "NOTE"}  ${f.msg}`);
  if (!found.length) console.log("No ranking problems found in code.");
  const llm = require("../src/services/llm");
  try {
    const r = await llm.reviewOwnPost(draft);
    console.log(`\nReview: ${r.verdict}`);
    r.fixes.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    if (r.hooks.length) console.log("\nStronger openings (from your own facts):");
    r.hooks.forEach((h) => console.log(`  - ${h}`));
  } catch (e) {
    console.log(`\n(The review could not run: ${e.message}. The checks above still hold.)`);
  }
  process.exit(0);
})().catch((e) => { console.error("post check failed:", e.message); process.exit(1); });
