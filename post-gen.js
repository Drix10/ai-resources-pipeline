#!/usr/bin/env node

/**
 * generate-linkedin-previews.js
 *
 * Local testing script that fetches existing markdown curation files from the
 * configured GitHub repository, simulates the pipeline's end-of-run agentic
 * curation flow, and generates ready-to-post LinkedIn updates using the optimized
 * 2026 virality prompts in GeminiService.
 *
 * This runs completely locally and does NOT post anything to LinkedIn.
 */

const fs = require("fs");
const path = require("path");
const config = require("./config");
const geminiService = require("./src/services/gemini");
const githubService = require("./src/services/github");
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

An in-depth look at CSS performance at scale. This article compares Tailwind CSS utility classes against vanilla CSS variables and Post-CSS modules for high-interaction dashboards.

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
  
  // Choose up to 4 folders from configuration to fetch from to save API rate-limits
  const sampleFolders = config.folders.slice(0, 4);

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

      if (fileData && fileData.content) {
        const fileContent = Buffer.from(fileData.content, "base64").toString("utf-8");
        const fileUrl = `https://github.com/${owner}/${repo}/blob/main/${encodeURIComponent(targetFile.path)}`;

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
    
    console.log(`\n📚 Loaded ${articles.length} total articles for evaluation:`);
    articles.forEach((art, idx) => {
      console.log(`   [Index ${idx}] Folder: "${art.title}" -> ${art.githubUrl}`);
    });

    // 2. Select the best article using selectBestArticlesForLinkedIn
    console.log("\n🤖 Step 1: Querying Gemini to select the single best topic for LinkedIn...");
    const selectedIndices = await geminiService.selectBestArticlesForLinkedIn(articles);
    console.log(`✅ Selected indices from Gemini: ${JSON.stringify(selectedIndices)}`);

    const uniqueIndices = [...new Set(selectedIndices)];
    const selectedArticles = uniqueIndices
      .map(idx => articles[idx])
      .filter(art => !!art);

    if (selectedArticles.length === 0) {
      console.warn("⚠️ No articles were selected by Gemini. Defaulting to the first available article.");
      selectedArticles.push(articles[0]);
    }

    console.log(`\n✨ Selected Article(s) for Post Generation:`);
    selectedArticles.forEach(art => {
      console.log(`   - "${art.title}" (${art.githubUrl})`);
    });

    // 3. Generate LinkedIn post data using generateLinkedInMasterPost
    console.log("\n🤖 Step 2: Running optimized 2026 virality formulas to generate LinkedIn post...");
    const postData = await geminiService.generateLinkedInMasterPost(selectedArticles);

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
    console.log(`   Title:   "${postData.title}"`);
    console.log(`   Points:  ${JSON.stringify(postData.slidePoints, null, 2)}`);
    console.log(`   Tagline: "${postData.slideTagline}"`);
    console.log("-------------------------------------------------------------\n");

    // 4. Save results locally in a previews directory
    const outputDir = path.join(process.cwd(), "linkedin-previews");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = Date.now();
    const outputFilename = `preview-${timestamp}.json`;
    const outputPath = path.join(outputDir, outputFilename);

    fs.writeFileSync(outputPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      sourceArticles: selectedArticles,
      generatedPost: postData
    }, null, 2));

    console.log(`💾 Preview saved locally to: ./${path.relative(process.cwd(), outputPath)}`);
    console.log("\n=============================================================");
    console.log("✅ PREVIEW COMPLETED SUCCESSFULLY! No actual posts were made. ✅");
    console.log("=============================================================\n");

  } catch (error) {
    logger.error(" Curation preview runner failed:", error);
    process.exit(1);
  }
}

// Execute the preview generator
generateLinkedInPreviews();
