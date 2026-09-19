/** feed-regression.js: adversarial regression set for the LinkedIn comment pipeline.
 * Usage: node feed-regression.js
 * Drafts + critic verdicts are stubbed (deterministic); the full draft->gates->critic->retry
 * wiring under test is real. Anything here failing blocks enabling LINKEDIN_FEED_REPLY.
 */
const svc = require("./src/services/llm.js");

let queue = [];
svc.generateText = async (p) => {
  const item = queue.shift();
  if (item === undefined) throw new Error("mock queue empty for prompt: " + String(p).slice(0, 80));
  return item;
};

const EVAL_POST = "LLM eval methods compared: BLEU and ROUGE need references, embedding similarity is softer, LLM judges score semantics, agents need behavioural evals, metric design matters";
const DASH_POST = "We shipped our new dashboard today with latency charts and error budgets. Grateful for the team and excited for next quarter growth and numbers";
const GOOD_EVAL = "Separating reference-based scoring from judge-based evaluation is the useful move here. A semantically correct output can fail lexical overlap, which is why eval design matters as much as the metric.";
const RESTATE = "BLEU and ROUGE need references while judges score semantics and agents need behavioural evals.";

let passed = 0, failed = 0;
async function t(name, post, author, responses, expectValid, expectSkipped = false, retries = 1) {
  queue = [...responses];
  let r;
  try {
    r = await svc.draftFeedComment({ postAuthor: author, postText: post }, retries);
  } catch (e) {
    console.log(`FAIL | ${name} | threw: ${e.message}`);
    failed++;
    return;
  }
  const ok = (r.isValid === expectValid) && (!!r.skipped === expectSkipped);
  if (ok) passed++; else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${name} | valid=${r.isValid} (want ${expectValid})${expectSkipped ? ` skipped=${!!r.skipped}` : ""} | ${(r.errors || []).join("; ").slice(0, 130)}`);
}

(async () => {
  await t("generic praise -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post! Really insightful breakdown of eval methods today.", "Great post! Really insightful breakdown of eval methods today."], false);
  await t("restatement -> critic kills, retry contributes -> pass", EVAL_POST, "Pranav Joshi",
    [RESTATE, "FAIL: restates the post, adds no observation or tradeoff", GOOD_EVAL, "PASS"], true);
  await t("persistent restatement -> eventually invalid (SKIP)", EVAL_POST, "Pranav Joshi",
    [RESTATE, "FAIL: restates the post", RESTATE, "FAIL: restates the post"], false);
  await t("unsupported statistic -> reject", EVAL_POST, "Pranav Joshi",
    ["Teams cut eval cost by 40% moving to judges, which compounds fast.", "Teams cut eval cost by 40% moving to judges, which compounds fast."], false);
  await t("unsupported causal/conclusive -> reject", EVAL_POST, "Pranav Joshi",
    ["This proves lexical metrics are obsolete for agents now.", "This proves lexical metrics are obsolete for agents now."], false);
  await t("unsupported comparison (NVIDIA shape) -> reject",
    "NVIDIA ran a nationwide high-resolution climate model workflow in 2 days on DGX systems, deployed locally for near-term forecasting use",
    "NVIDIA",
    ["The DGX boxes pulling a nationwide run in 2 days is fast, NVIDIA, and inference staying on the same boxes is what settles it against classic climate models.",
     "The DGX boxes pulling a nationwide run in 2 days is fast, NVIDIA, and inference staying on the same boxes is what settles it against classic climate models."], false);
  await t("wedged full-name vocative -> reject", EVAL_POST, "Pranav Joshi",
    ["BLEU is sensitive to word order, Pranav Joshi, which hurts recall on long outputs.", "BLEU is sensitive to word order, Pranav Joshi, which hurts recall on long outputs."], false);
  await t("natural leading mention + substance -> pass", EVAL_POST, "Pranav Joshi",
    ["Pranav, the references-vs-judges distinction matters because judges score semantics where references demand lexical match, so metric design decides what gets optimized.", "PASS"], true);
  await t("good draft with banned phrase -> reject", EVAL_POST, "Pranav Joshi",
    ["The key takeaway is eval design matters as much as the metric for judges.", "The key takeaway is eval design matters as much as the metric for judges."], false);
  await t("tortured profundity on shallow post -> reject", DASH_POST, "Acme Corp",
    ["The dashboard scalability implications are really interesting for modern teams.", "The dashboard scalability implications are really interesting for modern teams."], false);
  await t("generator SKIP on shallow post -> skipped", DASH_POST, "Acme Corp", ["SKIP"], false, true, 0);
  await t("unsupported causal absent from post -> critic kills", EVAL_POST, "Pranav Joshi",
    ["Reference-based scoring causes teams to abandon BLEU entirely for agents.", "FAIL: unsupported causal claim, post never states abandonment",
     "Reference-based scoring causes teams to abandon BLEU entirely for agents.", "FAIL: unsupported causal claim"], false);
  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})();
