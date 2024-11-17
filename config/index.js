require("dotenv").config();

const config = {
  mongodb: {
    uri: process.env.MONGODB_URI,
    options: {
      serverSelectionTimeoutMS: 5000,
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
    keywords:
      process.env.SEARCH_KEYWORDS || "developer,programming,coding,webdev",
    hashtags:
      process.env.SEARCH_HASHTAGS || "100DaysOfCode,DevCommunity,CodeNewbie",
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  cron: {
    schedule: "0 * * * *",
    immediate: true,
  },
};

// Required configurations check
const requiredConfigs = {
  "MongoDB URI": config.mongodb.uri,
  "Twitter Username": config.twitter.username,
  "Twitter Password": config.twitter.password,
  "GitHub Personal Access Token": config.github.personalAccessToken,
  "GitHub Repository": config.github.repo,
  "Gemini API Key": config.gemini.apiKey,
  "Discord Webhook URL": config.discord.webhookUrl,
};

// Validate required configurations
for (const [key, value] of Object.entries(requiredConfigs)) {
  if (!value) {
    throw new Error(`Required configuration ${key} is missing`);
  }
}

module.exports = config;
