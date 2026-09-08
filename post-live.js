#!/usr/bin/env node

/**
 * post-live.js
 *
 * Production Live LinkedIn Publishing Engine.
 * Executes the autonomous AgentEngine across Drishtant's verified GitHub pulse,
 * drafts with audience-targeted engineering frameworks, runs the anti-cringe reflection loop,
 * renders the dark-mode companion slide, and publishes live to LinkedIn with an automated
 * contextual first comment and Knowledge Hub sync.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const llmService = require("./src/services/llm");
const githubService = require("./src/services/github");
const linkedinService = require("./src/services/linkedin");
const LinkedInService = new linkedinService();
const AgentEngine = require("./src/services/agentEngine");
const agentEngine = new AgentEngine(llmService);
const { logger } = require("./src/utils/helpers");

// Fallback high-quality technical reference articles
const MOCK_ARTICLES = [
  {
    title: "AI Developer Tools",
    githubUrl: "https://github.com/Drix10/ai-resources/blob/main/AI%20Developer%20Tools/resources-042.md",
    fullContent: `### 🚀 Cursor AI vs VS Code: Advanced Workflows
This article compares the advanced AI integration workflows in Cursor and standard VS Code, examining key-bindings, codebase indexing, and multi-file inline generation mechanisms.
Key Points:
• Cursor utilizes a background rust-based tokenizer to index codebases, enabling sub-second multi-file semantic searches.
• Standard VS Code Copilot relies on active tab context, which frequently leads to missing dependencies in multi-file edits.
• Local embeddings are stored in a SQLite database at the user profile level, minimizing network overhead during retrieval.`
  },
  {
    title: "CS Academics",
    githubUrl: "https://github.com/Drix10/ai-resources/blob/main/CS%20Academics/resources-015.md",
    fullContent: `### 🤖 RAG Evaluation: Ragas vs TruLens Frameworks
Evaluating Retrieval-Augmented Generation (RAG) applications requires quantifying retrieval precision, context recall, and faithfulness. This comparative analysis outlines how Ragas and TruLens solve evaluation without manual labeling.`
  }
];

async function fetchArticlesFromGithub() {
  const owner = config.github.owner;
  const repo = config.github.repo;
  const pat = config.github.personalAccessToken;

  if (!owner || !repo || !pat) {
    logger.warn("GitHub configuration missing or incomplete in .env. Falling back to local reference data.");
    return MOCK_ARTICLES;
  }

  logger.info(`Fetching markdown files from GitHub repository: ${owner}/${repo}...`);
  const octokit = githubService.octokit;
  const collectedArticles = [];
  const sampleFolders = (config.folders || []).slice(0, 6);

  for (const folder of sampleFolders) {
    try {
      const { data: contents } = await octokit.repos.getContent({
        owner,
        repo,
        path: folder.name
      });

      if (!Array.isArray(contents)) continue;

      const mdFiles = contents
        .filter(file => file.name.endsWith(".md") && file.name.startsWith("resources-"))
        .sort((a, b) => b.name.localeCompare(a.name));

      if (mdFiles.length === 0) continue;

      const targetFile = mdFiles[0];
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: targetFile.path
      });

      if (fileData && !Array.isArray(fileData) && fileData.content) {
        const encodedPath = targetFile.path.split("/").map(encodeURIComponent).join("/");
        const fileUrl = `https://github.com/${owner}/${repo}/blob/main/${encodedPath}`;

        collectedArticles.push({
          title: folder.name,
          githubUrl: fileUrl,
          fullContent: fileContent
        });
      }
    } catch (err) {
      logger.warn(`Could not fetch files from GitHub folder "${folder.name}": ${err.message}. Skipping...`);
    }
  }

  if (collectedArticles.length === 0) {
    logger.warn("No articles could be fetched from GitHub. Falling back to local reference data.");
    return MOCK_ARTICLES;
  }

  return collectedArticles;
}

async function runLivePost() {
  console.log("=============================================================");
  console.log("🚀 STARTING PRODUCTION LIVE LINKEDIN POST & PUBLISH PIPELINE");
  console.log("=============================================================\n");

  try {
    // 1. Gather reference context from GitHub
    const articles = await fetchArticlesFromGithub();

    // 2. Run the Autonomous Multi-Repo Agent Engine
    const postData = await agentEngine.runAutonomousPipeline({
      curatedArticles: articles,
      maxRefineAttempts: 2
    });

    if (!postData || !postData.postText) {
      throw new Error("Autonomous pipeline returned an empty post.");
    }

    console.log("\n=============================================================");
    console.log("🔥 GENERATED LINKEDIN POST 🔥");
    console.log("=============================================================");
    console.log(postData.postText);
    console.log("=============================================================\n");

    console.log("💬 AUTOMATED FIRST COMMENT:");
    console.log("-------------------------------------------------------------");
    console.log(postData.commentText);
    console.log("-------------------------------------------------------------\n");

    // 3. Render companion dark-mode slide image
    let slideImagePath = null;
    try {
      console.log("🎨 Rendering custom companion slide image...");
      slideImagePath = await LinkedInService.generateSlideImage(
        postData.title,
        postData.slidePoints,
        postData.slideTagline || postData.coreInsight || "Systems Architecture Teardown · Drix10",
        `github.com/Drix10/${postData.primaryRepo || "ai-resources"}`,
        {
          structureName: postData.chosenStructure || postData.originType,
          diagramSteps: postData.diagramSteps,
          coreInsight: postData.coreInsight,
          category: postData.category || postData.primaryRepo || "Systems"
        }
      );
      if (slideImagePath) {
        console.log(`🖼️ Custom slide image rendered: ${slideImagePath}`);
      }
    } catch (imgErr) {
      console.warn(`⚠️ Could not generate slide image: ${imgErr.message}`);
    }

    // 4. Save post to Knowledge Hub and LinkedIn Insights
    const insightsDir = path.join(process.cwd(), "LinkedIn Insights");
    const blogInsightsDir = path.join(process.cwd(), "blog", "content", "LinkedIn Insights");
    if (!fs.existsSync(insightsDir)) fs.mkdirSync(insightsDir, { recursive: true });
    if (!fs.existsSync(blogInsightsDir)) fs.mkdirSync(blogInsightsDir, { recursive: true });

    const timestamp = Date.now();
    const seoSlug = String(postData.title || "technical-insight")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
    const blogFileName = `${seoSlug}-${timestamp}.md`;
    const blogFilePath = path.join(insightsDir, blogFileName);
    const blogContentPath = path.join(blogInsightsDir, blogFileName);

    let slideEmbed = "";
    if (slideImagePath && fs.existsSync(slideImagePath)) {
      try {
        const blogSlidesDir = path.join(process.cwd(), "blog", "public", "slides");
        if (!fs.existsSync(blogSlidesDir)) fs.mkdirSync(blogSlidesDir, { recursive: true });
        const slideFileName = `${seoSlug}-${timestamp}.png`;
        fs.copyFileSync(slideImagePath, path.join(blogSlidesDir, slideFileName));
        slideEmbed = `\n\n![${postData.title || "Systems Architecture Breakdown"}](/slides/${slideFileName})\n`;
      } catch (copyErr) {
        console.warn(`⚠️ Failed to copy slide to blog public slides: ${copyErr.message}`);
      }
    }

    const repoTitles = {
      "Grind": "Drix10/Grind: 100 Foundational C Programs & Low-Level Memory Fundamentals",
      "intent-canvas": "Drix10/intent-canvas: Visual Workspace Mapping Natural Language to Agent Graphs",
      "sentinal": "Drix10/sentinal: CLI Security Scanner with AST Taint Analysis",
      "hypothesis-arena": "Drix10/hypothesis-arena: Multi-Agent Crypto Futures Arena",
      "idolchat": "Drix10/idolchat: Real-Time AI Character Chat with WebSockets & Redis",
      "CosLynx": "CosLynx.com: Autonomous Full-Stack AI MVP Orchestration Platform",
      "ai-resources": "Drix10/ai-resources: Curated AI Systems, Infrastructure & Architecture Hub"
    };

    const sourceLabel = postData.primaryRepo
      ? (repoTitles[postData.primaryRepo] || `Drix10/${postData.primaryRepo}`)
      : "Drix10 Codebase";
    const sourceLink = postData.primaryRepo
      ? `https://github.com/Drix10/${postData.primaryRepo}`
      : "https://github.com/Drix10/ai-resources";

    const blogMarkdownContent = `# ${postData.title || "LinkedIn Technical Insight"}
${slideEmbed}
${postData.postText}

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [${sourceLabel}](${sourceLink})
- **Recommended Visual Asset**: ${postData.recommendedVisual || postData.slideTagline || "Terminal screenshot or code architecture"}
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
`;

    fs.writeFileSync(blogFilePath, blogMarkdownContent, "utf8");
    fs.writeFileSync(blogContentPath, blogMarkdownContent, "utf8");
    console.log(`📝 LinkedIn post saved to: ./${path.relative(process.cwd(), blogFilePath)}`);
    console.log(`📝 Synced to blog hub: ./${path.relative(process.cwd(), blogContentPath)}`);

    // 5. Publish live to LinkedIn
    console.log("\n=============================================================");
    console.log("🚀 PUBLISHING LIVE TO LINKEDIN (Post + Slide + First Comment)");
    console.log("=============================================================");



    try {
      const postSuccess = await LinkedInService.postToLinkedIn(
        postData.postText,
        slideImagePath,
        postData.commentText
      );

      if (postSuccess) {
        console.log("\n=============================================================");
        console.log("🎉 SUCCESS: Published live to LinkedIn with slide and comment!");
        console.log("=============================================================\n");
      } else {
        console.warn("\n⚠️ LinkedIn poster returned false or browser session was not ready.\n");
      }
    } catch (publishErr) {
      console.error("❌ Live publish error:", publishErr.message);
    }

  } catch (error) {
    logger.error("Live post pipeline error:", error);
    process.exit(1);
  } finally {
    try {
      await LinkedInService.cleanup();
    } catch (e) {}
  }
}

runLivePost();
