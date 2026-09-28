/**
 * post-preview.js: TERMINAL PREVIEW ONLY. Never posts to LinkedIn, never writes
 * post history. Generates several posts in a row with the real engine and the
 * real models, so you can judge quality and variety before enabling LINKEDIN_POST.
 *
 *   node post-preview.js [--count 3]
 */
const fs = require("fs");
const path = require("path");
const llmService = require("./src/services/llm");
const agentContext = require("./src/services/agentContext");
const AgentEngine = require("./src/services/agentEngine");

const args = process.argv.slice(2);
const countArg = args.indexOf("--count");
const count = Math.max(1, Math.min(8, parseInt(countArg >= 0 ? args[countArg + 1] : "3", 10) || 3));

// Newest resources file per folder in the local blog, same shape the cron run passes.
function localArticles(limit = 8) {
  const root = path.join(__dirname, "blog", "content");
  const out = [];
  for (const folder of fs.readdirSync(root)) {
    const dir = path.join(root, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    const newest = fs.readdirSync(dir).filter(f => /^resources-\d+\.md$/.test(f)).sort().pop();
    if (!newest) continue;
    out.push({
      title: folder,
      githubUrl: `https://github.com/Drix10/ai-resources/blob/main/${encodeURIComponent(folder)}/${newest}`,
      fullContent: fs.readFileSync(path.join(dir, newest), "utf8"),
      mtime: fs.statSync(path.join(dir, newest)).mtimeMs,
    });
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit);
}

(async () => {
  const articles = llmService.splitArticlesIntoSubArticles(localArticles()).filter(Boolean);
  const engine = new AgentEngine(llmService);
  let history = agentContext.getRecentHistory();
  console.log(`Loaded ${articles.length} article sections. Generating ${count} post(s); nothing is published.\n`);
  for (let i = 0; i < count; i++) {
    const r = await engine.runAutonomousPipeline({ curatedArticles: articles.slice(0, 12), dryRun: true, recentHistory: history });
    const ctx = r.sourceContext || {};
    console.log(`================ POST ${i + 1}/${count} ================`);
    console.log(`type: ${ctx.pillar} | shape: ${ctx.format} | hook: ${ctx.hookStyle} | score: ${r.criticScore} | ${r.isValid ? "WOULD POST" : "REJECTED: " + r.validationErrors.join("; ")}`);
    if (r.sourceTitle) console.log(`source: ${r.sourceTitle}`);
    console.log(`\n${r.postText}\n`);
    console.log(`FIRST COMMENT: ${r.commentText}\n`);
    if (r.isValid) history = [r.historyRecord, ...history];
  }
  const m = llmService.getMetrics();
  console.log(`Tokens: OpenRouter ${m.openrouterPromptTokens || 0}+${m.openrouterCompletionTokens || 0}, NVIDIA ${m.nvidiaPromptTokens || 0}+${m.nvidiaCompletionTokens || 0}.`);
  process.exit(0);
})().catch((e) => { console.error("preview failed:", e.message); process.exit(1); });
