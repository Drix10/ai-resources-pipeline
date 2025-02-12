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
      lists: [
        "1183066543174881282",
        "1594632801785094146",
        "1394275179077914632",
        "1400568686931550217",
        "1091845227416092673",
        "1762486484111634815",
      ],
    },
    {
      name: "Coding and Software Development",
      lists: [
        "1281694355024011265",
        "1403650939047890946",
        "1247246664076800007",
        "1299970078230765568",
        "1422301561133228032",
        "1762520870393184573",
        "1762520567314686389",
      ],
    },
    {
      name: "Productivity and Passive Income",
      lists: [
        "928982358082179072",
        "1591607866091339786",
        "1195113292085317632",
        "1022182056808402945",
        "1498705679241998337",
      ],
    },
    {
      name: "AI Artists and Creators",
      lists: ["1762485748469383596"],
    },
    {
      name: "AI Companies and Ventures",
      lists: ["1762486094323220861", "1762486224492310958"],
    },
    {
      name: "AI Consulting and Expertise",
      lists: ["1762486369854320795"],
    },
    {
      name: "AI in Enterprise Applications",
      lists: ["1762486816870359164"],
    },
    {
      name: "AI-Powered Film and Media",
      lists: ["1762486938394370171"],
    },
    {
      name: "AI Holodeck and Virtual Worlds",
      lists: ["1762487076892741918"],
    },
    {
      name: "AI Leaders and Thinkers",
      lists: ["1762487240196346177", "1762487348818161907"],
    },
    {
      name: "AI in Healthcare and Science",
      lists: ["1762487537213399163"],
    },
    {
      name: "AI-Generated Music and Audio",
      lists: ["1762487663874330987"],
    },
    {
      name: "AI Organizations and Media",
      lists: ["1762487793426841816"],
    },
    {
      name: "AI Professionals and Community",
      lists: [
        "1762487913976344923",
        "1762488021318779319",
        "1762488127194341815",
        "1762488229116588485",
        "1762488340178112858",
      ],
    },
    {
      name: "AI Policy and Ethical Considerations",
      lists: ["1762488459581399161"],
    },
    {
      name: "AI in Real Estate and Property Tech",
      lists: ["1762488557519634818"],
    },
    {
      name: "AI and Robotics Applications",
      lists: ["1762488661568364895"],
    },
    {
      name: "AI-Driven Vehicles and Transportation",
      lists: ["1762488781086581147"],
    },
    {
      name: "AI for Content Creation and Marketing",
      lists: ["1762488903474385365"],
    },
    {
      name: "AR/VR Companies and Development",
      lists: ["1762489054428651968"],
    },
    {
      name: "AR/VR Professionals and Community",
      lists: ["1762489161168363875", "1762489264222601619"],
    },
    {
      name: "Climate and Weather Technology",
      lists: ["1762489387218129315"],
    },
    {
      name: "Computer Vision and AI Applications",
      lists: ["1762489493818409317"],
    },
    {
      name: "Crypto and Web 3.0",
      lists: ["1762520311717740895", "1762520423411843514"],
    },
    {
      name: "Decentralized AI",
      lists: ["1762520729775378817"],
    },
    {
      name: "The Exponential Future",
      lists: ["1762521094288150954"],
    },
    {
      name: "Founders and Entrepreneurs",
      lists: [
        "1762521224293441979",
        "1762521323595571655",
        "1762521414485385621",
      ],
    },
    {
      name: "Tech Infrastructure",
      lists: ["1762521598278865395"],
    },
    {
      name: "Interesting Finds",
      lists: ["1762521703275348385", "1762521793078661568"],
    },
    {
      name: "Investors and Venture Capital",
      lists: [
        "1762521923717648849",
        "1762522043576811959",
        "1762523003326320795",
      ],
    },
    {
      name: "Neuroscience and AI",
      lists: ["1762522173728252359"],
    },
    {
      name: "PR and Communications",
      lists: ["1762522293718888815"],
    },
    {
      name: "Quantum Computing",
      lists: ["1762522400357740804"],
    },
    {
      name: "Cybersecurity and Tech",
      lists: ["1762522507277680798"],
    },
    {
      name: "Spatial Computing",
      lists: ["1762522651328360816"],
    },
    {
      name: "Tech Companies and News",
      lists: ["1762522758941188590", "1762522913228988689"],
    },
    {
      name: "Tech Journalists and VIPs",
      lists: ["1762522837767610819", "1762522958700224849"],
    },
    {
      name: "World News and Updates",
      lists: ["1762523093068394879"],
    },
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
