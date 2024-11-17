const express = require("express");
const githubController = require("../controllers/github");
const { authenticate } = require("../middleware/auth");
const { validateGitHubRequest } = require("../middleware/validation");
const config = require("../config");
const router = express.Router();

router.post(
  "/upload",
  authenticate,
  validateGitHubRequest,
  async (req, res) => {
    try {
      const { file } = req.files;
      const { repo, folder } = config.github;
      const uploadResult = await githubController.uploadMarkdownFile(
        file,
        repo,
        folder
      );
      res.status(200).json(uploadResult);
    } catch (error) {
      console.error("Error uploading file:", error);
      if (error.status === 401) {
        res.status(401).json({ error: "Unauthorized" });
      } else if (error.status === 429) {
        res.status(429).json({ error: "GitHub API rate limit exceeded" });
      } else if (error.code === "ENOENT") {
        res.status(400).json({ error: "File not found" });
      } else {
        res.status(500).json({ error: "Internal Server Error" });
      }
    }
  }
);

module.exports = router;
