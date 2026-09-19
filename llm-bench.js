/** llm-bench.js: benchmark candidate Nvidia NIM models on the real feed-comment pipeline.
 * Usage: node llm-bench.js  (prints one JSON line per model x post)
 * Uses full draftFeedComment (generator + mechanical gates + critic) so the score
 * reflects the whole system per model, not just raw generation.
 */
const config = require("./config");
const svc = require("./src/services/llm.js");

const MODELS = [
  "meta/llama-3.2-11b-vision-instruct", // baseline (current)
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "mistralai/mistral-large-2-instruct",
  "deepseek-ai/deepseek-v4-flash-0731",
];

const POSTS = [
  { id: "yolo", author: "Mohini Sharma", text: "Ultralytics YOLO27 announced at YOLO Vision 2026. YOLO-Depth monocular and YOLO-StereoDepth binocular bring native depth estimation into YOLO, a camera-based alternative to lidar for robotics. A query-based head outputs final boxes directly, removing NMS as post-processing. YOLO27l is the first Ultralytics model to pass 60 mAP on COCO: 60.4 mAP at 2.3ms on an RTX PRO 6000. Four sizes, seven tasks, new UltraViT backbone. No confirmed ship date, later this year with models still in final R and D." },
  { id: "ctxtax", author: "Albert Mao", text: "The biggest cost of AI is not the API bill. It is the context tax. Every time someone asks AI a question, they spend time explaining the company, the market, what was found, what happened last time, what the partner thinks, which document it needs. Multiply that across 20 people and thousands of workflows. You are paying humans to repeatedly teach the machine the same thing. That is not automation. That is expensive amnesia." },
  { id: "pwn", author: "Srinivas L", text: "At Pwn2Own Ireland 2025, researchers chained five vulnerabilities against a Galaxy S25. In under 60 seconds, they exfiltrated a photo to a laptop, gained root access and earned $50,000. Separately, in 2023 Citizen Lab documented BLASTPASS, a zero-click exploit chain used to install Pegasus spyware on a fully patched iPhone running iOS 16.6. Malicious PassKit images sent through iMessage required no victim interaction. A rooted phone exposes stored credentials, authenticated enterprise sessions, and data across apps, so device compromise becomes an enterprise identity incident requiring patching, integrity checks, isolation, conditional access, and session revocation." },
];

(async () => {
  for (const m of MODELS) {
    config.llm.nvidia.model = m;
    for (const p of POSTS) {
      const t0 = Date.now();
      try {
        const r = await svc.draftFeedComment({ postAuthor: p.author, postText: p.text });
        console.log(JSON.stringify({ model: m.split("/")[1], post: p.id, ms: Date.now() - t0, valid: r.isValid, skipped: !!r.skipped, errors: r.errors, comment: r.comment }));
      } catch (e) {
        console.log(JSON.stringify({ model: m.split("/")[1], post: p.id, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) }));
      }
    }
  }
})();
