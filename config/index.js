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
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  folders: [
    {
      name: "AI Tools and Resources",
      type: 1,
      lists: [
        "1183066543174881282",
        "1594632801785094146",
        "1394275179077914632",
        "1400568686931550217",
        "1091845227416092673",
      ],
    },
    {
      name: "Coding and Software Development",
      type: 2,
      lists: [
        "1281694355024011265",
        "1403650939047890946",
        "1247246664076800007",
        "1299970078230765568",
        "1422301561133228032",
      ],
    },
    {
      name: "Productivity and Passive Income",
      type: 3,
      lists: [
        "928982358082179072",
        "1591607866091339786",
        "1195113292085317632",
        "1022182056808402945",
        "1498705679241998337",
      ],
    },
    //add more as needed
  ],
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
  "Folder(s)": config.folders,
};

for (const [key, value] of Object.entries(requiredConfigs)) {
  if (!value) {
    throw new Error(`Required configuration ${key} is missing`);
  }
}

module.exports = config;
