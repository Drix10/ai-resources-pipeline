/**
 * Where the Reddit comment pass (src/services/redditComments.js) comments, and what it looks for.
 * Seeded from docs/reddit-subreddits.md (researched 2026-10-29): its 29-sub shortlist, never its avoid list.
 * Each sub: name (no r/), note (the rules that matter and the angle that helps there; the drafter reads it),
 * and optionally minKarma / minAgeDays (our account must have them before we comment there).
 * Comments never mention a product, so the subs' promo rules never come into play.
 */
const subreddits = [
  // A. Startup and founder communities
  { name: "SaaS", note: "Founders running SaaS. Self-promo counts even in comments (once per 60 days): never name a product. Tactical answers on payments, pricing, licence delivery, distribution." },
  { name: "startups", minAgeDays: 30, note: "No promotion anywhere outside the stickied Share Your Startup thread. Operator answers: cofounders, early costs, building with AI." },
  { name: "indiehackers", note: "Solo builders sharing journeys with numbers. Lessons from shipping alone." },
  { name: "SideProject", note: "People sharing their side projects. Specific feedback on stack, onboarding and positioning." },
  { name: "EntrepreneurRideAlong", note: "Not a place to promote a business. Honest in-progress struggles; replies that add one lesson." },
  { name: "microsaas", note: "Small single-founder SaaS. Payments, distribution, pricing a small tool." },
  { name: "buildinpublic", note: "Building in public. Reply with a comparable lesson or a question about their numbers." },
  { name: "ycombinator", note: "Applications, cofounders, technical depth." },
  { name: "indianstartups", note: "Indian founders. India-specific: Razorpay and payment gateways, hiring, the Bengaluru market." },
  { name: "Startup_Ideas", note: "People pressure-testing ideas: who pays, distribution, technical feasibility." },
  { name: "roastmystartup", note: "Candid critique of landing pages and positioning: sharp but kind." },
  { name: "smallbusiness", note: "Small-business owners. No promotion, no tool names: answer social or video marketing questions with method only." },
  // B. Brand, creator and marketing (Content Factory's buyers)
  { name: "socialmedia", note: "Why a brand's reels or posts stall: the hook in the first second, one idea per reel, retention." },
  { name: "InstagramMarketing", note: "Reels craft: hook, pacing, captions as key words rather than a transcript, posting cadence." },
  { name: "content_marketing", note: "Peer feedback over promo, spam is removed. Researched, sourced content over slop." },
  { name: "DigitalMarketing", note: "Short-form strategy for small brands; making video in-house vs an agency. Never a tool pitch." },
  { name: "NewTubers", note: "No self-promotion or content links. Detailed Shorts feedback: pacing, hook, audio, thumbnail." },
  { name: "youtubers", note: "Shorts and faceless-channel craft." },
  // C. Investing, quant, fintech (MiroHedge's audience)
  { name: "algotrading", note: "For-profit products banned. Backtest hygiene only: pre-registration, multiple testing, realistic costs, overfitting. Never returns, never advice." },
  { name: "quant", note: "Mostly professionals. Methodology only (multiple-testing correction, data issues); never retail AI hype, never returns." },
  { name: "fintech", note: "Must be relevant to the conversation. Payments operations, AI in regulated finance." },
  { name: "IndiaInvestments", note: "Strict: no self-promotion. Plain-language answers on risk and backtest claims; never investment advice or a return figure." },
  // D. AI, LLM and dev tools
  { name: "ClaudeAI", note: "Claude users. Real workflow details: long agent runs, judges, effort settings, cost control." },
  { name: "ClaudeCode", note: "Claude Code users. Guardrails for unattended agents: protected paths, review and QA loops." },
  { name: "AI_Agents", note: "Projects only in the weekly Project Display thread. Production lessons: tracing, policy gates, logs, evals." },
  { name: "LLMDevs", note: "Disguised ads are bannable. Grounding: rejecting numbers or names not in the source, evals." },
  { name: "LocalLLaMA", note: "Self-promotion limited (1/10 rule). Local TTS, GPU traps, local model setups." },
  { name: "developersIndia", note: "Promo heavily restricted. Career and engineering answers." },
  { name: "AgentsOfAI", note: "Agent deployment pain points." },
];

// docs/reddit-subreddits.md section 3: hostile to AI-written comments, promo or automation. Never commented in,
// even if one is added to the list above by mistake.
const avoid = ["Entrepreneur", "opensource", "marketing", "investing", "wallstreetbets", "MachineLearning", "programming", "VideoEditing", "SEO", "freelance"];

// What the pain-point log (data/reddit-painpoints.jsonl) files a thread's pain under.
const products = [
  { id: "factory", about: "CosLynx Content Factory: software that makes researched short-form reels and content for brands (making content takes too long, costs too much, looks like AI slop, gets no reach)" },
  { id: "mirohedge", about: "MiroHedge: AI-written trading hypotheses checked by deterministic backtest gates (overfit backtests, untrustworthy strategies, retail investors without tools)" },
  { id: "ai-tools", about: "ai-resources knowledge base and AI dev tools (keeping up with AI, grounding and hallucinations, guardrails for unattended coding agents, tracing and evals)" },
];

module.exports = { subreddits, avoid, products };
