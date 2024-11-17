const { Octokit } = require("@octokit/rest");
const config = require("../../../config/index");
const { createReadStream } = require("fs");

class GithubController {
  async uploadMarkdownFile(file, repoName, folder) {
    const { personalAccessToken } = config.github;
    const fileName = file.name;
    const filePath = `${folder}/${fileName}`;
    const octokit = new Octokit({ auth: personalAccessToken });

    try {
      const { data: fileContent } = await octokit.rest.repos.getContent({
        owner: repoName.split("/")[0],
        repo: repoName.split("/")[1],
        path: filePath,
      });

      const sha = fileContent.sha;
      const message = "Automated update of tweets";
      const base64FileContent = file.buffer.toString("base64");

      await octokit.rest.repos.createOrUpdateFileContents({
        owner: repoName.split("/")[0],
        repo: repoName.split("/")[1],
        path: filePath,
        message,
        content: base64FileContent,
        sha,
        branch: "main",
      });

      return { success: true, message: "File uploaded successfully" };
    } catch (error) {
      console.error("Error uploading file:", error);
      if (error.status === 401) {
        throw { status: 401, message: "Unauthorized" };
      } else if (error.status === 429) {
        throw { status: 429, message: "GitHub API rate limit exceeded" };
      } else if (error.code === "ENOENT") {
        throw { status: 400, message: "File not found" };
      } else {
        throw { status: 500, message: "Internal Server Error" };
      }
    }
  }
}

module.exports = new GithubController();
