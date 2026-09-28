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
const realGenerateCommentText = svc.generateCommentText.bind(svc);
// Hermetic suite: route the reply entry point through the mock too. Without this,
// a real OPENROUTER_API_KEY in .env sends every draft/critic to the live API
// (nondeterministic results AND real spend on every test run).
svc.generateCommentText = async (prompt, opts) => svc.generateText(prompt, opts);

const EVAL_POST = "LLM eval methods compared: BLEU and ROUGE need references, embedding similarity is softer, LLM judges score semantics, agents need behavioural evals, metric design matters";
const DASH_POST = "We shipped our new dashboard today with latency charts and error budgets. Grateful for the team and excited for next quarter growth and numbers";
const GOOD_EVAL = "Separating reference-based scoring from judge-based evaluation is the useful move here. A semantically correct output can fail lexical overlap, which is why eval design matters as much as the metric.";

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
  await t("simple praise with point -> pass", EVAL_POST, "Pranav Joshi",
    ["The eval methods breakdown really lands.", "PASS: names the subject"], true);
  await t("opener with substance -> pass", EVAL_POST, "Pranav Joshi",
    ["This nails references over embedding similarity.", "PASS: names the point"], true);
  await t("announcement acknowledgment -> pass",
    "Announcing the Cambridge x Tencent Games hackathon, Oct 10-11. Student teams build game prototypes, judged by engineers.",
    "Jessy Tang",
    ["The Cambridge plus Tencent Games hackathon deserves more attention.", "PASS: grounded acknowledgment"], true);
  await t("lone lowercase noun X (vibecode) -> reject",
    "some guy wanted me to build his entire app and website for equity. He had an idea and a poorly-vibecoded homepage. You should vibecode, but at least do it well.",
    "YangMing Jiang",
    ["Good reminder on vibecode.", "Good reminder on vibecode."], false);
  await t("free-form natural comment -> pass",
    "Most AI engineers learn how to use LLMs. Very few learn how they actually work under the hood. This Stanford CS336 playlist is a gem if you want to go deeper. It doesn't just teach you how to use existing models. It takes you closer to understanding what happens underneath them. 11 FREE lectures from Stanford.",
    "Arindam Majumder",
    ["Closer to what happens underneath the models.", "PASS: specific and grounded"], true);
  await t("dead praise (great post family) -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post on judges and references.", "Great post on judges and references."], false);
  await t("dead thanks-for-sharing -> reject",
    "Announcing the Cambridge x Tencent Games hackathon, Oct 10-11. Student teams build game prototypes, judged by engineers.",
    "Jessy Tang",
    ["Thanks for sharing this!", "Thanks for sharing this!"], false);
  await t("while-contrast clause X -> reject", EVAL_POST, "Pranav Joshi",
    ["Well said on judges score semantics while BLEU and ROUGE need references.", "Well said on judges score semantics while BLEU and ROUGE need references."], false);
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
  await t("while-contrast clause X with name -> reject", EVAL_POST, "Pranav Joshi",
    ["Pranav, well said on judges score semantics while BLEU and ROUGE need references.", "Pranav, well said on judges score semantics while BLEU and ROUGE need references."], false);
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
    ["Resume keyword filters missing actual circuit understanding is the whole point.", "PASS"], true);
  await t("invented edge redesign->token-reduction -> critic kills",
    "Joined Graphify Labs to lead product and AI. Gave the console and website a fresh look. Graphify is an open source on-device knowledge graph engine turning codebases into graphs for agents, cutting token consumption by 70 percent. 119k stars on GitHub.",
    "Raihan Khan",
    ["Graphify's console redesign impacts token consumption metrics, given the 70 percent reduction mentioned.", "FAIL: redesign never connected to token reduction in source",
     "Graphify's console redesign impacts token consumption metrics, given the 70 percent reduction mentioned.", "FAIL: invented edge"], false);
  await t("imported failure mode (overfitting/accents) -> critic kills",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion and speaking-style categories directly from audio. Recognized self-labeled emotions better than human listeners. Opening access to limited customers first.",
    "Nathan Roll",
    ["Resonance-2 maps 31 emotion categories directly from audio, but nothing in that mapping prevents overfitting to specific accents.", "FAIL: overfitting/accents failure mode absent from post",
     "Resonance-2 maps 31 emotion categories directly from audio, but nothing in that mapping prevents overfitting to specific accents.", "FAIL: imported failure mode"], false);
  await t("derived implication is added knowledge -> reject",
    "Researchers chained five vulnerabilities into root access in under 60 seconds. Patching any single flaw would not have stopped the chain.",
    "Srinivas L",
    ["Blocking any single flaw leaves four working paths, so the chain survives individual patches.", "Blocking any single flaw leaves four working paths, so the chain survives individual patches."], false);
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
    ["Every question costing explanation time across thousands of workflows is the key detail here.", "PASS: grounded acknowledgment"], true);
  await t("latent-mechanism interpretation is added knowledge -> reject",
    "The biggest cost of AI is not the API bill. Every question costs explanation time and context across 20 people and thousands of workflows. Humans repeatedly teach the machine the same company, market, and findings. Expensive amnesia.",
    "Albert Mao",
    ["The expensive part is not passing context once but losing it between workflows, forcing humans to reconstruct it each time.", "The expensive part is not passing context once but losing it between workflows, forcing humans to reconstruct it each time."], false);
  await t("single-sentence acknowledgment -> pass",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion categories directly from audio signals for voice agents.",
    "Nathan Roll",
    ["Scoring emotion categories directly from audio signals is useful here.", "PASS: grounded acknowledgment"], true);
  await t("typo of post term (halucinated) -> reject",
    "Testing a small quantized model offline on Android. It sometimes produces hallucinated or inaccurate answers on device.",
    "Anwar Zahid",
    ["The model's halucinated output could be due to the small size and quantization.",
     "The model's halucinated output could be due to the small size and quantization."], false);
  await t("verdict filler (classic case / crucial aspect) -> reject", EVAL_POST, "Pranav Joshi",
    ["This is a classic case of eval drift, a crucial aspect of metric design.",
     "This is a classic case of eval drift, a crucial aspect of metric design."], false);
  await t("mid-sentence name drop -> reject",
    "The biggest cost of AI is context tax. Humans repeatedly teach the machine the same thing.",
    "Albert Mao",
    ["The context tax Albert Mao is talking about is a real problem.",
     "The context tax Albert Mao is talking about is a real problem."], false);
  await t("hedged speculation (likely) -> reject", EVAL_POST, "Pranav Joshi",
    ["This approach likely reduces eval fragmentation across teams.",
     "This approach likely reduces eval fragmentation across teams."], false);
  await t("imported machinery (knowledge graph) -> reject",
    "The biggest cost of AI is context tax. Humans repeatedly teach the machine the same thing.",
    "Albert Mao",
    ["The overhead comes from maintaining a large knowledge graph.",
     "The overhead comes from maintaining a large knowledge graph."], false);
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
    ["Well said on chaining five vulnerabilities to root access in under 60 seconds.", "PASS"], true);
  // Reply-system V2: the prof-joined-college bug class. Vague goodwill passes,
  // invented role/subject details fail even when wrapped in congratulations.
  await t("prof joined college: invented teaching details -> reject",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["Teaching data structures at ABC College will shape young minds, congratulations on the role!", "Teaching data structures at ABC College will shape young minds, congratulations on the role!"], false);
  await t("prof joined college: plain congrats -> pass",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["Congratulations on joining ABC College, well deserved!", "PASS: grounded congrats"], true);
  await t("content-free echo -> critic kills",
    "what is it: we are opening up our office to people outside, for as long as we have the room. What you get: a desk, good coffee, good company. Free.",
    "Naman Anand",
    ["Desk, good coffee, good company is free.", "FAIL: echo, restates the offer with zero reaction",
     "Desk, good coffee, good company is free.", "FAIL: echo"], false);
  await t("false attendance (loved the session) -> reject",
    "Attended the Python Meets Rust Bengaluru Meetup at Rippling. Ishaan Arora explored Unicode and text handling in Python. Nihal introduced cuda-oxide for CUDA kernels in Rust.",
    "Hetav Pai",
    ["I loved the session on cuda-oxide.", "I loved the session on cuda-oxide."], false);
  await t("false attendance (great meeting you) -> reject",
    "Attended the Python Meets Rust Bengaluru Meetup at Rippling. Grateful to all three speakers for sharing their knowledge.",
    "Hetav Pai",
    ["Great meeting you at the Rippling meetup.", "Great meeting you at the Rippling meetup."], false);
  await t("false attendance (my takeaway) -> reject",
    "Understanding how different technologies solve different problems is just as important as learning the languages themselves.",
    "Hetav Pai",
    ["My takeaway matches yours on technologies.", "My takeaway matches yours on technologies."], false);
  await t("spaced banned variant (game changer) -> reject",
    "Jev is the first game changer in the AI space since GPT3.5. It opens up use cases that were too expensive and slow previously, relevant where rule following matters.",
    "Alex Hinds",
    ["The Jev game changer lands.", "The Jev game changer lands."], false);
  await t("bare great-post goodwill is slop -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post, thanks for sharing!", "Great post, thanks for sharing!"], false);
  await t("rotated ACK shape (key detail) -> pass", EVAL_POST, "Pranav Joshi",
    ["BLEU and ROUGE needing references is the key detail here.", "PASS"], true);
  await t("headline nouns are not the topic -> reject",
    "Recently, I interviewed several intern candidates. Most used AI coding tools extensively, but some could not explain what they built or how they would validate the outputs.",
    "Sasha Yan",
    ["Great post on Machine Learning Engineer.", "Great post on Machine Learning Engineer."], false);
  await t("bare Great post! is slop -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post!", "Great post!"], false);
  await t("lone-generic X is slop -> reject",
    "A friend got interviewed by an AI today for an AI engineer role. The AI recorded expressions and eye movements through the webcam. Crazy times coming up.",
    "Md. Tazbinur",
    ["The AI part really lands.", "The AI part really lands."], false);
  await t("good reminder frame -> pass",
    "I built a free open-source macOS app called Always Whisper. It listens to your voice and transcribes in real time using a local Whisper model. Everything runs on your Mac.",
    "Kazuki Hayakawa",
    ["Good reminder on Always Whisper.", "PASS"], true);
  await t("this-nails frame -> pass",
    "For the hackathon we built a Bluetooth-Controlled RC Car. Smart obstacle detection with proximity sensors. It was an incredible experience bridging hardware and software, excited for many more builds ahead.",
    "A P Sai Yeshas",
    ["This nails the RC Car build.", "PASS"], true);
  await t("bare Congrats! -> pass",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["Congrats!", "PASS: vague goodwill"], true);
  await t("birthday congrats on birthday post -> pass",
    "I just turned 20, and I still don't know if I've been chasing the right thing. From selling candy at 7 to becoming CMO of a YC startup at 19. But that's my life so far. So cheers to me turning 20.",
    "Hank Wu",
    ["Happy 20th!", "PASS: main-event congrats"], true);
  console.log(`\n${passed} passed, ${failed} failed.`);
  // Scanner spam-gate unit tests (pure predicate, no browser).
  const LinkedInService = require("./src/services/linkedin.js");
  const spamCases = [
    ["life update (joined college) passes", "Ravi Kumar • 1st • 2h • Follow Excited to share I have joined ABC College as an Assistant Professor. Happy to announce I have joined the faculty.", false],
    ["promotion announcement passes", "Jane Doe • 1st • 3h Thrilled to share I have been promoted to Senior Engineer. Grateful for the team.", false],
    ["work anniversary passes", "John Smith • 1st • 5h Celebrating 5 years at Acme Corp. What a journey it has been with this team.", false],
    ["giveaway spam blocked", "Win a free course! Giveaway ends soon, sign up now with limited spots available today.", true],
    ["hiring spam blocked", "We are hiring for backend engineers, dm me to apply and join my team today.", true],
    ["engagement bait blocked", "Say congrats on my promotion! Congratulate me in the comments below friends.", true],
    ["LinkedIn ad label blocked", "Acme Corp • Promoted • Follow Our new cloud platform scales to millions of requests per day.", true],
    ["webinar promo blocked", "Join our free webinar on AI agents. Register now, cohort starts Monday, early bird pricing.", true],
    ["connections-only comment gate skipped", "Excited for this next chapter building Sona8! Thank you to everyone. Only connections can comment on this post.", true],
  ];
  for (const [name, text, wantSpam] of spamCases) {
    const got = LinkedInService.isFeedSpamText(text);
    if (got === wantSpam) { passed++; console.log(`PASS | spam-gate: ${name}`); }
    else { failed++; console.log(`FAIL | spam-gate: ${name} | got=${got} want=${wantSpam}`); }
  }
  // OpenRouter router: uses OpenRouter when keyed, else legacy comment-model path.
  {
    const config = require("./config");
    const realFetch = global.fetch;
    const seen = {};
    global.fetch = async (url, opts) => {
      seen.url = String(url); seen.auth = opts?.headers?.Authorization; seen.body = JSON.parse(opts?.body || "{}");
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "routed reply" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
    };
    const saveModel = config.llm.openrouter.model;
    config.llm.openrouter.apiKey = "test-key";
    config.llm.openrouter.model = "test/linkedin-model";
    const out = await realGenerateCommentText("hello", { temperature: 0.5, num_predict: 50, system: "sys", reasoning: "low", model: "foreign/slug" });
    const payloadOk = seen.body.model === "test/linkedin-model"
      && seen.body.temperature === 0.5 && seen.body.max_tokens === 50
      && !("reasoning_effort" in seen.body) && seen.body.stream === false;
    const urlOk = seen.url === "https://openrouter.ai/api/v1/chat/completions" && seen.auth === "Bearer test-key";
    if (out === "routed reply" && urlOk && payloadOk) { passed++; console.log("PASS | openrouter: keyed route hits API with clean payload"); }
    else { failed++; console.log(`FAIL | openrouter: keyed route | out=${out} urlOk=${urlOk} payloadOk=${payloadOk} body=${JSON.stringify(seen.body).slice(0, 160)}`); }
    // Error path throws (so draft retry / fallback engages).
    global.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
    let threw = false;
    try { await svc.generateTextViaOpenRouter("hi", {}); } catch (e) { threw = /500|boom/.test(e.message); }
    if (threw) { passed++; console.log("PASS | openrouter: 500 throws"); }
    else { failed++; console.log("FAIL | openrouter: 500 throws"); }
    // No key -> legacy path with comment-model override (no fetch).
    config.llm.openrouter.apiKey = "";
    const saveLocal = config.llm.useLocal; config.llm.useLocal = false;
    let legacyOpts = null;
    const realVia = svc.generateTextViaNvidia;
    svc.generateTextViaNvidia = async (p, o) => { legacyOpts = o; return "legacy reply"; };
    const out2 = await realGenerateCommentText("hello", { temperature: 0.2 });
    svc.generateTextViaNvidia = realVia;
    config.llm.useLocal = saveLocal;
    config.llm.openrouter.model = saveModel;
    global.fetch = realFetch;
    if (out2 === "legacy reply" && legacyOpts && typeof legacyOpts.model === "string") { passed++; console.log("PASS | openrouter: keyless falls back to legacy comment model"); }
    else { failed++; console.log(`FAIL | openrouter: keyless fallback | out=${out2} opts=${JSON.stringify(legacyOpts)}`); }
  }
  // LinkedIn post chain: OpenRouter first, NVIDIA on failure, never Gemini.
  {
    const config = require("./config");
    const realFetch = global.fetch;
    const realVia = svc.generateTextViaNvidia;
    const save = { or: config.llm.openrouter.apiKey, orm: config.llm.openrouter.model, nv: config.llm.nvidia.apiKey, local: config.llm.useLocal };
    config.llm.useLocal = false;
    try {
      let fetches = 0, nvidiaCalls = 0;
      svc.generateTextViaNvidia = async () => { nvidiaCalls++; return "nvidia post"; };
      config.llm.openrouter.apiKey = "test-or-key"; config.llm.openrouter.model = "test/linkedin-model";
      global.fetch = async () => { fetches++; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "openrouter post" } }] }) }; };
      const first = await svc.generateLinkedInText("write", {});
      if (first === "openrouter post" && nvidiaCalls === 0) { passed++; console.log("PASS | chain: openrouter serves posts first"); }
      else { failed++; console.log(`FAIL | chain: openrouter first | out=${first} nvidia=${nvidiaCalls}`); }
      global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad model" });
      const fell = await svc.generateLinkedInText("write", {});
      if (fell === "nvidia post") { passed++; console.log("PASS | chain: openrouter error -> nvidia serves"); }
      else { failed++; console.log(`FAIL | chain: fallback | out=${fell}`); }
      config.llm.openrouter.model = ""; fetches = 0;
      const noModel = await svc.generateLinkedInText("write", {});
      if (noModel === "nvidia post" && fetches === 0) { passed++; console.log("PASS | chain: no OPENROUTER_MODEL skips openrouter"); }
      else { failed++; console.log(`FAIL | chain: no model | out=${noModel} fetches=${fetches}`); }
      svc.generateTextViaNvidia = realVia;
      config.llm.openrouter.apiKey = ""; config.llm.nvidia.apiKey = "";
      let threw = false;
      try { await svc.generateLinkedInText("write", {}); } catch (e) { threw = /NVIDIA|missing/i.test(e.message); }
      if (threw) { passed++; console.log("PASS | chain: exhaustion throws for skip logic"); }
      else { failed++; console.log("FAIL | chain: exhaustion did not throw"); }
      if (!("gemini" in config.llm) && typeof svc.generateTextViaGemini === "undefined") { passed++; console.log("PASS | gemini fully removed"); }
      else { failed++; console.log("FAIL | gemini still present"); }
    } finally {
      svc.generateTextViaNvidia = realVia;
      config.llm.openrouter.apiKey = save.or; config.llm.openrouter.model = save.orm;
      config.llm.nvidia.apiKey = save.nv; config.llm.useLocal = save.local; global.fetch = realFetch;
    }
  }
  // SIMPLE MODE: raw passthrough, would-be-rejected drafts ship verbatim.
  {
    const config = require("./config");
    config.social.linkedinSimpleReply = true;
    queue = ["Teaching data structures at ABC College will shape young minds!"];
    const r = await svc.draftFeedComment({ postAuthor: "Ravi Kumar", postText: "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter." }, 0);
    config.social.linkedinSimpleReply = false;
    if (r.isValid && !r.skipped && /teaching data structures/i.test(r.comment)) { passed++; console.log("PASS | simple mode passes raw reply through"); }
    else { failed++; console.log(`FAIL | simple mode passes raw reply through | valid=${r.isValid} comment=${JSON.stringify(r.comment).slice(0, 80)}`); }
  }
  // Cost estimator: your preview run (~39.6k prompt + ~0.5k completion tok) at DeepSeek V4 Flash rates.
  {
    const usd = svc.commentCostUsd(39588, 538, "deepseek/deepseek-v4-flash");
    const fallback = svc.commentCostUsd(1000, 100, "some/unknown-model");
    if (Math.abs(usd - 0.005693) < 0.0005 && Math.abs(fallback - 0.0004) < 1e-9) { passed++; console.log(`PASS | cost estimator ($${usd.toFixed(4)})`); }
    else { failed++; console.log(`FAIL | cost estimator | usd=${usd} fallback=${fallback}`); }
  }
  // Thin-post guard: throws before any LLM call (no mock consumed).
  queue = ["SHOULD-NOT-BE-CONSUMED"];
  try {
    await svc.draftFeedComment({ postAuthor: "X", postText: "Hi ok thanks bye" }, 0);
    failed++; console.log("FAIL | thin post throws | returned instead of throwing");
  } catch (e) {
    if (/too thin/i.test(e.message) && queue.length === 1) { passed++; console.log("PASS | thin post throws"); }
    else { failed++; console.log(`FAIL | thin post throws | ${e.message} queue=${queue.length}`); }
  }
  // Body extraction: headline/tallies never reach drafting. Key stability: normal
  // cards (timestamp within 10 lines) must hash exactly as before the refactor.
  const oldKeySrc = (tlines) => {
    let bodyStart = 0;
    for (let i = 0; i < Math.min(tlines.length, 10); i++) {
      if (/\d+\s*[smhdw]\s*•/.test(tlines[i])) { bodyStart = i + 1; break; }
    }
    const bodyOnly = tlines.slice(bodyStart).join("\n").replace(/^follow\s*$/gim, "");
    return bodyOnly.replace(/(\n\s*[\d][\d\s,.KMB]*)+$/, "");
  };
  const bodyCases = [
    // Leading newline mirrors the pre-refactor computation exactly (key stability);
    // downstream drafting trims it. keyOk asserts byte-equality with oldKeySrc.
    ["timestamp card strips headline+tallies",
      ["Feed post", "Sasha Yan • 3rd+", "Machine Learning Engineer at Foo", "5h • Edited", "Follow", "Recently, I interviewed several intern candidates about AI tools.", "14", "4"],
      "\nRecently, I interviewed several intern candidates about AI tools.", true],
    // No timestamp in range: follow-fallback drops the header. Key rotates here by
    // design (old code keyed WITH the header); only exotic cards take this path.
    ["follow-fallback card strips header without timestamp",
      ["Feed post", "Jane Doe • 2nd", "Founder at Bar", "Edited •", "Follow", "Thrilled to share I have been promoted to Senior Engineer.", "7"],
      "Thrilled to share I have been promoted to Senior Engineer.", false],
  ];
  for (const [name, lines, wantBody, wantKeyStable] of bodyCases) {
    const got = LinkedInService.postBodyFromLines(lines);
    const bodyOk = got === wantBody;
    const keyOk = !wantKeyStable || got === oldKeySrc(lines);
    if (bodyOk && keyOk) { passed++; console.log(`PASS | body: ${name}`); }
    else { failed++; console.log(`FAIL | body: ${name} | bodyOk=${bodyOk} keyOk=${keyOk} got=${JSON.stringify(got).slice(0, 120)}`); }
  }
  // Hiring-ad spam (the "We're hiring ... Currently unpaid ... Apply:" shape).
  const adText = "Naman Jha • 2nd Founder 6d • Follow We are building from scratch and hiring our first 25 Founding Engineers for AI solutions. Currently unpaid founding-team opportunity. Apply: https://lnkd.in/abc Build from zero.";
  if (LinkedInService.isFeedSpamText(adText) === true) { passed++; console.log("PASS | spam-gate: hiring ad blocked"); }
  else { failed++; console.log("FAIL | spam-gate: hiring ad blocked"); }
  // Attribution gates: activity chrome + merged-author cards must never draft.
  const attrCases = [
    ["repost (followed-by) skipped", "Feed post Followed by Rohini Chaudhari Shrey Shah • 2nd 6d • Follow Jev is a new model for decisions.", true, false],
    ["comment-activity card skipped", "Feed post\nHank Wu commented\nDylan Pak • 2nd\nCMO at Moo\n3h •\nSome post about startups and growth.", true, false],
    ["supports-activity skipped", "Feed post Naman Anand supports this Satyam Singh • 2nd 4h • Follow Post about hiring engineers.", true, false],
    ["reposted-this skipped", "Feed post John Doe reposted this Jane Smith • 1st 8h • Follow Post about AI safety work.", true, false],
    ["normal post passes activity gate", "Feed post Sasha Yan • 3rd+ Machine Learning Engineer 5h • Follow Recently I interviewed intern candidates.", false, false],
    ["post discussing comments passes", "Feed post Dana K • 2nd Engineer 2h • Follow The most commented threads this week share one trait.", false, false],
    ["merged judge+winner card skipped", "Feed post Uday Kumar V • 2nd Proud judge at the hackathon. Affan Khan • 3rd+ Thrilled to share my team secured 1st place.", false, true],
    ["single-author card passes", "Feed post Pratheek N • 1st Founder 7m • Follow Thrilled to announce a grant from Mercatus.", false, false],
  ];
  for (const [name, text, wantActivity, wantMixed] of attrCases) {
    const a = LinkedInService.isActivityCard(text);
    const m = LinkedInService.hasMixedAuthors(text);
    if (a === wantActivity && m === wantMixed) { passed++; console.log(`PASS | attr: ${name}`); }
    else { failed++; console.log(`FAIL | attr: ${name} | activity=${a}(want ${wantActivity}) mixed=${m}(want ${wantMixed})`); }
  }
  // Recommendation modules are UI, not posts: jobs/people cards must never draft or like.
  const moduleCases = [
    ["jobs module skipped", "Feed post Jobs recommended for you AI First Product Manager Deltek Bengaluru (Remote) 1 school alumni works here Actively reviewing applicants Show more", true],
    ["people module skipped", "Feed post People you may know Anish Kumar • 2nd Founder at Foo 5d • Follow", true],
    ["normal post passes module gate", "Feed post Sasha Yan • 3rd+ Machine Learning Engineer 5h • Follow Recently I interviewed intern candidates.", false],
    ["sponsored-sandbox post passes module gate", "Infosys workshop on AI agents with hands-on labs in a sponsored sandbox environment. Leaders joined.", false],
  ];
  for (const [name, text, wantModule] of moduleCases) {
    const got = LinkedInService.isFeedModuleText(text);
    if (got === wantModule) { passed++; console.log(`PASS | module: ${name}`); }
    else { failed++; console.log(`FAIL | module: ${name} | got=${got}(want ${wantModule})`); }
  }
  // LinkedIn POST gates (agentEngine.deterministicValidate): what must never ship.
  {
    const AgentEngine = require("./src/services/agentEngine");
    const eng = new AgentEngine(svc);
    const plan = { format: { min: 400, max: 1200 }, recentTitles: ["Why payment webhooks fail HMAC signature verification"] };
    const body = "I shipped a retry budget for my payment ops agent last week.\n\n" + "It kept hammering a failed settlement query until the provider rate limited it. ".repeat(4) + "\n\nWhat guardrail did you add after your first agent outage?";
    const cases = [
      ["good post passes", body, true],
      ["AI slop phrase", body.replace("I shipped", "In today's fast-paced world, I shipped"), false],
      ["engagement bait", body.replace(/What guardrail[^?]*\?/, "Comment YES if you agree?"), false],
      ["link in body", body.replace("last week.", "last week. https://github.com/Drix10/payscope"), false],
      ["hashtag in body", body.replace("last week.", "last week. #AI"), false],
      ["no closing question", body.replace(/\n\nWhat guardrail[^?]*\?/, ""), false],
      ["fake seniority", body.replace("I shipped", "As a senior engineer, I shipped"), false],
      ["em dash", body.replace("last week.", "last week \u2014 finally."), false],
      ["repeats an old opening", "Why payment webhooks fail HMAC signature verification in Express.\n\n" + body, false],
      ["too short for the shape", "Short take.\n\nWhat would you do?", false],
    ];
    for (const [name, text, wantOk] of cases) {
      const errs = eng.deterministicValidate(text, plan).errors;
      if ((errs.length === 0) === wantOk) { passed++; console.log(`PASS | post-gate: ${name}`); }
      else { failed++; console.log(`FAIL | post-gate: ${name} | errors=${errs.join("; ")}`); }
    }
    // Rotation: 20 consecutive plans never repeat a type back to back and use every type.
    let hist = [], prev = null, repeats = 0; const seenTypes = new Set();
    const arts = [1, 2, 3].map(i => ({ title: `AI agents topic ${i}`, fullContent: "LLM agents inference code developer API model benchmark ".repeat(20) }));
    for (let i = 0; i < 20; i++) {
      const p = eng.plan({ recentHistory: hist, multiRepoPulse: { repos: [{ name: "r", recentCommits: [{ message: "fix" }], hasFreshCommits: true }] }, experience: [{}] }, arts);
      if (p.pillar.id === prev) repeats++;
      prev = p.pillar.id; seenTypes.add(p.pillar.id);
      hist = [{ postType: p.pillar.id, format: p.formatId, hookStyle: p.hookStyle }, ...hist];
    }
    // Critic must fail closed, and the engine must never write history itself.
    {
      const ctx = require("./src/services/agentContext");
      const saveCtx = { pulse: ctx.getMultiRepoGitPulse, rec: ctx.recordPost };
      const saveLlm = { j: svc.generateLinkedInJson, c: svc.generateCommentText };
      let recorded = 0;
      ctx.getMultiRepoGitPulse = async () => ({ repos: [] });
      ctx.recordPost = () => { recorded++; };
      svc.generateLinkedInJson = async () => ({ title: "t", post: body, hashtags: ["AI", "Dev", "Career"], slidePoints: [], sourceIndex: -1, repo: "" });
      try {
        for (const [name, critic, wantValid] of [
          ["critic down -> not valid", async () => { throw new Error("all providers down"); }, false],
          ["critic junk -> not valid", async () => "no json here", false],
          ["critic pass -> valid", async () => '{"invented":false,"robotic":false,"score":85,"fix":""}', true],
        ]) {
          svc.generateCommentText = critic;
          const r = await eng.runAutonomousPipeline({ curatedArticles: [], recentHistory: [] });
          if (r.isValid === wantValid) { passed++; console.log(`PASS | post critic: ${name}`); }
          else { failed++; console.log(`FAIL | post critic: ${name} | valid=${r.isValid}`); }
        }
        if (recorded === 0) { passed++; console.log("PASS | engine never records history itself"); }
        else { failed++; console.log(`FAIL | engine recorded history ${recorded}x`); }
      } finally {
        ctx.getMultiRepoGitPulse = saveCtx.pulse; ctx.recordPost = saveCtx.rec;
        svc.generateLinkedInJson = saveLlm.j; svc.generateCommentText = saveLlm.c;
      }
    }
    if (repeats === 0 && seenTypes.size >= 6) { passed++; console.log(`PASS | post rotation (${seenTypes.size} types in 20 posts, no back-to-back repeats)`); }
    else { failed++; console.log(`FAIL | post rotation | repeats=${repeats} types=${seenTypes.size}`); }
  }
  console.log(`\n${passed} passed, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
})();
