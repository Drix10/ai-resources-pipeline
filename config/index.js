require("dotenv").config();

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const config = {
  github: {
    personalAccessToken: process.env.GITHUB_PAT,
    owner: process.env.GITHUB_USERNAME,
    repo: process.env.GITHUB_REPONAME,
  },
  llm: {
    // Default matches .env.example: NVIDIA NIM unless LOCAL_LLM=true.
    useLocal: (process.env.LOCAL_LLM ?? process.env.USE_LOCAL_LLM ?? "false") === "true",
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
      // One model for all LinkedIn writing: posts, feed comments and both critics.
      // Pinned: DeepSeek V4 Flash for every comment/critic call. OPENROUTER_MODEL in
      // .env no longer overrides it; set OPENROUTER_MODEL_OVERRIDE to change it.
      model: process.env.OPENROUTER_MODEL_OVERRIDE || "deepseek/deepseek-v4-flash",
      // Article writer, picked by benchmark (30 real posts, judged for faithfulness,
      // specificity and publishability): strongest accuracy, skips thin posts, ~$0.0001/article.
      articleModel: process.env.OPENROUTER_ARTICLE_MODEL || "openai/gpt-oss-120b",
      articleFallbackModel: process.env.OPENROUTER_ARTICLE_FALLBACK_MODEL || "qwen/qwen3.7-flash",
      // "input,output" USD per 1M tokens, for run-cost logs only.
      pricePerM: String(process.env.OPENROUTER_PRICE_PER_M || "").split(",").map(Number).filter(n => Number.isFinite(n) && n >= 0),
      requestTimeoutMs: parsePositiveInteger(process.env.OPENROUTER_REQUEST_TIMEOUT_MS, 120000),
    },
  },
  // Used by the list tracker (npm run list), not by the main pipeline.
  discord: {
    webhookUrl: process.env.DISCORD_WEBHOOK_URL,
  },
  social: {
    linkedinFeedReply: process.env.LINKEDIN_FEED_REPLY === "true",
    // Like-only engagement while comments stay disabled (perfecting replies).
    // 5-9 likes per cycle on targeted finance/AI/founder posts.
    linkedinLike: process.env.LINKEDIN_LIKE !== "false",
    // Simple mode: raw LLM reply, no system prompting, no gates, no critic.
    // Experiment flag for comparing against the policed pipeline. Nothing posts
    // without LINKEDIN_FEED_REPLY=true; previews stay dry-run either way.
    linkedinSimpleReply: process.env.LINKEDIN_SIMPLE_REPLY === "true",
    // Post sources for likes/comments: "targeted" (default: content search + config/creators.json,
    // home-feed fallback) or "feed" (home feed Top/Recent only).
    linkedinSource: process.env.LINKEDIN_SOURCE === "feed" ? "feed" : "targeted",
    // 10-15 no-note connection requests per run to US people in AI/tech/finance/investing.
    linkedinConnect: process.env.LINKEDIN_CONNECT !== "false",
    twitterPost: process.env.TWITTER_POST !== "false",
  },
  syndication: {
    canonicalBaseUrl: (process.env.CANONICAL_BASE_URL || "https://blogs.drix10.com").replace(/\/$/, ""),
    devto: {
      apiKey: process.env.DEVTO_API_KEY || "",
      enabled: process.env.DEVTO_AUTO_PUBLISH === "true",
    },
  },
  // Instagram content factory (src/factory/, docs/CONTENT_FACTORY.md). Off unless FACTORY_ENABLED=true.
  factory: {
    enabled: process.env.FACTORY_ENABLED === "true",
    // Opus is the director: storyboard JSON (template mode), vision QA, and full code films
    // (agent/hero mode). Default backend is the LOCAL Claude Code CLI (`claude -p`) on the machine
    // that runs `npm start`, signed in with your Claude plan: no Anthropic API key needed.
    // "anthropic" / "openrouter" are optional API fallbacks for headless servers.
    opusBackend: ["claude-code", "anthropic", "openrouter"].includes(process.env.FACTORY_OPUS_BACKEND) ? process.env.FACTORY_OPUS_BACKEND : "claude-code",
    claudeBin: process.env.CLAUDE_BIN || "claude",
    // Claude Code --effort: low | medium | high | xhigh | max. xhigh = "extra" effort.
    claudeEffort: ["low", "medium", "high", "xhigh", "max"].includes(process.env.FACTORY_CLAUDE_EFFORT) ? process.env.FACTORY_CLAUDE_EFFORT : "xhigh",
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY || "",
      baseUrl: (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, ""),
      model: process.env.FACTORY_OPUS_MODEL || "claude-opus-5-5",
      requestTimeoutMs: parsePositiveInteger(process.env.FACTORY_OPUS_TIMEOUT_MS, 600000),
    },
    openrouterOpusModel: process.env.FACTORY_OPENROUTER_OPUS_MODEL || "anthropic/claude-opus-5.5",
    // Stories per pipeline cycle (the editor picks the best of the run), and the formats made from each.
    perCycle: parsePositiveInteger(process.env.FACTORY_PER_CYCLE, 1),
    formats: String(process.env.FACTORY_FORMATS || "reel").split(",").map((f) => f.trim()).filter((f) => f === "reel" || f === "carousel"),
    // Vision QA: Opus looks at rendered stills and can send the storyboard back once.
    visionQa: process.env.FACTORY_VISION_QA !== "false",
    // How reels are made after the storyboard exists:
    //   agent    (default) every reel is a one-off film written by your local Claude Code agent,
    //            with its own look; recent looks and topics are fed back so nothing repeats
    //   hybrid   house templates for most reels plus heroPerWeek agent films
    //   template house templates only (fast previews; every reel shares one look)
    videoMode: ["hybrid", "agent", "template"].includes(process.env.FACTORY_VIDEO_MODE) ? process.env.FACTORY_VIDEO_MODE : "agent",
    // Footage and photos for the scenes that ask for them (src/factory/stock.js). Pexels and
    // Pixabay keys are free; Mixkit video, Wikimedia Commons and Openverse photos need none.
    stock: {
      pexelsKey: process.env.PEXELS_API_KEY || "",
      pixabayKey: process.env.PIXABAY_API_KEY || "",
      openverse: process.env.FACTORY_OPENVERSE !== "off",
      mixkit: process.env.FACTORY_MIXKIT !== "off",
      commons: process.env.FACTORY_COMMONS !== "off",
    },
    // Voiceover for agent reels (src/factory/voice.js): ElevenLabs is the main provider, OpenRouter
    // (a speech model over chat completions) the fallback. Without either key reels get music only.
    voice: {
      enabled: process.env.FACTORY_VOICE !== "off",
      elevenlabsKey: process.env.ELEVENLABS_API_KEY || "",
      // A premade library voice until your own is set ("George": warm, articulate narrator).
      voiceId: process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb",
      model: process.env.ELEVENLABS_MODEL || "eleven_v4",
      // Tried in order when a model is refused (e.g. not enabled for the account, no timestamps).
      fallbackModels: String(process.env.ELEVENLABS_FALLBACK_MODELS ?? "eleven_v3,eleven_multilingual_v2").split(",").map((x) => x.trim()).filter(Boolean),
      // 0 = most expressive (tags land hardest), 0.5 = natural, 1 = most stable.
      stability: (() => {
        const n = Number(process.env.ELEVENLABS_STABILITY);
        return process.env.ELEVENLABS_STABILITY?.trim() && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
      })(),
      orModel: process.env.FACTORY_VOICE_FALLBACK_MODEL || "openai/gpt-audio-mini",
      orVoice: process.env.FACTORY_VOICE_FALLBACK_VOICE || "onyx",
    },
    // Carousels: agent = designed slide by slide by the local agent from a director's prompt
    // (default); template = the house slide templates (fast, but every carousel shares one look).
    carouselMode: process.env.FACTORY_CAROUSEL_MODE === "template" ? "template" : "agent",
    // When a run brought nothing new (or everything new is made already): true = make a piece from
    // the LinkedIn Insights archive; false (default) = skip, so the channel only posts fresh stories.
    archiveFallback: process.env.FACTORY_ARCHIVE_FALLBACK === "true",
    heroPerWeek: parsePositiveInteger(process.env.FACTORY_HERO_PER_WEEK, 2),
    // When an agent film fails: false (default) = mark failed and retry next cycle, so every
    // posted reel stays unique; true = ship a templated reel instead.
    templateFallback: process.env.FACTORY_TEMPLATE_FALLBACK === "true",
    // Novelty memory: how many recent pieces' looks/topics the director must avoid repeating.
    noveltyWindow: parsePositiveInteger(process.env.FACTORY_NOVELTY_WINDOW, 15),
    heroTimeoutMs: parsePositiveInteger(process.env.FACTORY_HERO_TIMEOUT_MS, 60 * 60 * 1000),
    // Real material: how many of the article's linked pages to screenshot (0 = none).
    assetPages: process.env.FACTORY_ASSET_PAGES === "0" ? 0 : parsePositiveInteger(process.env.FACTORY_ASSET_PAGES, 4),
    // Engine the agent builds with: remotion (Remotion + its skills), hyperframes (HeyGen HTML+GSAP),
    // or auto (alternate between the two each film; needs both installed).
    heroEngine: ["remotion", "hyperframes", "auto"].includes(process.env.FACTORY_HERO_ENGINE) ? process.env.FACTORY_HERO_ENGINE : "remotion",
    // Skills/plugins the agent is told to use if installed in your local Claude Code (comma-separated slash names).
    heroSkills: String(process.env.FACTORY_HERO_SKILLS || "/remotion:remotion-best-practices,/hyperframes:motion-graphics").split(",").filter((x) => x.trim() !== "none").map((x) => x.trim()).filter(Boolean),
    handle: process.env.FACTORY_HANDLE || "@drix10",
    author: process.env.FACTORY_AUTHOR || "Drishtant Ghosh",
    // Chromium for Remotion renders; empty lets Remotion download its own headless shell.
    browserExecutable: process.env.REMOTION_BROWSER || "",
  },
  instagram: {
    // Nothing is shared unless IG_POST=true; otherwise uploads stop before the Share click.
    post: process.env.IG_POST === "true",
    dailyCap: parsePositiveInteger(process.env.IG_DAILY_CAP, 2),
    // Minimum gap between two published pieces.
    minGapMinutes: parsePositiveInteger(process.env.IG_MIN_GAP_MINUTES, 180),
  },
  monitoring: {
    targetListId: process.env.MONITOR_LIST_ID,
    checkInterval: parsePositiveInteger(process.env.CHECK_INTERVAL, 300000),
    rateLimitDelay: parsePositiveInteger(process.env.RATE_LIMIT_DELAY, 60000),
    sendAllTweets: process.env.SEND_ALL_TWEETS === "true" || false,
    keywords: process.env.MONITOR_KEYWORDS
      ? process.env.MONITOR_KEYWORDS.split(",").map((k) => k.trim())
      : [],
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
      lists: ["89224383"],
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
      lists: ["8020", "1049755751185403904", "1795545373173575917"],
    },
    {
      name: "AI Organizations and Media",
      lists: ["1741902685669113995"],
    },
    {
      name: "AI Powered Film and Media",
      // 1741902685669113995 belongs to "AI Organizations and Media" (its only list); sharing
      // it made two folders scrape the same posts.
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
      name: "AI Education",
      lists: ["1705702737835643273"],
    },
    {
      name: "AI in Enterprise Applications",
      lists: ["1705692999974637973"],
    },
    {
      name: "Interesting Finds",
      lists: ["1221942510081036293", "1814007176647847963"],
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
      lists: ["953244273901621248", "1714954513730425115", "1879078035921748205"],
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
