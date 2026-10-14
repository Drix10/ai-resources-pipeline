require("./_env"); // isolated even when run on its own
// The LinkedIn comment pipeline's adversarial regression set (formerly feed-regression.js).
// Drafts and critic verdicts are stubbed and deterministic; the draft -> gates -> critic -> retry
// wiring under test is real. Anything failing here blocks enabling LINKEDIN_FEED_REPLY.
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../config");
const llm = require("../src/services/llm");
const LinkedInService = require("../src/services/linkedin");

// Every draft and critic call answers from this queue. Both entry points are mocked, so no case
// can reach a live model (each test file runs in its own process, so the mocks stay here).
let queue = [];
const fromQueue = async (prompt) => {
  const item = queue.shift();
  if (item === undefined) throw new Error("mock queue empty for prompt: " + String(prompt).slice(0, 80));
  return item;
};
const realGenerateCommentText = llm.generateCommentText.bind(llm);
llm.generateCommentText = fromQueue;

const EVAL_POST = "LLM eval methods compared: BLEU and ROUGE need references, embedding similarity is softer, LLM judges score semantics, agents need behavioural evals, metric design matters";
const DASH_POST = "We shipped our new dashboard today with latency charts and error budgets. Grateful for the team and excited for next quarter growth and numbers";

// [name, post, author, queued responses, expect valid, expect skipped = false, retries = 1]
const DRAFT_CASES = [
  ["simple praise with point -> pass", EVAL_POST, "Pranav Joshi",
    ["The eval methods breakdown really lands.", "PASS: names the subject"], true],
  ["opener with substance -> pass", EVAL_POST, "Pranav Joshi",
    ["This nails references over embedding similarity.", "PASS: names the point"], true],
  ["announcement acknowledgment -> pass",
    "Announcing the Cambridge x Tencent Games hackathon, Oct 10-11. Student teams build game prototypes, judged by engineers.",
    "Jessy Tang",
    ["The Cambridge plus Tencent Games hackathon deserves more attention.", "PASS: grounded acknowledgment"], true],
  ["lone lowercase noun X (vibecode) -> reject",
    "some guy wanted me to build his entire app and website for equity. He had an idea and a poorly-vibecoded homepage. You should vibecode, but at least do it well.",
    "YangMing Jiang",
    ["Good reminder on vibecode.", "Good reminder on vibecode."], false],
  ["free-form natural comment -> pass",
    "Most AI engineers learn how to use LLMs. Very few learn how they actually work under the hood. This Stanford CS336 playlist is a gem if you want to go deeper. It doesn't just teach you how to use existing models. It takes you closer to understanding what happens underneath them. 11 FREE lectures from Stanford.",
    "Arindam Majumder",
    ["Closer to what happens underneath the models.", "PASS: specific and grounded"], true],
  ["dead praise (great post family) -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post on judges and references.", "Great post on judges and references."], false],
  ["dead thanks-for-sharing -> reject",
    "Announcing the Cambridge x Tencent Games hackathon, Oct 10-11. Student teams build game prototypes, judged by engineers.",
    "Jessy Tang",
    ["Thanks for sharing this!", "Thanks for sharing this!"], false],
  ["while-contrast clause X -> reject", EVAL_POST, "Pranav Joshi",
    ["Well said on judges score semantics while BLEU and ROUGE need references.", "Well said on judges score semantics while BLEU and ROUGE need references."], false],
  ["persistent fabrication -> eventually invalid (SKIP)", EVAL_POST, "Pranav Joshi",
    ["Teams cut eval cost by 40% moving to judges, which compounds fast.", "Teams cut eval cost by 40% moving to judges, which compounds fast."], false],
  ["unsupported statistic -> reject", EVAL_POST, "Pranav Joshi",
    ["Teams cut eval cost by 40% moving to judges, which compounds fast.", "Teams cut eval cost by 40% moving to judges, which compounds fast."], false],
  ["unsupported causal/conclusive -> reject", EVAL_POST, "Pranav Joshi",
    ["This proves lexical metrics are obsolete for agents now.", "This proves lexical metrics are obsolete for agents now."], false],
  ["unsupported comparison (NVIDIA shape) -> reject",
    "NVIDIA ran a nationwide high-resolution climate model workflow in 2 days on DGX systems, deployed locally for near-term forecasting use",
    "NVIDIA",
    ["The DGX boxes pulling a nationwide run in 2 days is fast, NVIDIA, and inference staying on the same boxes is what settles it against classic climate models.",
     "The DGX boxes pulling a nationwide run in 2 days is fast, NVIDIA, and inference staying on the same boxes is what settles it against classic climate models."], false],
  ["wedged full-name vocative -> reject", EVAL_POST, "Pranav Joshi",
    ["BLEU is sensitive to word order, Pranav Joshi, which hurts recall on long outputs.", "BLEU is sensitive to word order, Pranav Joshi, which hurts recall on long outputs."], false],
  ["while-contrast clause X with name -> reject", EVAL_POST, "Pranav Joshi",
    ["Pranav, well said on judges score semantics while BLEU and ROUGE need references.", "Pranav, well said on judges score semantics while BLEU and ROUGE need references."], false],
  ["good draft with banned phrase -> reject", EVAL_POST, "Pranav Joshi",
    ["The key takeaway is eval design matters as much as the metric for judges.", "The key takeaway is eval design matters as much as the metric for judges."], false],
  ["tortured profundity on shallow post -> critic kills", DASH_POST, "Acme Corp",
    ["The dashboard scalability implications are really interesting for modern teams.", "FAIL: content-free, names no specific point",
     "The dashboard scalability implications are really interesting for modern teams.", "FAIL: content-free"], false],
  ["generator SKIP on shallow post -> skipped", DASH_POST, "Acme Corp", ["SKIP"], false, true, 0],
  ["word-number invention (hundreds of annotators) -> reject",
    "The biggest cost of AI is the context tax. Every question costs explanation time across 20 people and thousands of workflows. Expensive amnesia.",
    "Albert Mao",
    ["Thousands of workflows multiply the context tax, but so do hundreds of human annotators labeling each request.",
     "Thousands of workflows multiply the context tax, but so do hundreds of human annotators labeling each request."], false],
  ["unsupported analogy (equivalent to knowledge graph) -> reject",
    "The biggest cost of AI is the context tax. Every question costs explanation time across 20 people and thousands of workflows. Expensive amnesia.",
    "Albert Mao",
    ["The context tax is equivalent to the overhead of maintaining a large knowledge graph.",
     "The context tax is equivalent to the overhead of maintaining a large knowledge graph."], false],
  ["short vague-but-true endorsement -> pass",
    "Hardware hiring is broken. Resume keyword filters miss actual circuit understanding, which is what matters on the bench. ATS systems cannot tell them apart.",
    "Dana K",
    ["Resume keyword filters missing actual circuit understanding is the whole point.", "PASS"], true],
  ["invented edge redesign->token-reduction -> critic kills",
    "Joined Graphify Labs to lead product and AI. Gave the console and website a fresh look. Graphify is an open source on-device knowledge graph engine turning codebases into graphs for agents, cutting token consumption by 70 percent. 119k stars on GitHub.",
    "Raihan Khan",
    ["Graphify's console redesign impacts token consumption metrics, given the 70 percent reduction mentioned.", "FAIL: redesign never connected to token reduction in source",
     "Graphify's console redesign impacts token consumption metrics, given the 70 percent reduction mentioned.", "FAIL: invented edge"], false],
  ["imported failure mode (overfitting/accents) -> critic kills",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion and speaking-style categories directly from audio. Recognized self-labeled emotions better than human listeners. Opening access to limited customers first.",
    "Nathan Roll",
    ["Resonance-2 maps 31 emotion categories directly from audio, but nothing in that mapping prevents overfitting to specific accents.", "FAIL: overfitting/accents failure mode absent from post",
     "Resonance-2 maps 31 emotion categories directly from audio, but nothing in that mapping prevents overfitting to specific accents.", "FAIL: imported failure mode"], false],
  ["derived implication is added knowledge -> reject",
    "Researchers chained five vulnerabilities into root access in under 60 seconds. Patching any single flaw would not have stopped the chain.",
    "Srinivas L",
    ["Blocking any single flaw leaves four working paths, so the chain survives individual patches.", "Blocking any single flaw leaves four working paths, so the chain survives individual patches."], false],
  ["prescribed remedy (mitigated by) -> reject",
    "The biggest cost of AI is the context tax. Every question costs explanation time across 20 people and thousands of workflows. Expensive amnesia.",
    "Albert Mao",
    ["The context tax is redundant data ingestion, which can be mitigated by designing more explicit inputs.",
     "The context tax is redundant data ingestion, which can be mitigated by designing more explicit inputs."], false],
  ["consultant filler (making it easier to) -> reject",
    "Graphify turns codebases into knowledge graphs highlighting impacted files and dependencies before changes ship.",
    "Tushar Mishra",
    ["Graphify highlights impacted files, making it easier to prioritize refactoring efforts across the codebase.",
     "Graphify highlights impacted files, making it easier to prioritize refactoring efforts across the codebase."], false],
  ["domain import (lexical overlap into emotion eval) -> critic kills",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion and speaking-style categories directly from audio, beating human listeners on self-labeled emotions.",
    "Nathan Roll",
    ["Separating reference-based scoring from judge-based evaluation is useful here. These categories may fail lexical overlap, which is why eval design matters.", "FAIL: lexical overlap / judge-based evaluation absent from post",
     "Separating reference-based scoring from judge-based evaluation is useful here. These categories may fail lexical overlap, which is why eval design matters.", "FAIL: domain import"], false],
  ["polished acknowledgment of same proposition -> pass",
    "The biggest cost of AI is not the API bill. Every question costs explanation time and context across 20 people and thousands of workflows. Humans repeatedly teach the machine the same company, market, and findings. Expensive amnesia.",
    "Albert Mao",
    ["Every question costing explanation time across thousands of workflows is the key detail here.", "PASS: grounded acknowledgment"], true],
  ["latent-mechanism interpretation is added knowledge -> reject",
    "The biggest cost of AI is not the API bill. Every question costs explanation time and context across 20 people and thousands of workflows. Humans repeatedly teach the machine the same company, market, and findings. Expensive amnesia.",
    "Albert Mao",
    ["The expensive part is not passing context once but losing it between workflows, forcing humans to reconstruct it each time.", "The expensive part is not passing context once but losing it between workflows, forcing humans to reconstruct it each time."], false],
  ["single-sentence acknowledgment -> pass",
    "Oruk announcing Resonance-2, speech emotion recognition. Scores 31 emotion categories directly from audio signals for voice agents.",
    "Nathan Roll",
    ["Scoring emotion categories directly from audio signals is useful here.", "PASS: grounded acknowledgment"], true],
  ["typo of post term (halucinated) -> reject",
    "Testing a small quantized model offline on Android. It sometimes produces hallucinated or inaccurate answers on device.",
    "Anwar Zahid",
    ["The model's halucinated output could be due to the small size and quantization.",
     "The model's halucinated output could be due to the small size and quantization."], false],
  ["verdict filler (classic case / crucial aspect) -> reject", EVAL_POST, "Pranav Joshi",
    ["This is a classic case of eval drift, a crucial aspect of metric design.",
     "This is a classic case of eval drift, a crucial aspect of metric design."], false],
  ["mid-sentence name drop -> reject",
    "The biggest cost of AI is context tax. Humans repeatedly teach the machine the same thing.",
    "Albert Mao",
    ["The context tax Albert Mao is talking about is a real problem.",
     "The context tax Albert Mao is talking about is a real problem."], false],
  ["hedged speculation (likely) -> reject", EVAL_POST, "Pranav Joshi",
    ["This approach likely reduces eval fragmentation across teams.",
     "This approach likely reduces eval fragmentation across teams."], false],
  ["imported machinery (knowledge graph) -> reject",
    "The biggest cost of AI is context tax. Humans repeatedly teach the machine the same thing.",
    "Albert Mao",
    ["The overhead comes from maintaining a large knowledge graph.",
     "The overhead comes from maintaining a large knowledge graph."], false],
  ["unsupported causal absent from post -> critic kills", EVAL_POST, "Pranav Joshi",
    ["Reference-based scoring causes teams to abandon BLEU entirely for agents.", "FAIL: unsupported causal claim, post never states abandonment",
     "Reference-based scoring causes teams to abandon BLEU entirely for agents.", "FAIL: unsupported causal claim"], false],
  ["invented relationship from real numbers -> critic kills",
    "Built GPT-6 Astra with the PaperRoute agent. One developer coordinated coding, 3D assets, checkpoints and iteration. 39 hours tracked development, 69 checkpoints, shipped in days not months.",
    "Tejas Hirurkar",
    ["The 39 hours of tracked development suggest a high degree of automation, but the 69 checkpoints indicate frequent manual intervention.", "FAIL: infers automation and manual intervention from numbers the post never connects",
     "The 39 hours of tracked development suggest a high degree of automation, but the 69 checkpoints indicate frequent manual intervention.", "FAIL: infers automation and manual intervention"], false],
  ["invented causal link (sponsored -> enabled) -> critic kills",
    "Infosys workshop on AI agents with hands-on labs in a sponsored sandbox environment. Leaders joined and interacted with teams throughout the day.",
    "Ramesh Rajini",
    ["The sponsored sandbox made the hands-on mode possible, and leaders leveled up the sessions.", "FAIL: post never says sponsorship enabled anything",
     "The sponsored sandbox made the hands-on mode possible, and leaders leveled up the sessions.", "FAIL: invented causal link"], false],
  ["correct attribution of same facts -> pass",
    "At Pwn2Own Ireland 2025 researchers chained five vulnerabilities against a Galaxy S25 and gained root access in under 60 seconds.",
    "Srinivas L",
    ["Well said on chaining five vulnerabilities to root access in under 60 seconds.", "PASS"], true],
  // Reply-system V2: the prof-joined-college bug class. Vague goodwill passes,
  // invented role/subject details fail even when wrapped in congratulations.
  ["prof joined college: invented teaching details -> reject",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["Teaching data structures at ABC College will shape young minds, congratulations on the role!", "Teaching data structures at ABC College will shape young minds, congratulations on the role!"], false],
  ["prof joined college: plain congrats -> pass",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["Congratulations on joining ABC College, well deserved!", "PASS: grounded congrats"], true],
  ["content-free echo -> critic kills",
    "what is it: we are opening up our office to people outside, for as long as we have the room. What you get: a desk, good coffee, good company. Free.",
    "Naman Anand",
    ["Desk, good coffee, good company is free.", "FAIL: echo, restates the offer with zero reaction",
     "Desk, good coffee, good company is free.", "FAIL: echo"], false],
  ["false attendance (loved the session) -> reject",
    "Attended the Python Meets Rust Bengaluru Meetup at Rippling. Ishaan Arora explored Unicode and text handling in Python. Nihal introduced cuda-oxide for CUDA kernels in Rust.",
    "Hetav Pai",
    ["I loved the session on cuda-oxide.", "I loved the session on cuda-oxide."], false],
  ["false attendance (great meeting you) -> reject",
    "Attended the Python Meets Rust Bengaluru Meetup at Rippling. Grateful to all three speakers for sharing their knowledge.",
    "Hetav Pai",
    ["Great meeting you at the Rippling meetup.", "Great meeting you at the Rippling meetup."], false],
  ["false attendance (my takeaway) -> reject",
    "Understanding how different technologies solve different problems is just as important as learning the languages themselves.",
    "Hetav Pai",
    ["My takeaway matches yours on technologies.", "My takeaway matches yours on technologies."], false],
  ["spaced banned variant (game changer) -> reject",
    "Jev is the first game changer in the AI space since GPT3.5. It opens up use cases that were too expensive and slow previously, relevant where rule following matters.",
    "Alex Hinds",
    ["The Jev game changer lands.", "The Jev game changer lands."], false],
  ["bare great-post goodwill is slop -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post, thanks for sharing!", "Great post, thanks for sharing!"], false],
  ["rotated ACK shape (key detail) -> pass", EVAL_POST, "Pranav Joshi",
    ["BLEU and ROUGE needing references is the key detail here.", "PASS"], true],
  ["headline nouns are not the topic -> reject",
    "Recently, I interviewed several intern candidates. Most used AI coding tools extensively, but some could not explain what they built or how they would validate the outputs.",
    "Sasha Yan",
    ["Great post on Machine Learning Engineer.", "Great post on Machine Learning Engineer."], false],
  ["bare Great post! is slop -> reject", EVAL_POST, "Pranav Joshi",
    ["Great post!", "Great post!"], false],
  ["lone-generic X is slop -> reject",
    "A friend got interviewed by an AI today for an AI engineer role. The AI recorded expressions and eye movements through the webcam. Crazy times coming up.",
    "Md. Tazbinur",
    ["The AI part really lands.", "The AI part really lands."], false],
  ["good reminder frame -> pass",
    "I built a free open-source macOS app called Always Whisper. It listens to your voice and transcribes in real time using a local Whisper model. Everything runs on your Mac.",
    "Kazuki Hayakawa",
    ["Good reminder on Always Whisper.", "PASS"], true],
  ["this-nails frame -> pass",
    "For the hackathon we built a Bluetooth-Controlled RC Car. Smart obstacle detection with proximity sensors. It was an incredible experience bridging hardware and software, excited for many more builds ahead.",
    "A P Sai Yeshas",
    ["This nails the RC Car build.", "PASS"], true],
  ["bare Congrats! -> pass",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["Congrats!", "PASS: vague goodwill"], true],
  ["birthday congrats on birthday post -> pass",
    "I just turned 20, and I still don't know if I've been chasing the right thing. From selling candy at 7 to becoming CMO of a YC startup at 19. But that's my life so far. So cheers to me turning 20.",
    "Hank Wu",
    ["Happy 20th!", "PASS: main-event congrats"], true],
  // CONGRATS/SUPPORT modes face the critic too, and a decorated FAIL is still a FAIL.
  ["congrats mode still faces a fail-closed critic",
    "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter.",
    "Ravi Kumar",
    ["MODE: CONGRATS\nREPLY: Congratulations on joining ABC College, well deserved!", "**FAIL**: wrong register",
     "MODE: CONGRATS\nREPLY: Congratulations on joining ABC College, well deserved!", "Verdict: FAIL"], false],
  // Only the first paragraph after REPLY: is the comment; trailing model notes never post.
  ["reply parser drops a trailing note paragraph",
    "Most AI engineers learn how to use LLMs. Very few learn how they actually work under the hood. This Stanford CS336 playlist is a gem if you want to go deeper. It takes you closer to understanding what happens underneath them.",
    "Arindam Majumder",
    ["MODE: REACT\nREPLY: Closer to what happens underneath the models.\n\nNote: chose REACT because the playlist framing invites a reaction about hierarchical curriculum design.", "PASS"], true],
];

for (const [name, post, author, responses, expectValid, expectSkipped = false, retries = 1] of DRAFT_CASES) {
  test(`draft: ${name}`, async () => {
    queue = [...responses];
    const r = await llm.draftFeedComment({ postAuthor: author, postText: post }, retries);
    const why = (r.errors || []).join("; ");
    assert.equal(r.isValid, expectValid, `isValid: ${why}`);
    assert.equal(Boolean(r.skipped), expectSkipped, `skipped: ${why}`);
  });
}

test("simple mode passes the raw reply through, even one the gates would reject", async () => {
  config.social.linkedinSimpleReply = true;
  try {
    queue = ["Teaching data structures at ABC College will shape young minds!"];
    const r = await llm.draftFeedComment({ postAuthor: "Ravi Kumar", postText: "Excited to share I have joined ABC College as an Assistant Professor. Grateful for the support of my mentors and looking forward to this new chapter." }, 0);
    assert.equal(r.isValid, true);
    assert.equal(Boolean(r.skipped), false);
    assert.match(r.comment, /teaching data structures/i);
  } finally {
    config.social.linkedinSimpleReply = false;
  }
});

test("a thin post throws before any LLM call", async () => {
  queue = ["SHOULD-NOT-BE-CONSUMED"];
  await assert.rejects(llm.draftFeedComment({ postAuthor: "X", postText: "Hi ok thanks bye" }, 0), /too thin/i);
  assert.equal(queue.length, 1, "no mock response consumed");
});

// ---- Scanner gates: pure predicates, no browser ----
test("spam gate: life updates pass; giveaways, hiring, bait, ads, promos and closed comments are blocked", () => {
  const cases = [
    ["life update (joined college) passes", "Ravi Kumar • 1st • 2h • Follow Excited to share I have joined ABC College as an Assistant Professor. Happy to announce I have joined the faculty.", false],
    ["promotion announcement passes", "Jane Doe • 1st • 3h Thrilled to share I have been promoted to Senior Engineer. Grateful for the team.", false],
    ["work anniversary passes", "John Smith • 1st • 5h Celebrating 5 years at Acme Corp. What a journey it has been with this team.", false],
    ["giveaway spam blocked", "Win a free course! Giveaway ends soon, sign up now with limited spots available today.", true],
    ["hiring spam blocked", "We are hiring for backend engineers, dm me to apply and join my team today.", true],
    ["engagement bait blocked", "Say congrats on my promotion! Congratulate me in the comments below friends.", true],
    ["LinkedIn ad label blocked", "Acme Corp • Promoted • Follow Our new cloud platform scales to millions of requests per day.", true],
    ["webinar promo blocked", "Join our free webinar on AI agents. Register now, cohort starts Monday, early bird pricing.", true],
    ["connections-only comment gate skipped", "Excited for this next chapter building Sona8! Thank you to everyone. Only connections can comment on this post.", true],
    ["hiring ad (unpaid founding engineers) blocked", "Naman Jha • 2nd Founder 6d • Follow We are building from scratch and hiring our first 25 Founding Engineers for AI solutions. Currently unpaid founding-team opportunity. Apply: https://lnkd.in/abc Build from zero.", true],
  ];
  for (const [name, text, wantSpam] of cases) assert.equal(LinkedInService.isFeedSpamText(text), wantSpam, name);
});

test("body extraction drops the headline and tallies; normal cards keep their old tracker key", () => {
  // The pre-refactor key source: normal cards (timestamp within 10 lines) must hash exactly as before.
  const oldKeySrc = (tlines) => {
    let bodyStart = 0;
    for (let i = 0; i < Math.min(tlines.length, 10); i++) {
      if (/\d+\s*[smhdw]\s*•/.test(tlines[i])) { bodyStart = i + 1; break; }
    }
    const bodyOnly = tlines.slice(bodyStart).join("\n").replace(/^follow\s*$/gim, "");
    return bodyOnly.replace(/(\n\s*[\d][\d\s,.KMB]*)+$/, "");
  };
  // The leading newline mirrors the pre-refactor computation exactly (drafting trims it).
  const card = ["Feed post", "Sasha Yan • 3rd+", "Machine Learning Engineer at Foo", "5h • Edited", "Follow", "Recently, I interviewed several intern candidates about AI tools.", "14", "4"];
  assert.equal(LinkedInService.postBodyFromLines(card), "\nRecently, I interviewed several intern candidates about AI tools.");
  assert.equal(LinkedInService.postBodyFromLines(card), oldKeySrc(card), "key stable");
  // No timestamp in range: the Follow fallback drops the header. The key rotates here by design.
  const exotic = ["Feed post", "Jane Doe • 2nd", "Founder at Bar", "Edited •", "Follow", "Thrilled to share I have been promoted to Senior Engineer.", "7"];
  assert.equal(LinkedInService.postBodyFromLines(exotic), "Thrilled to share I have been promoted to Senior Engineer.");
});

test("attribution gates: activity chrome and merged-author cards never draft", () => {
  const cases = [
    ["repost (followed-by) skipped", "Feed post Followed by Rohini Chaudhari Shrey Shah • 2nd 6d • Follow Jev is a new model for decisions.", true, false],
    ["comment-activity card skipped", "Feed post\nHank Wu commented\nDylan Pak • 2nd\nCMO at Moo\n3h •\nSome post about startups and growth.", true, false],
    ["supports-activity skipped", "Feed post Naman Anand supports this Satyam Singh • 2nd 4h • Follow Post about hiring engineers.", true, false],
    ["reposted-this skipped", "Feed post John Doe reposted this Jane Smith • 1st 8h • Follow Post about AI safety work.", true, false],
    ["normal post passes activity gate", "Feed post Sasha Yan • 3rd+ Machine Learning Engineer 5h • Follow Recently I interviewed intern candidates.", false, false],
    ["post discussing comments passes", "Feed post Dana K • 2nd Engineer 2h • Follow The most commented threads this week share one trait.", false, false],
    ["merged judge+winner card skipped", "Feed post Uday Kumar V • 2nd Proud judge at the hackathon. Affan Khan • 3rd+ Thrilled to share my team secured 1st place.", false, true],
    ["single-author card passes", "Feed post Pratheek N • 1st Founder 7m • Follow Thrilled to announce a grant from Mercatus.", false, false],
  ];
  for (const [name, text, wantActivity, wantMixed] of cases) {
    assert.equal(LinkedInService.isActivityCard(text), wantActivity, `${name} (activity)`);
    assert.equal(LinkedInService.hasMixedAuthors(text), wantMixed, `${name} (mixed authors)`);
  }
});

test("recommendation modules are UI, not posts: jobs and people cards never draft or like", () => {
  const cases = [
    ["jobs module skipped", "Feed post Jobs recommended for you AI First Product Manager Deltek Bengaluru (Remote) 1 school alumni works here Actively reviewing applicants Show more", true],
    ["people module skipped", "Feed post People you may know Anish Kumar • 2nd Founder at Foo 5d • Follow", true],
    ["normal post passes module gate", "Feed post Sasha Yan • 3rd+ Machine Learning Engineer 5h • Follow Recently I interviewed intern candidates.", false],
    ["sponsored-sandbox post passes module gate", "Infosys workshop on AI agents with hands-on labs in a sponsored sandbox environment. Leaders joined.", false],
  ];
  for (const [name, text, wantModule] of cases) assert.equal(LinkedInService.isFeedModuleText(text), wantModule, name);
});

// ---- Model routing: fetch and NVIDIA are stubbed, nothing leaves the process ----
async function withRouting(fn) {
  const saved = {
    fetch: global.fetch, nvidia: llm.generateTextViaNvidia, sleep: llm.sleepWithJitter,
    or: config.llm.openrouter.apiKey, orm: config.llm.openrouter.model, nv: config.llm.nvidia.apiKey, providers: { ...config.llm.providers },
  };
  Object.assign(config.llm.providers, { article: "openrouter", comment: "openrouter", viral: "openrouter" });
  llm.sleepWithJitter = async () => {}; // OpenRouter's retry backoff: no real sleeps
  try {
    await fn();
  } finally {
    global.fetch = saved.fetch;
    llm.generateTextViaNvidia = saved.nvidia;
    llm.sleepWithJitter = saved.sleep;
    config.llm.openrouter.apiKey = saved.or; config.llm.openrouter.model = saved.orm;
    config.llm.nvidia.apiKey = saved.nv; Object.assign(config.llm.providers, saved.providers);
  }
}

test("comments: a keyed OpenRouter route sends a clean payload with the configured model", () => withRouting(async () => {
  const seen = {};
  global.fetch = async (url, opts) => {
    seen.url = String(url); seen.auth = opts?.headers?.Authorization; seen.body = JSON.parse(opts?.body || "{}");
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "routed reply" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }) };
  };
  config.llm.openrouter.apiKey = "test-key";
  config.llm.openrouter.model = "test/linkedin-model";
  const out = await realGenerateCommentText("hello", { temperature: 0.5, num_predict: 50, system: "sys" });
  assert.equal(out, "routed reply");
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(seen.auth, "Bearer test-key");
  assert.equal(seen.body.model, "test/linkedin-model");
  assert.equal(seen.body.temperature, 0.5);
  assert.equal(seen.body.max_tokens, 50);
  assert.equal(seen.body.stream, false);
  assert.equal("reasoning" in seen.body, false, "no reasoning option unless a caller asks for one");
  assert.equal("reasoning_effort" in seen.body, false);
  // A per-call model (the article pipeline passes one) wins over the configured one.
  await realGenerateCommentText("hello", { model: "other/model" });
  assert.equal(seen.body.model, "other/model");
}));

test("OpenRouter: a 500 throws, so draft retry and fallback engage", () => withRouting(async () => {
  config.llm.openrouter.apiKey = "test-key";
  config.llm.openrouter.model = "test/linkedin-model";
  global.fetch = async () => ({ ok: false, status: 500, text: async () => "boom" });
  await assert.rejects(llm.generateTextViaOpenRouter("hi", {}), /500|boom/);
}));

test("comments: without an OpenRouter key they fall back to the legacy comment model", () => withRouting(async () => {
  config.llm.openrouter.apiKey = "";
  let legacyOpts = null;
  global.fetch = async () => { throw new Error("no network in tests"); };
  llm.generateTextViaNvidia = async (p, o) => { legacyOpts = o; return "legacy reply"; };
  assert.equal(await realGenerateCommentText("hello", { temperature: 0.2 }), "legacy reply");
  assert.equal(typeof legacyOpts?.model, "string");
}));

test("the API chain: OpenRouter first, NVIDIA on failure, and exhaustion throws", () => withRouting(async () => {
  const realNvidia = llm.generateTextViaNvidia;
  let fetches = 0, nvidiaCalls = 0;
  llm.generateTextViaNvidia = async () => { nvidiaCalls++; return "nvidia post"; };
  config.llm.openrouter.apiKey = "test-or-key"; config.llm.openrouter.model = "test/linkedin-model";
  global.fetch = async () => { fetches++; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "openrouter post" } }] }) }; };
  assert.equal(await llm.generateViaApiChain("write", {}), "openrouter post");
  assert.equal(nvidiaCalls, 0);

  global.fetch = async () => ({ ok: false, status: 400, text: async () => "bad model" });
  assert.equal(await llm.generateViaApiChain("write", {}), "nvidia post", "an OpenRouter error falls back to NVIDIA");

  config.llm.openrouter.model = ""; fetches = 0;
  global.fetch = async () => { fetches++; throw new Error("no network in tests"); };
  assert.equal(await llm.generateViaApiChain("write", {}), "nvidia post", "no OPENROUTER_MODEL skips OpenRouter");
  assert.equal(fetches, 0);

  llm.generateTextViaNvidia = realNvidia;
  config.llm.openrouter.apiKey = ""; config.llm.nvidia.apiKey = "";
  await assert.rejects(llm.generateViaApiChain("write", {}), /NVIDIA|missing/i, "exhaustion throws for the skip logic");
  assert.equal(fetches, 0);
}));

test("Gemini is fully removed", () => {
  assert.equal("gemini" in config.llm, false);
  assert.equal(typeof llm.generateTextViaGemini, "undefined");
});

test("cost estimator: DeepSeek V4 Flash rates for a preview run, and a conservative fallback", () => {
  // A preview run (~39.6k prompt + ~0.5k completion tokens) at $0.03 / $1.28 per 1M tokens.
  assert.ok(Math.abs(llm.commentCostUsd(39588, 538, "deepseek/deepseek-v4-flash") - 0.001876) < 0.0001);
  // Unknown slugs: $0.30 / $1.00 per 1M tokens.
  assert.ok(Math.abs(llm.commentCostUsd(1000, 100, "some/unknown-model") - 0.0004) < 1e-9);
});
