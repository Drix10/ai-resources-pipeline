require("dotenv").config();

const config = {
  mongodb: {
    uri: process.env.MONGODB_URI,
    options: {
      serverSelectionTimeoutMS: 45000,
      socketTimeoutMS: 45000,
    },
  },
  twitter: {
    username: process.env.TWITTER_USERNAME,
    password: process.env.TWITTER_PASSWORD,
  },
  github: {
    personalAccessToken: process.env.GITHUB_PAT,
    repo: process.env.GITHUB_REPO,
    folder: process.env.GITHUB_FOLDER || "tweets",
    branch: process.env.GITHUB_BRANCH || "main",
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  search: {
    keywords: process.env.SEARCH_KEYWORDS
      ? process.env.SEARCH_KEYWORDS.split(",").map((k) => k.trim())
      : [],
    hashtags: process.env.SEARCH_HASHTAGS
      ? process.env.SEARCH_HASHTAGS.split(",").map((h) => h.trim())
      : [],
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE || "0 * * * *",
    immediate: true,
  },
  minRequiredTweets: parseInt(process.env.MIN_REQUIRED_TWEETS) || 5,
};

const requiredConfigs = {
  "MongoDB URI": config.mongodb.uri,
  "Twitter Username": config.twitter.username,
  "Twitter Password": config.twitter.password,
  "GitHub Personal Access Token": config.github.personalAccessToken,
  "GitHub Repository": config.github.repo,
  "Gemini API Key": config.gemini.apiKey,
  "Discord Webhook URL": config.discord.webhookUrl,
};

for (const [key, value] of Object.entries(requiredConfigs)) {
  if (!value) {
    throw new Error(`Required configuration ${key} is missing`);
  }
}

module.exports = config;
