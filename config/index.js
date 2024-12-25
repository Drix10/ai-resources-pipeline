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
    email: process.env.TWITTER_EMAIL,
  },
  github: {
    personalAccessToken: process.env.GITHUB_PAT,
    repo: process.env.GITHUB_REPO,
    folderOne: process.env.GITHUB_FOLDER_ONE,
    folderTwo: process.env.GITHUB_FOLDER_TWO,
    folderThree: process.env.GITHUB_FOLDER_THREE,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
};

const requiredConfigs = {
  "MongoDB URI": config.mongodb.uri,
  "Twitter Username": config.twitter.username,
  "Twitter Password": config.twitter.password,
  "Twitter Email": config.twitter.email,
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
