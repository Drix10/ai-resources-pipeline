const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { logger, handleError } = require("../utils/helpers");
const llmService = require("./llm");
const syndicationService = require("./syndication");

class GithubService {
  constructor() {
    this.RATE_LIMIT_BUFFER = 100;
    this.MAX_RETRIES = 3;

    try {
      this.octokit = new Octokit({
        auth: config.github.personalAccessToken,
        timeZone: "UTC",
        baseUrl: "https://api.github.com",
        retry: {
          enabled: true,
          retries: 3,
          doNotRetry: [401, 403, 404],
        },
        throttle: {
          onRateLimit: (retryAfter, options, octokit) => {
            logger.warn(
              `Request quota exhausted for request ${options.method} ${options.url}`
            );
            if (options.request.retryCount <= 2) {
              logger.info(`Retrying after ${retryAfter} seconds!`);
              return true;
            }
          },
          onSecondaryRateLimit: (retryAfter, options, octokit) => {
            logger.warn(
              `Secondary rate limit hit for ${options.method} ${options.url}`
            );
            return true;
          },
        },
      });
      logger.info("GitHub client initialized successfully");
    } catch (error) {
      handleError(error, "Failed to initialize GitHub client");
      throw error;
    }
  }

  async createMarkdownFileFromTweets(threadData, queryName, folder) {
    try {
      const threads = Array.isArray(threadData) ? threadData : [];
      logger.info(
        `Generating markdown content for ${threads.length} threads of type ${queryName}`
      );

      if (!config.github.repo) {
        throw new Error("GitHub repository configuration is missing");
      }

      const markdownContent = await llmService.generateMarkdown(threads, 2, [], folder?.name || queryName);
      llmService.assertPublishableMarkdown(
        markdownContent,
        llmService.normalizeCollectedThreads(threads).length,
      );
      const fileBuffer = Buffer.from(markdownContent);

      const result = await this.uploadMarkdownFile(
        fileBuffer,
        `${config.github.owner}/${config.github.repo}`,
        folder
      );

      if (!result.success) {
        throw new Error(`Failed to upload markdown: ${result.message}`);
      }

      logger.info(`Success: ${result.url}`);

      return {
        success: true,
        url: result.url,
        content: markdownContent,
        folder: folder.name,
      };
    } catch (error) {
      logger.error("Error creating markdown file:", error);
      throw error;
    }
  }

  async createMarkdownFileFromCombined(threads, linkedinPosts, queryName, folder) {
    try {
      const safeThreads = Array.isArray(threads) ? threads : [];
      const safeLinkedinPosts = Array.isArray(linkedinPosts) ? linkedinPosts : [];
      logger.info(
        `Generating markdown content for ${safeThreads.length} X threads and ${safeLinkedinPosts.length} LinkedIn posts of type ${queryName}`
      );

      if (!config.github.repo) {
        throw new Error("GitHub repository configuration is missing");
      }

      const markdownContent = await llmService.generateMarkdownFromCombined(safeThreads, safeLinkedinPosts, 2, false, [], folder?.name || queryName);
      // This is a final defensive boundary: no model response can create a
      // repository file (or social announcement) unless it contains a real article.
      const expectedArticleCount = llmService.normalizeCollectedThreads(safeThreads).length + safeLinkedinPosts.filter(Boolean).length;
      llmService.assertPublishableMarkdown(markdownContent, expectedArticleCount);
      const fileBuffer = Buffer.from(markdownContent);

      const result = await this.uploadMarkdownFile(
        fileBuffer,
        `${config.github.owner}/${config.github.repo}`,
        folder
      );

      if (!result.success) {
        throw new Error(`Failed to upload markdown: ${result.message}`);
      }

      logger.info(`Success combined markdown upload: ${result.url}`);

      return {
        success: true,
        url: result.url,
        content: markdownContent,
        folder: folder.name,
      };
    } catch (error) {
      logger.error("Error creating combined markdown file:", error);
      throw error;
    }
  }

  /**
   * Batches multiple folder markdown files into ONE consolidated GitHub commit using the Git Data API.
   * Eliminates commit flooding (e.g. groups 5-10 folders into 1 commit instead of 1 by 1).
   *
   * @param {Array<Object>} items - Array of { folder, fileBuffer, markdownContent, tweets, linkedinPosts, queryName }
   * @param {string} repoName - e.g. "Drix10/ai-resources"
   * @returns {Promise<Array<Object>>} - Array of { success, url, content, folder, number, sha, tweets, queryName }
   */
  async uploadMarkdownBatch(items, repoName = `${config.github.owner}/${config.github.repo}`, branch = "main") {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (typeof repoName !== "string" || !repoName.includes("/")) {
      throw new Error("Repository must use the owner/repository format");
    }
    const [owner, repo] = repoName.split("/");

    const rateLimit = await this.checkRateLimit();
    if (rateLimit.isLimited) {
      throw new Error(`Rate limit exceeded. Resets at ${rateLimit.resetTime}`);
    }

    await this.checkRepoAccess(owner, repo);

    // 1. Prepare file numbers, paths, and content strings for every item in the batch
    const folderNumberMap = new Map();
    const preparedItems = [];

    for (const item of items) {
      const folderObj = item.folder || { name: item.queryName };
      if (!folderObj || typeof folderObj.name !== "string" || !folderObj.name.trim()) {
        throw new Error("A valid destination folder is required for each batch item");
      }
      const decodedFolder = folderObj.name.replace(/ /g, " ");
      const urlSafeFolder = encodeURIComponent(decodedFolder);

      let nextNumber;
      if (folderNumberMap.has(decodedFolder)) {
        nextNumber = folderNumberMap.get(decodedFolder) + 1;
      } else {
        nextNumber = await this.getNextFileNumber(owner, repo, decodedFolder);
      }
      folderNumberMap.set(decodedFolder, nextNumber);

      const fileName = `resources-${String(nextNumber).padStart(3, "0")}.md`;
      const filePath = `${decodedFolder}/${fileName}`;
      const fileUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${urlSafeFolder}/${fileName}`;
      const content = item.fileBuffer ? item.fileBuffer.toString("utf8") : String(item.markdownContent || "");

      preparedItems.push({
        ...item,
        folder: folderObj,
        queryName: folderObj.name,
        decodedFolder,
        urlSafeFolder,
        nextNumber,
        fileName,
        filePath,
        fileUrl,
        content
      });
    }

    // 2. Commit all files in ONE single commit via GitHub Git Data API
    let newCommitSha = null;
    let commitError = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const branchRef = await this.octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const latestCommitSha = branchRef.data.object.sha;
        const commitData = await this.octokit.git.getCommit({ owner, repo, commit_sha: latestCommitSha });
        const baseTreeSha = commitData.data.tree.sha;

        const treeEntries = preparedItems.map(it => ({
          path: it.filePath,
          mode: "100644",
          type: "blob",
          content: it.content
        }));

        const newTree = await this.octokit.git.createTree({
          owner,
          repo,
          base_tree: baseTreeSha,
          tree: treeEntries
        });

        const commitMessage = preparedItems.length === 1
          ? `📝 Add resource collection: ${preparedItems[0].decodedFolder} #${preparedItems[0].nextNumber}`
          : `📝 Batch sync: ${preparedItems.length} resource collections\n\n` +
            preparedItems.map(it => `- ${it.decodedFolder} (#${it.nextNumber})`).join("\n");

        const authorInfo = {
          name: "Drix10",
          email: "ggdrishtant@gmail.com"
        };

        const newCommit = await this.octokit.git.createCommit({
          owner,
          repo,
          message: commitMessage,
          tree: newTree.data.sha,
          parents: [latestCommitSha],
          author: authorInfo,
          committer: authorInfo
        });

        await this.octokit.git.updateRef({
          owner,
          repo,
          ref: `heads/${branch}`,
          sha: newCommit.data.sha
        });

        newCommitSha = newCommit.data.sha;
        logger.info(`Successfully pushed batched commit (${preparedItems.length} files) to ${owner}/${repo}: ${newCommitSha}`);
        break;
      } catch (err) {
        commitError = err;
        logger.warn(`Batch commit attempt ${attempt}/${this.MAX_RETRIES} failed: ${err.message}`);
        if (attempt < this.MAX_RETRIES) {
          await new Promise(res => setTimeout(res, 2000 * attempt));
        }
      }
    }

    if (!newCommitSha) {
      throw new Error(`Failed to commit batch to GitHub after ${this.MAX_RETRIES} attempts: ${commitError?.message}`);
    }

    // 3. Post-commit operations for each file (local blog copy & syndication)
    for (const item of preparedItems) {
      try {
        const localBlogContentDir = path.join(process.cwd(), "blog", "content", item.decodedFolder);
        if (!fs.existsSync(localBlogContentDir)) {
          fs.mkdirSync(localBlogContentDir, { recursive: true });
        }
        fs.writeFileSync(path.join(localBlogContentDir, item.fileName), item.content, "utf8");
      } catch (localErr) {
        logger.warn(`Local blog save warning (non-fatal): ${localErr.message}`);
      }

      syndicationService
        .syndicateMarkdownArticle({
          title: `${item.decodedFolder} #${item.nextNumber}`,
          markdown: item.content,
          tags: [item.decodedFolder.toLowerCase().replace(/[^a-z0-9]/g, "")],
          category: item.decodedFolder,
          relativePath: item.filePath,
        })
        .catch(err => {
          logger.warn(`Syndication error (non-fatal): ${err.message}`);
        });
    }

    return preparedItems.map(it => ({
      success: true,
      message: "File uploaded successfully as part of batch commit",
      url: it.fileUrl,
      sha: newCommitSha,
      number: it.nextNumber,
      content: it.content,
      queryName: it.queryName,
      folder: it.folder,
      tweets: it.tweets || [],
      linkedinPosts: it.linkedinPosts || []
    }));
  }

  async uploadMarkdownFile(fileBuffer, repoName, folder) {
    const results = await this.uploadMarkdownBatch([{ fileBuffer, folder }], repoName);
    if (!results || results.length === 0) {
      throw new Error("Failed to upload markdown file");
    }
    return results[0];
  }

  async getNextFileNumber(owner, repo, folder) {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: folder,
      });

      const numbers = data
        .filter((file) => file.name.match(/^resources-\d{3}\.md$/))
        .map((file) => parseInt(file.name.match(/\d{3}/)[0]));

      return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    } catch (error) {
      if (error.status === 404) {
        return 1;
      }
      throw error;
    }
  }

  async createOrUpdateFile(owner, repo, path, content, message) {
    try {
      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: message || `Update ${path}`,
        content,
        branch: "main",
      });
      return response;
    } catch (error) {
      logger.error("File creation/update failed:", {
        error: error.message,
        owner,
        repo,
        path,
      });
      throw error;
    }
  }

  async updateReadmeWithNewFile(owner, repo) {
    try {
      const path = "README.md";
      let existing;
      try {
        existing = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: "main",
        });
      } catch (error) {
        if (error.status !== 404) throw error;
        existing = null;
      }

      if (!existing) {
        logger.warn("README.md not found");
        return;
      }

      const headerContent = `
<div align="center">
  <h1><a href="https://x.com/DRIX_10_" target="_blank">🚀 AI Resources by DRIX10</a></h1>
  <p><strong>Explore a comprehensive collection of top AI resources curated by experts on 𝕏</strong></p>
  <p>🌟 Daily updates • 💡 Expert insights • 🔥 Trending Topics</p>

  <img src="https://img.shields.io/badge/Maintainer-Drix10-blue?style=for-the-badge" alt="Maintainer Drix10" />
  <img src="https://img.shields.io/badge/Topics-Everything%2C%20AI-red?style=for-the-badge" alt="Topics" />
  <img src="https://img.shields.io/github/last-commit/Drix10/ai-resources?style=for-the-badge&color=5D6D7E" alt="Last Updated" />
  <a href="https://github.com/Drix10/ai-resources"><img src="https://img.shields.io/github/stars/Drix10/ai-resources?style=for-the-badge&color=yellow" alt="GitHub Stars" /></a>

  <br>

  <h3>🌟 Quick Links</h3>
    <a href="https://x.com/DRIX_10_">
      <img src="https://img.shields.io/badge/Follow_on_𝕏-black?style=for-the-badge&logo=x&logoColor=white" alt="Follow on X" />
    </a>
    <a href="https://github.com/Drix10">
      <img src="https://img.shields.io/badge/Follow_on_GitHub-black?style=for-the-badge&logo=github&logoColor=white" alt="Follow on GitHub" />
    </a>
</div>

---

## 📚 Resource Categories

`;

      let updatesContent = "";

      // GitHub's contents API is rate-limited. A small bounded pool is faster
      // than sequential calls without turning one README refresh into a burst.
      const folderResults = await this.mapWithConcurrency(config.folders, 4, async (folder) => {
        const decodedFolder = folder.name.replace(/ /g, " ");
        try {
          // Add delay to prevent hitting rate limits
          await new Promise(resolve => setTimeout(resolve, Math.random() * 2000));
          
          const { data } = await this.octokit.repos.getContent({
            owner,
            repo,
            path: decodedFolder,
          });

          const files = data
            .filter((file) => file.name.match(/^resources-\d{3}\.md$/))
            .map((file) => ({
              number: parseInt(file.name.match(/\d{3}/)[0]),
              url: `https://github.com/${owner}/${repo}/blob/main/${encodeURIComponent(
                decodedFolder
              )}/${file.name}`,
            }))
            .sort((a, b) => b.number - a.number);

          let sectionContent = `### ${folder.name}\n\n`;

          if (files.length > 0) {
            sectionContent += `*   [Latest Update (#${String(
              files[0].number
            ).padStart(3, "0")})](${files[0].url}) - *${
              folder.description || "Resources related to " + folder.name
            }*\n`;
          } else {
            sectionContent += `*   No resources yet.\n`;
          }
          sectionContent += "\n";
          return { name: folder.name, content: sectionContent };
        } catch (error) {
          let sectionContent = `### ${folder.name}\n\n`;
          if (error.status === 404) {
            sectionContent += `*   No resources yet.\n\n`;
          } else {
            logger.error(`Error getting content for ${decodedFolder}:`, error);
            sectionContent += `*   Error loading resources.\n\n`;
          }
          return { name: folder.name, content: sectionContent };
        }
      });
      
      // Sort results to maintain order from config
      const orderedContent = config.folders.map(folder => 
        folderResults.find(r => r.name === folder.name)?.content || ""
      ).join("");

      updatesContent += orderedContent;

      const newContent = headerContent + updatesContent;

      await this.createOrUpdateReadme(owner, repo, newContent);
    } catch (error) {
      logger.error("Failed to update README:", error);
    }
  }

  async checkRepoAccess(owner, repo) {
    try {
      if (!owner || !repo) {
        throw new Error("Owner and repository name are required");
      }

      const { data } = await this.octokit.repos.get({ owner, repo });

      if (data.archived) {
        throw new Error(`Repository ${owner}/${repo} is archived`);
      }
      if (data.disabled) {
        throw new Error(`Repository ${owner}/${repo} is disabled`);
      }
      if (!data.permissions?.push) {
        throw new Error(`No write access to repository ${owner}/${repo}`);
      }

      return data;
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`Repository ${owner}/${repo} not found`);
      }
      if (error.status === 403) {
        throw new Error(`No access to repository ${owner}/${repo}`);
      }
      throw error;
    }
  }

  handleGitHubError(error) {
    let errorMessage = "Failed to upload file to GitHub";
    let statusCode = 500;

    const errorMap = {
      401: "GitHub authentication failed - check your token",
      403: "No permission to access repository",
      404: "Repository not found",
      422: "Invalid file content or path",
      429: "GitHub API rate limit exceeded",
    };

    if (error.status in errorMap) {
      errorMessage = errorMap[error.status];
      statusCode = error.status;
    }

    if (error.response?.headers?.["x-ratelimit-remaining"]) {
      errorMessage += ` (Rate limit: ${error.response.headers["x-ratelimit-remaining"]} remaining)`;
    }

    handleError(error, errorMessage);

    return {
      success: false,
      message: errorMessage,
      status: statusCode,
      error: error.message,
      rateLimitReset: error.response?.headers?.["x-ratelimit-reset"],
    };
  }

  async checkRateLimit() {
    try {
      const { data } = await this.octokit.rateLimit.get();
      const { remaining, reset, used, limit } = data.rate;

      return {
        remaining,
        resetTime: new Date(reset * 1000),
        isLimited: remaining < this.RATE_LIMIT_BUFFER,
        used,
        limit,
      };
    } catch (error) {
      handleError(error, "Failed to check rate limit");
      return {
        remaining: 0,
        resetTime: new Date(Date.now() + 3600000),
        isLimited: true,
        used: 0,
        limit: 0,
      };
    }
  }

  async createOrUpdateReadme(owner, repo, content) {
    try {
      const path = "README.md";
      const branch = "main";

      let existingSha = null;
      let existingContent = null;
      try {
        const existing = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        existingSha = existing.data.sha;
        existingContent = Buffer.from(existing.data.content || "", "base64").toString("utf8");
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
        logger.info("README.md not found, creating a new one.");
      }

      if (existingContent === content) {
        logger.info("README is already current; skipping redundant commit.");
        return {
          success: true,
          skipped: true,
          url: `https://github.com/${owner}/${repo}/blob/main/${path}`,
          sha: existingSha,
        };
      }

      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: "📚 Update README with latest tweets",
        content: Buffer.from(content).toString("base64"),
        sha: existingSha,
        branch,
        committer: {
          name: "Drix10",
          email: "ggdrishtant@gmail.com",
        },
      });

      logger.info("README updated successfully");

      return {
        success: true,
        url: `https://github.com/${owner}/${repo}/blob/main/README.md`,
        sha: response.data.content.sha,
      };
    } catch (error) {
      handleError(error, "Failed to update README");
      return {
        success: false,
        message: "Failed to update README",
        error: error.message,
      };
    }
  }

  async ensureFolderExists(owner, repo, folder) {
    try {
      await this.octokit.repos.getContent({
        owner,
        repo,
        path: folder,
      });
    } catch (error) {
      if (error.status === 404) {
        try {
          await this.octokit.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: `${folder}/.gitkeep`,
            message: `Create ${folder} folder`,
            content: Buffer.from("").toString("base64"),
            branch: "main",
          });
          logger.info(`Created new folder: ${folder}`);
        } catch (createError) {
          logger.error(`Failed to create folder ${folder}:`, createError);
          throw new Error(`Failed to create folder: ${createError.message}`);
        }
      } else {
        throw error;
      }
    }
  }

  async mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index], index);
      }
    }));

    return results;
  }
}

module.exports = new GithubService();
