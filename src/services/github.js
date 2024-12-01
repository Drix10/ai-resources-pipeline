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

  async createMarkdownFileFromTweets(threadData) {
    try {
      logger.info(
        `Generating markdown content for ${threadData.length} threads`
      );

      if (!config.github.repo) {
        throw new Error("GitHub repository configuration is missing");
      }

      const markdownContent = await geminiService.generateMarkdown(threadData);
      const fileBuffer = Buffer.from(markdownContent);

      const result = await this.uploadMarkdownFile(
        fileBuffer,
        config.github.repo,
        config.github.folder || "threads"
      );

      if (!result.success) {
        throw new Error(`Failed to upload markdown: ${result.message}`);
      }

      logger.info("Success", {
        url: result.url,
      });

      return {
        success: true,
        url: result.url,
        content: markdownContent,
      };
    } catch (error) {
      logger.error("Error creating markdown file:", error);
      throw error;
    }
  }

  async uploadMarkdownFile(fileBuffer, repoName, folder) {
    const [owner, repo] = repoName.split("/");
    const timestamp = new Date().toISOString().split("T")[0];
    const hash = require("crypto")
      .createHash("md5")
      .update(fileBuffer)
      .digest("hex")
      .slice(0, 6);
    const filePath = `${folder}/thread-resources-${timestamp}-${hash}.md`;
    const base64FileContent = fileBuffer.toString("base64");

    try {
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
        base64FileContent
      );

      const fileUrl = `https://github.com/${owner}/${repo}/blob/main/${filePath}`;

      await this.updateReadmeWithNewFile(owner, repo, fileUrl, timestamp);

      return {
        success: true,
        message: "File uploaded successfully",
        url: fileUrl,
        sha: response.data.content.sha,
      };
    } catch (error) {
      return this.handleGitHubError(error);
    }
  }

  async updateReadmeWithNewFile(owner, repo, fileUrl, timestamp) {
    try {
      const path = "README.md";
      const existing = await this.octokit.repos
        .getContent({
          owner,
          repo,
          path,
        })
        .catch(() => null);

      let content = existing
        ? Buffer.from(existing.data.content, "base64").toString()
        : "";

      const newEntry = `- [${timestamp}](${fileUrl}) - Latest tech updates`;
      if (content.includes("## Recent Updates")) {
        const updateSection = content.split("## Recent Updates");
        const updates = updateSection[1].split("\n").slice(0, 10);
        content = `${
          updateSection[0]
        }## Recent Updates\n${newEntry}\n${updates.join("\n")}`;
      } else {
        content += `\n\n## Recent Updates\n${newEntry}`;
      }

      await this.createOrUpdateReadme(owner, repo, content);
    } catch (error) {
      logger.warn("Failed to update README with new file link:", error);
    }
  }

  async checkRepoAccess(owner, repo) {
    try {
      logger.info(`Checking access to repository ${owner}/${repo}`);

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

  async createOrUpdateFile(owner, repo, filePath, content) {
    try {
      if (!owner || !repo || !filePath || !content) {
        throw new Error("Missing required parameters for file creation");
      }

      const branch = config.github.branch || "main";

      logger.info(`Creating/updating file in ${owner}/${repo}`, {
        path: filePath,
        branch,
      });

      const { data: ref } = await this.octokit.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      });

      const existingFile = await this.octokit.repos
        .getContent({
          owner,
          repo,
          path: filePath,
          ref: branch,
        })
        .catch(() => null);

      const commitMessage = this.generateCommitMessage(filePath);

      return await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: commitMessage,
        content,
        sha: existingFile?.data?.sha,
        branch,
        committer: {
          name: config.github.committerName || "Twitter Bot",
          email: config.github.committerEmail || "bot@example.com",
        },
      });
    } catch (error) {
      logger.error("File creation/update failed:", {
        owner,
        repo,
        path: filePath,
        error: error.message,
      });
      throw error;
    }
  }

  generateCommitMessage(filePath) {
    const timestamp = new Date().toISOString();
    return `📝 Add thread resources markdown (${timestamp})

File: ${filePath}
Generated by Twitter-to-GitHub Pipeline`;
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

      logger.info("GitHub API Rate Limit Status:", {
        used,
        remaining,
        limit,
        resetTime: new Date(reset * 1000).toISOString(),
      });

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
      const branch = config.github.branch || "main";

      const existing = await this.octokit.repos
        .getContent({
          owner,
          repo,
          path,
          ref: branch,
        })
        .catch(() => null);

      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: "📚 Update README with latest tweets",
        content: Buffer.from(content).toString("base64"),
        sha: existing?.data?.sha,
        branch,
        committer: {
          name: config.github.committerName || "Twitter Bot",
          email: config.github.committerEmail || "bot@example.com",
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
}

module.exports = new GithubService();
