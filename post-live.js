#!/usr/bin/env node

const geminiService = require("./src/services/gemini");
const linkedinService = require("./src/services/linkedin");
const LinkedInService = new linkedinService();
const githubService = require("./src/services/github");
const { logger, sleep } = require("./src/utils/helpers");
const config = require("./config");
const fs = require("fs");
const path = require("path");

const MOCK_ARTICLES = [
  {
    title: "Devs, Designers, DevRel",
    githubUrl: "https://github.com/Drix10/ai-resources/blob/main/Devs%2C%20Designers%2C%20DevRel%2Fresources-230.md",
    fullContent: `### 🤖 Observability, Evaluation, and RAG Implementation

This article outlines the differences between analytics and observability, explains the components needed for a Retrieval Augmented Generation (RAG) system, and provides implementation guidance.

Key Points:
• Analytics provides high-level metrics like user counts and page views.

• Observability offers deeper insights into individual user requests and responses.

• A basic RAG system requires an inference provider and a vector database.


🚀 Implementation:
1. Choose an Inference Provider: Select a service that provides the necessary AI model.
2. Select a Vector Database: Choose a database suitable for storing embeddings.
3. Develop Retrieval Logic: Implement logic to retrieve relevant information.

🔗 Resources:
• [Tool Name](https://example.com) - Brief description of the tool
`
  },
  {
    title: "CS Academics",
    githubUrl: "https://github.com/Drix10/ai-resources/blob/main/CS%20Academics%2Fresources-243.md",
    fullContent: `### 🚀 GitHub Direct Download Metrics in Release Sidebar

GitHub has quietly updated the release interface, allowing users to see direct download counts for release assets right in the UI sidebar.

Key Points:
• Asset download metrics are now visible directly in the repository release sidebar.

• This provides instant connectivity into release performance without needing external API lookups.

• Useful for developers tracking open-source package distribution metrics.
`
  },
  {
    title: "VC Firms",
    githubUrl: "https://github.com/Drix10/ai-resources/blob/main/VC%20Firms%2Fresources-226.md",
    fullContent: `### 🤖 Future AI Deployment: Multi-Model & Hybrid Inference

This update explores the emerging architectural patterns for multi-model, hybrid local/cloud AI deployments using Ollama and scalable inference providers.

Key Points:
• AI deployments are moving beyond single-model applications to multi-model hybrid setups.

• The hybrid model mixes local infrastructure for security/latency with cloud scalers for bursts.

• Open AI infrastructure is critical for building collaborative, interoperable systems.

---
### 🤖 Google Photos Log Dot-Plots Visualization

Google Photos uses a single, overlooked log visualization technique to map individual user activity.

Key Points:
• Developed at Bump and later adopted by Google Photos to trace individual user actions in logs.

• The "dot plot" displays many users simultaneously, showing distinct behavioral timelines.

• Useful for debugging complex user behavioral flows without aggregate data-loss.

---
### 🤖 Ineffective Post-Training RL Data

Post-training data for Reinforcement Learning (RL) is often ineffective and creates reward-hacking risks.

Key Points:
• Most post-training data is not effective for aligning RL models with correct behaviors.

• Ineffective data leads to reward hacking, where models find loopholes rather than solve the task.

• Ensuring a robust and clean data supply chain is essential for RL performance.
`
  }
];

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

      const mdFiles = contents
        .filter(file => file.name.endsWith(".md") && file.name.startsWith("resources-"))
        .sort((a, b) => b.name.localeCompare(a.name));

      if (mdFiles.length === 0) continue;

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

  return collectedArticles;
}

async function runLivePostCuration() {
  logger.info("============================================================");
  logger.info("STARTING LIVE CURATED LINKEDIN POST & COMMENT RUN");
  logger.info("============================================================");

  try {
    const articles = await fetchArticlesFromGithub();

    // If a single markdown file contains multiple sub-articles, flatten them so
    // the topic selector can return a valid, focused index.
    const flattenedArticles = geminiService.splitArticlesIntoSubArticles(articles);

    logger.info("\nStep 1: Querying Gemini to select the single best topic for LinkedIn...");
    const selectedIndices = await geminiService.selectBestArticlesForLinkedIn(flattenedArticles);
    logger.info(`Selected indices from Gemini: ${JSON.stringify(selectedIndices)}`);

    const uniqueIndices = [...new Set(selectedIndices.map((idx) => Number(idx)))];
    const selectedArticles = uniqueIndices
      .filter((idx) => Number.isInteger(idx) && idx >= 0 && idx < flattenedArticles.length)
      .map((idx) => flattenedArticles[idx]);

    if (uniqueIndices.length > 0 && selectedArticles.length !== uniqueIndices.length) {
      logger.warn(`Some selected indices were out of range and ignored: ${JSON.stringify(uniqueIndices)}`);
    }

    if (selectedArticles.length === 0) {
      logger.warn("No articles were selected by Gemini. Defaulting to the first available article.");
      selectedArticles.push(flattenedArticles[0]);
    }

    logger.info(`\nSelected Article: "${selectedArticles[0].title}"`);
    logger.info(`GitHub URL: ${selectedArticles[0].githubUrl}`);

    const maxGenerationAttempts = 2;
    let postData = null;
    let validation = null;
    let validationFeedback = [];

    for (let attempt = 1; attempt <= maxGenerationAttempts; attempt++) {
      logger.info(`\nStep 2: Running optimized 2026 virality formulas to generate LinkedIn post (attempt ${attempt}/${maxGenerationAttempts})...`);
      postData = await geminiService.generateLinkedInMasterPost(selectedArticles, 3, validationFeedback);

      const githubUrl = selectedArticles[0].githubUrl || "";
      const sourceBulletCount = geminiService.countSourceBullets(selectedArticles[0].fullContent || "");

      // Prefer the validation that ran inside generateLinkedInMasterPost (with hook-filtered manual points).
      const internalValidation = postData && postData.isValid !== undefined;
      validation = internalValidation
        ? {
            isValid: postData.isValid,
            qualityScore: postData.qualityScore,
            errors: postData.validationErrors || []
          }
        : geminiService.validatePostText(postData, githubUrl, sourceBulletCount);

      if (validation.isValid) {
        logger.info(`Post passed quality validation (score: ${validation.qualityScore})`);
        break;
      }

      logger.warn(`Post failed quality validation (score: ${validation.qualityScore}):`);
      validation.errors.forEach(err => logger.warn(`  - ${err}`));

      if (attempt === maxGenerationAttempts) {
        logger.warn("Aborting live publish due to repeated quality validation failures.");
        return;
      }

      validationFeedback = validation.errors;
      logger.info("Retrying LinkedIn post generation with validation feedback...");
    }

    logger.info("Initializing LinkedIn service...");
    await LinkedInService.init();

    logger.info("Step 3: Rendering custom HTML slide image...");
    const slideImagePath = await LinkedInService.generateSlideImage(
      postData.title,
      postData.slidePoints,
      postData.slideTagline,
      `github.com/${config.github.owner || "Drix10"}/${config.github.repo || "ai-resources"}`
    );

    if (!slideImagePath) {
      throw new Error("Failed to render custom HTML slide image.");
    }
    logger.info(`Custom HTML slide rendered successfully: ${slideImagePath}`);

    logger.info("\nStep 4: Publishing post and comment live to LinkedIn...");
    const postSuccess = await LinkedInService.postToLinkedIn(
      postData.postText,
      slideImagePath,
      postData.commentText
    );

    if (postSuccess) {
      logger.info("\n=============================================================");
      logger.info("SUCCESS: Curated LinkedIn update and first comment published!");
      logger.info("=============================================================");
      geminiService.saveRecentTopic(selectedArticles[0].title);
    } else {
      logger.warn("\nFAILED: LinkedIn poster returned false status.");
    }

    await sleep(5000);

    if (slideImagePath && fs.existsSync(slideImagePath)) {
      try {
        fs.unlinkSync(slideImagePath);
        logger.info("Cleaned up temporary slide PNG file.");
      } catch (e) { }
    }

    LinkedInService.cleanupDebugScreenshots();

  } catch (error) {
    logger.error("Curation runner failed with error:", error);
  } finally {
    logger.info("Releasing LinkedIn WebDriver context...");
    await LinkedInService.cleanup();
  }
}

runLivePostCuration();
