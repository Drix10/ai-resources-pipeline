const express = require("express");
const tweetsController = require("../controllers/tweets");
const auth = require("../middleware/auth");
const { tweetValidationRules } = require("../middleware/validation");
const router = express.Router();

router.post("/", auth, tweetValidationRules, async (req, res) => {
  try {
    const { keywords, hashtags } = req.body;
    const tweets = await tweetsController.fetchAndProcessTweets(
      keywords,
      hashtags
    );
    res.status(200).json({ tweets });
  } catch (error) {
    console.error("Error processing tweets:", error);
    if (error.message.includes("Rate limit")) {
      res.status(429).json({ error: "Twitter API rate limit exceeded" });
    } else {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
});

module.exports = router;
