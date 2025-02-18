const { Octokit } = require("@octokit/rest");
const config = require("../../config");
const { logger, handleError } = require("../utils/helpers");
const geminiService = require("./gemini");

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
      logger.info(
        `Generating markdown content for ${threadData.length} threads of type ${queryName}`
      );

      if (!config.github.repo) {
        throw new Error("GitHub repository configuration is missing");
      }

      const markdownContent = await geminiService.generateMarkdown(threadData);
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

  async uploadMarkdownFile(fileBuffer, repoName, folder) {
    const [owner, repo] = repoName.split("/");

    const decodedFolder = folder.name.replace(/ /g, " ");
    const urlSafeFolder = encodeURIComponent(decodedFolder);

    try {
      await this.ensureFolderExists(owner, repo, decodedFolder);

      const nextNumber = await this.getNextFileNumber(
        owner,
        repo,
        decodedFolder
      );

      const fileName = `resources-${String(nextNumber).padStart(3, "0")}.md`;
      const filePath = `${decodedFolder}/${fileName}`;
      const base64FileContent = fileBuffer.toString("base64");

      const rateLimit = await this.checkRateLimit();
      if (rateLimit.isLimited) {
        throw new Error(
          `Rate limit exceeded. Resets at ${rateLimit.resetTime}`
        );
      }

      await this.checkRepoAccess(owner, repo);

      const response = await this.createOrUpdateFile(
        owner,
        repo,
        filePath,
        base64FileContent,
        `📝 Add resource collection #${nextNumber}`
      );

      const fileUrl = `https://github.com/${owner}/${repo}/blob/main/${urlSafeFolder}/${fileName}`;

      return {
        success: true,
        message: "File uploaded successfully",
        url: fileUrl,
        sha: response.data.content.sha,
        number: nextNumber,
      };
    } catch (error) {
      return this.handleGitHubError(error);
    }
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
      const existing = await this.octokit.repos
        .getContent({
          owner,
          repo,
          path,
          ref: "main",
        })
        .catch(() => null);

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

      for (const folder of config.folders) {
        const decodedFolder = folder.name.replace(/ /g, " ");
        try {
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

          updatesContent += `### ${folder.name}\n\n`;

          if (files.length > 0) {
            updatesContent += `*   [Latest Update (#${String(
              files[0].number
            ).padStart(3, "0")})](${files[0].url}) - *${
              folder.description || "Resources related to " + folder.name
            }*\n`;
          } else {
            updatesContent += `*   No resources yet.\n`;
          }
          updatesContent += "\n";
        } catch (error) {
          if (error.status === 404) {
            updatesContent += `### ${folder.name}\n\n`;
            updatesContent += `*   No resources yet.\n\n`;
          } else {
            logger.error(`Error getting content for ${decodedFolder}:`, error);
            updatesContent += `### ${folder.name}\n\n`;
            updatesContent += `*   Error loading resources.\n\n`;
          }
        }
      }

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
      try {
        const existing = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        existingSha = existing.data.sha;
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
        logger.info("README.md not found, creating a new one.");
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
}

module.exports = new GithubService();
