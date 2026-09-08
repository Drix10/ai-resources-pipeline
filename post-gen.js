#!/usr/bin/env node

/**
 * generate-linkedin-previews.js
 *
 * Truly autonomous agentic LinkedIn engine testing script.
 * Evaluates multi-source context (Git commits, builder milestones, failures, and curated articles),
 * ideates authentic builder angles without rigid templates, drafts in unpretentious developer voice,
 * runs an internal reflection/critic loop, and previews the result.
 *
 * This runs locally and publishes to LinkedIn when config.social.linkedinPost is true.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const llmService = require("./src/services/llm");
const githubService = require("./src/services/github");
const linkedinService = require("./src/services/linkedin");
const LinkedInService = new linkedinService();
const { logger } = require("./src/utils/helpers");

// Fallback high-quality mock articles to allow testing even if GitHub PAT or repository is not configured
const MOCK_ARTICLES = [
  {
    title: "AI Developer Tools",
    githubUrl: "https://github.com/Drix10/Twitter-Gemini-GitHub-MVP/blob/main/AI%20Developer%20Tools/resources-042.md",
    fullContent: `
### 🚀 Cursor AI vs VS Code: Advanced Workflows

This article compares the advanced AI integration workflows in Cursor and standard VS Code, examining key-bindings, codebase indexing, and multi-file inline generation mechanisms.

Key Points:

• Cursor utilizes a background rust-based tokenizer to index codebases, enabling sub-second multi-file semantic searches.

• Standard VS Code Copilot relies on active tab context, which frequently leads to missing dependencies in multi-file edits.

• Local embeddings are stored in a SQLite database at the user profile level, minimizing network overhead during retrieval.

🚀 Implementation:
1. Enable Indexing: Turn on codebase indexing in Cursor settings to allow full semantic retrieval.
2. Setup Cursor Rules: Define rules in a .cursorrules file to enforce strict typing, anti-hype code patterns, and consistent spacing rules.
3. Multi-file edits: Use CMD+K across files to automatically apply dependency-aware updates.

🔗 Resources:
• [Cursor AI](https://cursor.sh) - Rust-powered fork of VS Code with native codebase-wide context integration.
• [VS Code Copilot](https://code.visualstudio.com) - Official VS Code extension for inline completions.
    `
  },
  {
    title: "CS Academics",
    githubUrl: "https://github.com/Drix10/Twitter-Gemini-GitHub-MVP/blob/main/CS%20Academics/resources-015.md",
    fullContent: `
### 🤖 RAG Evaluation: Ragas vs TruLens Frameworks

Evaluating Retrieval-Augmented Generation (RAG) applications requires quantifying retrieval precision, context recall, and faithfulness. This comparative analysis outlines how Ragas and TruLens solve evaluation without manual labeling.

Key Points:

• Faithfulness measures the ratio of generated claims that can be directly mapped to source context chunks.

• Context recall evaluates retrieval success by assessing whether the LLM parser can find all gold-standard answers.

• Syntactic alignment checkers are unreliable; semantic similarity using custom embedding models is required for scoring.

🚀 Implementation:
1. Extract dataset: Generate a synthetic evaluation dataset of 50 query-context-response triplets.
2. Initialize evaluator: Use Ragas to calculate faithfulness and answer relevance scores.
3. Establish baseline: Set a threshold of 0.85 for production promotion.

🔗 Resources:
• [Ragas Framework](https://github.com/explodinggradients/ragas) - Open-source framework for evaluation of RAG systems.
• [TruLens](https://github.com/truera/trulens) - Evaluation suite tracking LLM triad metrics including hallucination and context drift.
    `
  },
  {
    title: "Devs, Designers, DevRel",
    githubUrl: "https://github.com/Drix10/Twitter-Gemini-GitHub-MVP/blob/main/Devs%2C%20Designers%2C%20DevRel/resources-029.md",
    fullContent: `
### 💡 Post-CSS vs Tailwind: CSS Architecture in 2026

An in-depth look at CSS performance at scale. This article compares Tailwind CSS utility classes against vanilla CSS variables and Post-CSS modules for high-interaction developer CLI tools and interfaces.

Key Points:

• Utility-first approaches minimize total CSS bundle size by capping class repetition at scale.

• Post-CSS modules offer superior type safety when building strict design systems with component encapsulation.

• CSS variable injection at the HTML root element enables real-time high-performance dynamic theming.

🔗 Resources:
• [PostCSS](https://postcss.org) - Tool for transforming CSS with JS plugins.
• [TailwindCSS](https://tailwindcss.com) - Utility-first CSS framework.
    `
  }
];

/**
 * Fetches recent markdown files from the configured GitHub repository.
 * Falls back to mock data if there is an error or configuration is missing.
 */
async function fetchArticlesFromGithub() {
  const owner = config.github.owner;
  const repo = config.github.repo;
  const pat = config.github.personalAccessToken;

  if (!owner || !repo || !pat) {
    logger.warn("GitHub configuration missing or incomplete in .env. Falling back to high-quality local mock data.");
    return MOCK_ARTICLES;
  }

  logger.info(`Fetching markdown files from GitHub repository: ${owner}/${repo}...`);
  const octokit = githubService.octokit;

  const collectedArticles = [];

  // Choose up to 8 top high-virality folders from configuration to evaluate candidates
  const sampleFolders = (config.folders || []).slice(0, 8);

  for (const folder of sampleFolders) {
    try {
      logger.info(`Scanning folder: "${folder.name}" on GitHub...`);
      const { data: contents } = await octokit.repos.getContent({
        owner,
        repo,
        path: folder.name
      });

      if (!Array.isArray(contents)) continue;

      // Filter and sort to find the newest resources file (e.g. resources-002.md > resources-001.md)
      const mdFiles = contents
        .filter(file => file.name.endsWith(".md") && file.name.startsWith("resources-"))
        .sort((a, b) => b.name.localeCompare(a.name)); // Newest first

      if (mdFiles.length === 0) {
        logger.info(`No resources-*.md files found in folder: "${folder.name}".`);
        continue;
      }

      // Take the single newest file from this folder
      const targetFile = mdFiles[0];
      logger.info(`Downloading newest file: ${targetFile.path}...`);

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
    logger.warn("No articles could be fetched from GitHub. Falling back to local mock data.");
    return MOCK_ARTICLES;
  }

  logger.info(`Successfully fetched ${collectedArticles.length} articles from GitHub.`);
  return collectedArticles;
}

/**
 * Simulates and displays the agentic selection and master LinkedIn post generation.
 */
async function generateLinkedInPreviews() {
  console.log("\n============================================================");
  console.log("🚀 STARTING AGENTIC LINKEDIN POST CURATION PREVIEW RUN 🚀");
  console.log("============================================================\n");

  try {
    // 1. Fetch articles (GitHub or Mock)
    const articles = await fetchArticlesFromGithub();
    const flattenedArticles = llmService.splitArticlesIntoSubArticles(articles);

    console.log(`\n📚 Loaded ${flattenedArticles.length} total curated articles available in context.`);

    let postData;
    let selectedArticles = [];

    console.log("\n🧠 [Truly Autonomous Agentic Mode]: Evaluating multi-source signals (Git commits, builder milestones, failures, and curated articles)...");
      postData = await llmService.generateAutonomousFounderPost({ curatedArticles: flattenedArticles });
      selectedArticles = flattenedArticles.slice(0, 1);

    console.log("\n=============================================================");
    console.log("🔥 GENERATED LINKEDIN POST PREVIEW 🔥");
    console.log("=============================================================");
    console.log(postData.postText);
    console.log("=============================================================\n");

    if (postData.commentText) {
      console.log("💬 AUTOMATED FIRST COMMENT PREVIEW:");
      console.log("-------------------------------------------------------------");
      console.log(postData.commentText);
      console.log("-------------------------------------------------------------\n");
    }

    console.log("🖼️ COMPANION VISUAL SLIDE PREVIEW:");
    console.log("-------------------------------------------------------------");
    console.log(`   Title:     "${postData.title}"`);
    console.log(`   Points:    ${JSON.stringify(postData.slidePoints, null, 2)}`);
    console.log(`   Origin:    "${postData.originType || postData.chosenStructure || "unspecified"}"`);
    if (postData.criticScore) {
      console.log(`   Critic:    ${postData.criticScore}/100 score`);
    }
    console.log("-------------------------------------------------------------\n");

    // 4. Render companion HTML slide image
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

    // 5. Save LinkedIn post as an article in "LinkedIn Insights" and "blog/content/LinkedIn Insights"
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
      : (selectedArticles[0]?.title || "Drix10/ai-resources");
    const sourceLink = postData.primaryRepo
      ? `https://github.com/Drix10/${postData.primaryRepo}`
      : (selectedArticles[0]?.githubUrl || "https://github.com/Drix10/ai-resources");

    const blogMarkdownContent = `# ${postData.title || "LinkedIn Technical Insight"}
${slideEmbed}
${postData.postText}

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [${sourceLabel}](${sourceLink})
- **Recommended Visual Asset**: ${postData.recommendedVisual || postData.slideTagline || "Terminal screenshot or real photo of code running"}
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
`;

    fs.writeFileSync(blogFilePath, blogMarkdownContent, "utf8");
    fs.writeFileSync(blogContentPath, blogMarkdownContent, "utf8");
    console.log(`📝 LinkedIn post saved to LinkedIn Insights: ./${path.relative(process.cwd(), blogFilePath)}`);
    console.log(`📝 Also synced to blog: ./${path.relative(process.cwd(), blogContentPath)}`);
    if (postData.recommendedVisual) {
      console.log(`📸 Recommended Visual: ${postData.recommendedVisual}`);
    }

    // 6. Save results locally in a previews directory
    const outputDir = path.join(process.cwd(), "linkedin-previews");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const outputFilename = `preview-${timestamp}.json`;
    const outputPath = path.join(outputDir, outputFilename);

    fs.writeFileSync(outputPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      sourceArticles: selectedArticles,
      generatedPost: postData,
      slideImagePath
    }, null, 2));

    console.log(`💾 Preview saved locally to: ./${path.relative(process.cwd(), outputPath)}`);

    // 7. Push to live LinkedIn if enabled in config
    if (config.social.linkedinPost) {
      console.log("\n=============================================================");
      console.log("🚀 PUBLISHING TO LINKEDIN (Live Post + Slide Image + Comment)");
      console.log("=============================================================");
      try {
        const postSuccess = await LinkedInService.postToLinkedIn(
          postData.postText,
          slideImagePath,
          postData.commentText
        );
        if (postSuccess) {
          console.log("\n=============================================================");
          console.log("🎉 SUCCESS: Post, companion slide, and comment published live to LinkedIn!");
          console.log("=============================================================\n");
        } else {
          console.warn("\n⚠️ LinkedIn poster returned false status or was unable to submit.\n");
        }
      } catch (postErr) {
        console.error("❌ Failed to publish to LinkedIn:", postErr.message);
      }
    } else {
      console.log("\n=============================================================");
      console.log("✅ PREVIEW COMPLETED (Safe Mode: set LINKEDIN_POST=true in .env to post live)");
      console.log("   Preview and companion slide saved locally.");
      console.log("=============================================================\n");
    }

  } catch (error) {
    logger.error(" Curation runner failed:", error);
    process.exit(1);
  } finally {
    try {
      await LinkedInService.cleanup();
    } catch (e) {}
  }
}

// Execute the preview generator
generateLinkedInPreviews();
