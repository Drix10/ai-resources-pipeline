const dotenv = require("dotenv");

dotenv.config();

const config = {
  twitter: {
    apiKey: process.env.TWITTER_API_KEY,
    apiSecret: process.env.TWITTER_API_SECRET,
    bearerToken: process.env.TWITTER_BEARER_TOKEN,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  github: {
    personalAccessToken: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
    repo: process.env.GITHUB_REPO,
    folder: process.env.GITHUB_FOLDER,
  },
  mongodb: {
    uri: process.env.MONGODB_URI,
  },
  cron: {
    schedule: process.env.CRON_SCHEDULE,
  },
  email: {
    host: process.env.EMAIL_HOST,
    port: process.env.EMAIL_PORT,
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  server: {
    port: process.env.PORT || 3000,
  },
};

// Validate required configurations
const requiredConfigs = [
  "twitter.apiKey",
  "twitter.apiSecret",
  "twitter.bearerToken",
  "gemini.apiKey",
  "github.personalAccessToken",
  "github.repo",
  "github.folder",
  "mongodb.uri",
  "cron.schedule",
];

requiredConfigs.forEach((key) => {
  const value = key.split(".").reduce((o, k) => o && o[k], config);
  if (!value) {
    throw new Error(`Missing required configuration: ${key}`);
  }
});

module.exports = config;
