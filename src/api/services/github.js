const { Octokit } = require("@octokit/rest");
const config = require("../../config");
const { logger } = require("../../utils/helpers");

class GithubService {
  constructor() {
    this.octokit = new Octokit({ auth: config.github.personalAccessToken });
  }

  async uploadMarkdownFile(fileBuffer, repoName, folder) {
    const [owner, repo] = repoName.split("/");
    const filePath = `${folder}/tweets-${Date.now()}.md`;
    const base64FileContent = fileBuffer.toString("base64");
    let sha;

    try {
      const { data: fileContent } = await this.octokit.rest.repos.getContent({
        owner,
        repo,
        path: filePath,
      });
      sha = fileContent.sha;
    } catch (error) {
      if (error.status !== 404) {
        logger.error("Error checking file existence:", error);
        return { success: false, message: "Failed to check file existence" };
      }
      sha = null;
    }

    try {
      await this.octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: "Automated update of tweets",
        content: base64FileContent,
        sha,
        branch: "main",
      });
      logger.info(`File uploaded successfully to ${repoName}/${filePath}`);
      return { success: true, message: "File uploaded successfully" };
    } catch (error) {
      logger.error("Error uploading file:", error);
      if (error.status === 401) {
        return { success: false, message: "Unauthorized" };
      } else if (error.status === 429) {
        return { success: false, message: "GitHub API rate limit exceeded" };
      } else {
        return { success: false, message: "Internal Server Error" };
      }
    }
  }
}

module.exports = new GithubService();
