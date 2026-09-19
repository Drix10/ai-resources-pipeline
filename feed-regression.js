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
  await t("grounded restatement -> passes as acknowledgment", EVAL_POST, "Pranav Joshi",
    [RESTATE, "PASS: grounded acknowledgment, zero new claims"], true);
  await t("persistent fabrication -> eventually invalid (SKIP)", EVAL_POST, "Pranav Joshi",
    ["Teams cut eval cost by 40% moving to judges, which compounds fast.", "Teams cut eval cost by 40% moving to judges, which compounds fast."], false);
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
  await t("tortured profundity on shallow post -> critic kills", DASH_POST, "Acme Corp",
    ["The dashboard scalability implications are really interesting for modern teams.", "FAIL: content-free, names no specific point",
     "The dashboard scalability implications are really interesting for modern teams.", "FAIL: content-free"], false);
  await t("generator SKIP on shallow post -> skipped", DASH_POST, "Acme Corp", ["SKIP"], false, true, 0);
  await t("word-number invention (hundreds of annotators) -> reject",
    "The biggest cost of AI is the context tax. Every question costs explanation time across 20 people and thousands of workflows. Expensive amnesia.",
    "Albert Mao",
    ["Thousands of workflows multiply the context tax, but so do hundreds of human annotators labeling each request.",
     "Thousands of workflows multiply the context tax, but so do hundreds of human annotators labeling each request."], false);
  await t("unsupported analogy (equivalent to knowledge graph) -> reject",
    "The biggest cost of AI is the context tax. Every question costs explanation time across 20 people and thousands of workflows. Expensive amnesia.",
    "Albert Mao",
    ["The context tax is equivalent to the overhead of maintaining a large knowledge graph.",
     "The context tax is equivalent to the overhead of maintaining a large knowledge graph."], false);
  await t("short vague-but-true endorsement -> pass",
    "Hardware hiring is broken. Resume keyword filters miss actual circuit understanding, which is what matters on the bench. ATS systems cannot tell them apart.",
    "Dana K",
    ["The resume-versus-circuit-understanding gap is the whole problem.", "PASS"], true);
  await t("invented edge redesign->token-reduction -> critic kills",
    "Joined Graphify Labs to lead product and AI. Gave the console and website a fresh look. Graphify is an open source on-device knowledge graph engine turning codebases into graphs for agents, cutting token consumption by 70 percent. 119k stars on GitHub.",
    "Raihan Khan",
    ["Graphify's console redesign likely impacts token consumption metrics, given the 70 percent reduction mentioned.", "FAIL: redesign never connected to token reduction in source",
     "Graphify's console redesign likely impacts token consumption metrics, given the 70 percent reduction mentioned.", "FAIL: invented edge"], false);
  await t("imported failure mode (overfitting/accents) -> critic kills",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion and speaking-style categories directly from audio. Recognized self-labeled emotions better than human listeners. Opening access to limited customers first.",
    "Nathan Roll",
    ["Resonance-2 maps 31 emotion categories directly from audio, but nothing in that mapping prevents overfitting to specific accents.", "FAIL: overfitting/accents failure mode absent from post",
     "Resonance-2 maps 31 emotion categories directly from audio, but nothing in that mapping prevents overfitting to specific accents.", "FAIL: imported failure mode"], false);
  await t("implication inside stated edge -> pass",
    "Researchers chained five vulnerabilities into root access in under 60 seconds. Patching any single flaw would not have stopped the chain.",
    "Srinivas L",
    ["Blocking any single flaw leaves four working paths, so the chain survives individual patches.", "PASS"], true);
  await t("prescribed remedy (mitigated by) -> reject",
    "The biggest cost of AI is the context tax. Every question costs explanation time across 20 people and thousands of workflows. Expensive amnesia.",
    "Albert Mao",
    ["The context tax is redundant data ingestion, which can be mitigated by designing more explicit inputs.",
     "The context tax is redundant data ingestion, which can be mitigated by designing more explicit inputs."], false);
  await t("consultant filler (making it easier to) -> reject",
    "Graphify turns codebases into knowledge graphs highlighting impacted files and dependencies before changes ship.",
    "Tushar Mishra",
    ["Graphify highlights impacted files, making it easier to prioritize refactoring efforts across the codebase.",
     "Graphify highlights impacted files, making it easier to prioritize refactoring efforts across the codebase."], false);
  await t("domain import (lexical overlap into emotion eval) -> critic kills",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion and speaking-style categories directly from audio, beating human listeners on self-labeled emotions.",
    "Nathan Roll",
    ["Separating reference-based scoring from judge-based evaluation is useful here. These categories may fail lexical overlap, which is why eval design matters.", "FAIL: lexical overlap / judge-based evaluation absent from post",
     "Separating reference-based scoring from judge-based evaluation is useful here. These categories may fail lexical overlap, which is why eval design matters.", "FAIL: domain import"], false);
  await t("polished acknowledgment of same proposition -> pass",
    "The biggest cost of AI is not the API bill. Every question costs explanation time and context across 20 people and thousands of workflows. Humans repeatedly teach the machine the same company, market, and findings. Expensive amnesia.",
    "Albert Mao",
    ["The workflow overhead of explaining context to AI is compounded by the human effort required to re-explain it across multiple stakeholders.", "PASS: grounded acknowledgment"], true);
  await t("genuine interpretation of latent mechanism -> pass",
    "The biggest cost of AI is not the API bill. Every question costs explanation time and context across 20 people and thousands of workflows. Humans repeatedly teach the machine the same company, market, and findings. Expensive amnesia.",
    "Albert Mao",
    ["The expensive part is not passing context once but losing it between workflows, forcing humans to reconstruct it each time.", "PASS"], true);
  await t("single-sentence acknowledgment -> pass",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion categories directly from audio signals for voice agents.",
    "Nathan Roll",
    ["Continuous audio signals are especially useful here.", "PASS: grounded acknowledgment"], true);
  await t("unsupported causal absent from post -> critic kills", EVAL_POST, "Pranav Joshi",
    ["Reference-based scoring causes teams to abandon BLEU entirely for agents.", "FAIL: unsupported causal claim, post never states abandonment",
     "Reference-based scoring causes teams to abandon BLEU entirely for agents.", "FAIL: unsupported causal claim"], false);
  await t("invented relationship from real numbers -> critic kills",
    "Built GPT-6 Astra with the PaperRoute agent. One developer coordinated coding, 3D assets, checkpoints and iteration. 39 hours tracked development, 69 checkpoints, shipped in days not months.",
    "Tejas Hirurkar",
    ["The 39 hours of tracked development suggest a high degree of automation, but the 69 checkpoints indicate frequent manual intervention.", "FAIL: infers automation and manual intervention from numbers the post never connects",
     "The 39 hours of tracked development suggest a high degree of automation, but the 69 checkpoints indicate frequent manual intervention.", "FAIL: infers automation and manual intervention"], false);
  await t("invented causal link (sponsored -> enabled) -> critic kills",
    "Infosys workshop on AI agents with hands-on labs in a sponsored sandbox environment. Leaders joined and interacted with teams throughout the day.",
    "Ramesh Rajini",
    ["The sponsored sandbox made the hands-on mode possible, and leaders leveled up the sessions.", "FAIL: post never says sponsorship enabled anything",
     "The sponsored sandbox made the hands-on mode possible, and leaders leveled up the sessions.", "FAIL: invented causal link"], false);
  await t("correct attribution of same facts -> pass",
    "At Pwn2Own Ireland 2025 researchers chained five vulnerabilities against a Galaxy S25 and gained root access in under 60 seconds.",
    "Srinivas L",
    ["Five chained flaws collapsing to root in under a minute means the path matters more than any single bug.", "PASS"], true);
  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})();
