require("dotenv").config();

const config = {
  twitter: {
    username: process.env.TWITTER_USERNAME,
    password: process.env.TWITTER_PASSWORD,
    email: process.env.TWITTER_EMAIL,
  },
  github: {
    personalAccessToken: process.env.GITHUB_PAT,
    owner: process.env.GITHUB_USERNAME,
    repo: process.env.GITHUB_REPONAME,
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY,
  },
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  monitoring: {
    targetListId: process.env.MONITOR_LIST_ID,
    checkInterval: parseInt(process.env.CHECK_INTERVAL) || 300000,
    rateLimitDelay: parseInt(process.env.RATE_LIMIT_DELAY) || 60000,
    sendAllTweets: process.env.SEND_ALL_TWEETS === "true" || false,
    keywords: process.env.MONITOR_KEYWORDS
      ? process.env.MONITOR_KEYWORDS.split(",").map((k) => k.trim())
      : [],
  },
  folders: [
    {
      name: "CS Academics",
      lists: ["1805784149468340566"],
    },
    {
      name: "Devs, Designers, DevRel",
      lists: ["1805986224055955873"],
    },
    {
      name: "Tech VIPs",
      lists: ["7100"],
    },
    {
      name: "VC Firms",
      lists: ["1219428908283514881"],
    },
    {
      name: "AI Developer Tools",
      lists: ["1705695313334571453"],
    },
    {
      name: "AI Education",
      lists: ["1705702737835643273"],
    },
    {
      name: "AI Artists and Creators",
      lists: ["1697023939338519013"],
    },
    {
      name: "AI Companies and Ventures",
      lists: ["1696336383231525354", "1811755253970112761"],
    },
    {
      name: "AI Consulting and Expertise",
      lists: ["1741727636806881476"],
    },
    {
      name: "AI in Enterprise Applications",
      lists: ["1705692999974637973"],
    },
    {
      name: "AI Powered Film and Media",
      lists: ["1846645136064995788", "1741902685669113995"],
    },
    {
      name: "AI Holodeck and Virtual Worlds",
      lists: ["1705695075014180922"],
    },
    {
      name: "AI Leaders and Thinkers",
      lists: ["1744564719309279599", "1828820239175590166"],
    },
    {
      name: "AI in Healthcare and Science",
      lists: ["1705695499108638974"],
    },
    {
      name: "AI Generated Music and Audio",
      lists: ["1705703289579602425"],
    },
    {
      name: "AI Organizations and Media",
      lists: ["1741902685669113995"],
    },
    {
      name: "AI Professionals and Community",
      lists: [
        "952969346518720512",
        "1807679743619367128",
        "1811773620181463494",
        "1822396593506848796",
        "1854973625138294946",
      ],
    },
    {
      name: "AI Policy and Ethical Considerations",
      lists: ["1805777808330781114"],
    },
    {
      name: "AI in Real Estate and Property Tech",
      lists: ["1705718284488986722"],
    },
    {
      name: "AI and Robotics Applications",
      lists: ["1805786050763087967"],
    },
    {
      name: "AI Driven Vehicles and Transportation",
      lists: ["956617160733818880"],
    },
    {
      name: "AI for Content Creation and Marketing",
      lists: ["1705715250895667539"],
    },
    {
      name: "AR VR Companies and Development",
      lists: ["733277650085511168"],
    },
    {
      name: "AR VR Professionals and Community",
      lists: ["733162578625449985", "1786062895668974066"],
    },
    {
      name: "Climate and Weather Technology",
      lists: ["1038538444480307200"],
    },
    {
      name: "Computer Vision and AI Applications",
      lists: ["1052973537944694784"],
    },
    {
      name: "Crypto and Web3",
      lists: ["952969256903168000", "1837926936586473655"],
    },
    {
      name: "Decentralized AI",
      lists: ["1770238087593112021"],
    },
    {
      name: "The Exponential Future",
      lists: ["1579148080745791489"],
    },
    {
      name: "Founders and Entrepreneurs",
      lists: ["8020", "1049755751185403904", "1795545373173575917"],
    },
    {
      name: "Tech Infrastructure",
      lists: ["1049745135431376896"],
    },
    {
      name: "Interesting Finds",
      lists: ["1221942510081036293", "1814007176647847963"],
    },
    {
      name: "Investors and Venture Capital",
      lists: ["7450", "1751865298263932998", "1219428908283514881"],
    },
    {
      name: "Neuroscience and AI",
      lists: ["1805775704568844551"],
    },
    {
      name: "PR and Communications",
      lists: ["1049751021877002240"],
    },
    {
      name: "Quantum Computing",
      lists: ["1805983875052798286"],
    },
    {
      name: "Cybersecurity and Tech",
      lists: ["1052973696090955776"],
    },
    {
      name: "Spatial Computing",
      lists: ["1490757476332945413"],
    },
    {
      name: "Tech Companies and News",
      lists: ["953543671843975168", "31748"],
    },
    {
      name: "Tech Journalists and VIPs",
      lists: ["8096", "7100"],
    },
    {
      name: "World News and Updates",
      lists: ["72719839"],
    },
  ],
};

const requiredConfigs = {
  "Twitter Username": config.twitter.username,
  "Twitter Password": config.twitter.password,
  "Twitter Email": config.twitter.email,
  "GitHub Personal Access Token": config.github.personalAccessToken,
  "GitHub Repository": config.github.repo,
  "Gemini API Key": config.gemini.apiKey,
  "Folder(s)": config.folders,
};

// Discord webhook is optional - only required for monitoring (list-tracker.js)
// Validation for monitoring is done in list-tracker.js itself

for (const [key, value] of Object.entries(requiredConfigs)) {
  // Special validation for folders array - must have at least one entry
  if (key === "Folder(s)") {
    if (!value || !Array.isArray(value) || value.length === 0) {
      throw new Error(
        `Required configuration ${key} is missing or empty - at least one folder must be configured`,
      );
    }
  } else if (!value) {
    throw new Error(`Required configuration ${key} is missing`);
  }
}

module.exports = config;
