const path = require("path");
// The repo's .env, whatever directory the process was started from. A variable that is already
// set (the shell, tests/_env.js) wins over the file.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { factoryInstalled } = require("../src/utils/factory");

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const env = (name) => String(process.env[name] || "").trim();
const canonicalBaseUrl = env("CANONICAL_BASE_URL").replace(/\/$/, "");

// An LLM provider setting: empty = `fallback`; a value that is not a provider stops the start
// (a typo must not silently send every job to another, maybe paid, provider).
const LLM_PROVIDERS = ["openrouter", "nvidia", "local", "claude"];
const llmProvider = (name, fallback) => {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  if (!LLM_PROVIDERS.includes(value)) throw new Error(`${name}="${env(name)}" is not an LLM provider; use one of: ${LLM_PROVIDERS.join(", ")}.`);
  return value;
};

// Who the pipeline publishes as: the article footer, the blog index byline, the LinkedIn reply
// persona and the commits on the resources repo. Every field is optional; an empty one leaves its
// line out (with no AUTHOR_EMAIL, GitHub attributes commits to the token's account).
const author = {
  name: env("AUTHOR_NAME"),
  // Handle shown as "Name (handle)"; also the name on commits to the resources repo.
  handle: env("AUTHOR_HANDLE"),
  email: env("AUTHOR_EMAIL"),
  // One clause after "Written by <name>, " in the article footer.
  bio: env("AUTHOR_BIO"),
  websiteUrl: env("AUTHOR_WEBSITE_URL"),
};
author.byline = author.name && author.handle ? `${author.name} (${author.handle})` : author.name || author.handle;
// Footer links in display order: { label, url, text } (text is the visible link text).
const displayUrl = (url) => url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "");
author.links = [
  { label: "Blog", url: canonicalBaseUrl, text: displayUrl(canonicalBaseUrl) },
  { label: "Portfolio", url: author.websiteUrl, text: displayUrl(author.websiteUrl) },
  { label: "GitHub", url: env("AUTHOR_GITHUB_URL"), text: displayUrl(env("AUTHOR_GITHUB_URL")) },
  { label: "LinkedIn", url: env("AUTHOR_LINKEDIN_URL"), text: displayUrl(env("AUTHOR_LINKEDIN_URL")) },
  { label: "X", url: env("AUTHOR_X_URL"), text: `@${env("AUTHOR_X_URL").replace(/\/$/, "").split("/").pop()}` },
  { label: "Email", url: author.email && `mailto:${author.email}`, text: author.email },
].filter((link) => link.url);

const config = {
  github: {
    personalAccessToken: process.env.GITHUB_PAT,
    owner: process.env.GITHUB_USERNAME,
    repo: process.env.GITHUB_REPONAME,
    // On (default): a run commits to its day's branch ("run/2026-10-29"), merged into main by a pull request
    // at the end of the run. Off: straight to main.
    runBranches: process.env.GITHUB_RUN_BRANCHES !== "false",
    // "Name <email>": every commit of a run carries it as a Co-authored-by trailer ("" = none).
    coAuthor: String(process.env.GITHUB_CO_AUTHOR || "").trim(),
  },
  author,
  llm: {
    // Who writes, per job: "openrouter" (OpenRouter, with NVIDIA NIM as the fallback), "nvidia"
    // (NVIDIA NIM only), "local" (Ollama only) or "claude" (the claude CLI on a Claude subscription;
    // when a call fails there, the OpenRouter/NVIDIA chain takes over if it has a key).
    // LLM_PROVIDER sets every job; LLM_ARTICLE_PROVIDER, LLM_COMMENT_PROVIDER (comments and their
    // critic) and LLM_VIRAL_PROVIDER (the LinkedIn viral pass; default: the comment provider) override it.
    provider: llmProvider("LLM_PROVIDER", "openrouter"),
    providers: {
      article: llmProvider("LLM_ARTICLE_PROVIDER", llmProvider("LLM_PROVIDER", "openrouter")),
      comment: llmProvider("LLM_COMMENT_PROVIDER", llmProvider("LLM_PROVIDER", "openrouter")),
      viral: llmProvider("LLM_VIRAL_PROVIDER", llmProvider("LLM_COMMENT_PROVIDER", llmProvider("LLM_PROVIDER", "openrouter"))),
    },
    // The claude CLI (LLM_*_PROVIDER=claude): signed in once with `claude`, billed to the plan.
    // --effort per call: low | medium | high | xhigh | max.
    claude: {
      bin: process.env.CLAUDE_BIN || "claude",
      model: process.env.CLAUDE_MODEL || "claude-sonnet-5-5",
      effort: process.env.CLAUDE_EFFORT || "medium",
      // The viral pass: the comment most people will read, so the strongest model.
      viralModel: process.env.CLAUDE_VIRAL_MODEL || "claude-opus-5-5",
      viralEffort: process.env.CLAUDE_VIRAL_EFFORT || "high",
      requestTimeoutMs: parsePositiveInteger(process.env.CLAUDE_REQUEST_TIMEOUT_MS, 300000),
    },
    // Local Ollama (provider "local").
    baseUrl: (process.env.LOCAL_LLM_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, ""),
    model: process.env.LOCAL_LLM_MODEL || "gemma4:latest",
    commentModel: process.env.LOCAL_LLM_COMMENT_MODEL || process.env.LOCAL_LLM_MODEL || "gemma4:latest",
    requestTimeoutMs: parsePositiveInteger(process.env.LOCAL_LLM_REQUEST_TIMEOUT_MS, 300000),
    startupTimeoutMs: parsePositiveInteger(process.env.LOCAL_LLM_STARTUP_TIMEOUT_MS, 60000),
    autoStart: process.env.LOCAL_LLM_AUTO_START !== "false",
    command: process.env.LOCAL_LLM_COMMAND || "ollama",
    nvidia: {
      apiKey: process.env.NVIDIA_API_KEY || "",
      baseUrl: (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
      model: process.env.NVIDIA_MODEL || "meta/llama-3.2-11b-vision-instruct",
      // Replies are short constraint-following jobs: a cheap text instruct model beats
      // the big article model here. Override with NVIDIA_COMMENT_MODEL="" to reuse the main model.
      commentModel: process.env.NVIDIA_COMMENT_MODEL !== undefined ? process.env.NVIDIA_COMMENT_MODEL : "openai/gpt-oss-20b",
      requestTimeoutMs: parsePositiveInteger(process.env.NVIDIA_REQUEST_TIMEOUT_MS, 240000),
    },
    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY || "",
      baseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      // One model for all LinkedIn writing: feed comments and both critics
      // (OPENROUTER_MODEL_OVERRIDE replaces it).
      model: process.env.OPENROUTER_MODEL_OVERRIDE || "deepseek/deepseek-v4-flash",
      // Article writer, picked by benchmark (30 real posts, judged for faithfulness,
      // specificity and publishability): strongest accuracy, skips thin posts, ~$0.0001/article.
      articleModel: process.env.OPENROUTER_ARTICLE_MODEL || "openai/gpt-oss-120b",
      articleFallbackModel: process.env.OPENROUTER_ARTICLE_FALLBACK_MODEL || "qwen/qwen3.7-flash",
      // The LinkedIn viral pass (LLM_VIRAL_PROVIDER=openrouter): the comment model unless set.
      viralModel: process.env.OPENROUTER_VIRAL_MODEL || "",
      // "input,output" USD per 1M tokens, for run-cost logs only.
      pricePerM: String(process.env.OPENROUTER_PRICE_PER_M || "").split(",").map(Number).filter(n => Number.isFinite(n) && n >= 0),
      requestTimeoutMs: parsePositiveInteger(process.env.OPENROUTER_REQUEST_TIMEOUT_MS, 120000),
    },
  },
  social: {
    linkedinFeedReply: process.env.LINKEDIN_FEED_REPLY === "true",
    // 3-6 likes after each article on targeted AI/founder/finance posts, the people who engaged with us first.
    linkedinLike: process.env.LINKEDIN_LIKE !== "false",
    // 1-2 extra comments a pass (at most every ~25 min) on posts going viral (big names in config/viral.js,
    // the day's most-engaged launches and funding news), on their own daily cap. Comments post only
    // with LINKEDIN_FEED_REPLY=true.
    linkedinViral: process.env.LINKEDIN_VIRAL !== "false",
    // true (default): likes, comments, viral comments and connects target AI/finance (warm people, creators,
    // content and people search, big names, the topic and US filters). false: the home feed (Top and Recent)
    // for likes and comments, viral comments too, any topic, and LinkedIn's "People you may know" for connects.
    linkedinTargeted: process.env.LINKEDIN_TARGETED !== "false",
    // 3-7 no-note connection requests a pass (at most every ~25 min) to US people in AI/tech (2 of 3) and finance/investing.
    linkedinConnect: process.env.LINKEDIN_CONNECT !== "false",
    // Replies to the comments on our own posts (the first hour decides a post's reach): at the start of a run
    // and then at most every ~25 min. A comment only the owner can answer is logged for them, never guessed.
    linkedinOwnReplies: process.env.LINKEDIN_OWN_REPLIES !== "false",
    // Replies under other people's posts on X, at most every ~25 min (src/services/xReplies.js): 2 or 3 on
    // fresh posts from the home timeline (For you, Following) and a curated list, then 1 or 2 on posts going viral.
    xReplies: process.env.X_REPLIES !== "false",
    // A comment in a Reddit thread after each batch commit (src/services/redditComments.js), from the account
    // logged in to the debug Chrome: subs in config/reddit.js, at most 1 a pass, 20-40 min apart, 6 a day, no plugs.
    redditComments: process.env.REDDIT_COMMENTS !== "false",
    // A comment on a Hacker News front-page thread in our field (src/services/hnComments.js), from the account
    // logged in to the debug Chrome: at most 1 a pass, 45-90 min apart, 3 a day (1 while the account is new), no plugs.
    hnComments: process.env.HN_COMMENTS !== "false",
  },
  syndication: {
    // The blog's public address. Empty: articles get no canonical link and nothing is queued for DEV.to.
    canonicalBaseUrl,
    devto: {
      apiKey: process.env.DEVTO_API_KEY || "",
      enabled: process.env.DEVTO_AUTO_PUBLISH === "true",
    },
  },
  // The resources repo as a Hugging Face dataset (src/services/hfDataset.js), refreshed weekly at the end of a
  // run; skipped, with one info line, until HF_TOKEN (a write token) is set.
  // Topic pages (topics/<slug>.md, the list in config/topics.js) and TIMELINE.md, rebuilt in the resources repo
  // at most once a day at the end of a run (src/services/kbTopics.js).
  kbTopics: { enabled: process.env.KB_TOPICS !== "false" },
  hfDataset: {
    enabled: process.env.HF_DATASET !== "false",
    token: env("HF_TOKEN"),
    repo: env("HF_DATASET_REPO") || "Drix10/ai-resources",
  },
  // The content factory is an optional add-on (its own repository, checked out at ./factory or
  // FACTORY_DIR; its settings live in its own config). It runs at the end of a run when
  // FACTORY_ENABLED=true and the checkout is present.
  factory: {
    requested: process.env.FACTORY_ENABLED === "true",
    enabled: process.env.FACTORY_ENABLED === "true" && factoryInstalled(),
  },
  folders: [
    {
      name: "AI Developer Tools",
      lists: ["1705695313334571453"],
    },
    {
      name: "AI Leaders and Thinkers",
      lists: ["1744564719309279599", "1828820239175590166"],
    },
    {
      name: "AI Companies and Ventures",
      lists: ["1696336383231525354", "1811755253970112761"],
    },
    {
      name: "CS Academics",
      lists: ["923778298705977344", "1148338147375271936"],
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
      name: "Devs, Designers, DevRel",
      lists: ["1805986224055955873"],
    },
    {
      name: "Tech Infrastructure",
      lists: ["1049745135431376896"],
    },
    {
      name: "Founders and Entrepreneurs",
      lists: ["8020", "1049755751185403904", "1540878174468317185"],
    },
    {
      name: "AI Organizations and Media",
      lists: ["1741902685669113995"],
    },
    {
      name: "AI Powered Film and Media",
      lists: ["1846645136064995788"],
    },
    {
      name: "AI Holodeck and Virtual Worlds",
      lists: ["1705695075014180922"],
    },
    {
      name: "AI Artists and Creators",
      lists: ["1697023939338519013"],
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
      name: "AI Consulting and Expertise",
      lists: ["1741727636806881476"],
    },
    {
      name: "AI Professionals and Community",
      lists: [
        "952969346518720512",
        "1807679743619367128",
        "1349067845615943681",
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
      lists: ["1255210280146989056"],
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
      lists: ["952969256903168000", "1073407660337188865"],
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
      name: "AI Education",
      lists: ["1705702737835643273"],
    },
    {
      name: "AI in Enterprise Applications",
      lists: ["1705692999974637973"],
    },
    {
      name: "Interesting Finds",
      lists: ["1369446830916968453"],
    },
    {
      name: "Investors and Venture Capital",
      lists: ["7450", "1751865298263932998"],
    },
    {
      name: "Cybersecurity and Tech",
      lists: ["201875823", "1245446681488916480"],
    },
    {
      name: "Neuroscience and AI",
      lists: ["1299331453344526336"],
    },
    {
      name: "PR and Communications",
      lists: ["1213510929629007872"],
    },
    {
      name: "Quantum Computing",
      lists: ["1394707190120861697", "1279024414210682880", "1879078035921748205"],
    },
    {
      name: "Spatial Computing",
      lists: ["1749207474983354875"],
    },
    {
      name: "Tech Companies and News",
      lists: ["1272237719733796866", "2299457"],
    },
    {
      name: "Tech Journalists and VIPs",
      lists: ["1272593321181851648"],
    },
    {
      name: "World News and Updates",
      lists: ["1297881495701397504", "1325322395335315457"],
    },
  ],
};

const seenFolderNames = new Set();
config.folders = config.folders.filter((folder) => {
  if (seenFolderNames.has(folder.name)) {
    console.warn(`Ignoring duplicate configured folder: ${folder.name}`);
    return false;
  }
  seenFolderNames.add(folder.name);
  return true;
});

const requiredConfigs = {
  "GitHub Personal Access Token": config.github.personalAccessToken,
  "GitHub Username": config.github.owner,
  "GitHub Repository": config.github.repo,
  "Folder(s)": config.folders,
};

for (const [key, value] of Object.entries(requiredConfigs)) {
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
