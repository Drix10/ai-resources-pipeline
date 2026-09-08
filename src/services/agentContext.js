const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const config = require("../../config");
const { logger } = require("../utils/helpers");

class AgentContextService {
  constructor() {
    this.profilePath = path.join(process.cwd(), "data", "builder-profile.json");
    this.cachePath = path.join(process.cwd(), "data", "github-pulse-cache.json");
    this.historyPath = path.join(process.cwd(), "data", "recent-agent-history.json");
  }

  ensureDataDir() {
    const dataDir = path.join(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (err) {
        logger.warn(`AgentContextService: Failed to create data dir: ${err.message}`);
      }
    }
  }

  /**
   * Atomic and safe JSON write: writes to temporary file then renames to avoid
   * half-written or corrupted files during concurrent process execution or crash.
   */
  safeWriteJson(filePath, data) {
    try {
      this.ensureDataDir();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tempPath = `${filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), "utf8");
      try {
        fs.renameSync(tempPath, filePath);
      } catch {
        // Fallback for Windows file lock / cross-device rename
        fs.copyFileSync(tempPath, filePath);
        try { fs.unlinkSync(tempPath); } catch {}
      }
      return true;
    } catch (err) {
      logger.warn(`AgentContextService: Failed to safe-write ${path.basename(filePath)}: ${err.message}`);
      return false;
    }
  }

  /**
   * Safe JSON reader with fallback to avoid throwing uncaught SyntaxError if a file is malformed.
   */
  safeReadJson(filePath, fallback = null) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
      }
    } catch (err) {
      logger.warn(`AgentContextService: Failed to safe-read ${path.basename(filePath)}: ${err.message}`);
    }
    return fallback;
  }

  /**
   * Reads local git commit history and diff stats from current working repo.
   */
  getLocalGitPulse(limit = 6) {
    try {
      const gitLogCmd = `git log -n ${limit} --pretty=format:"%h|%s|%cr"`;
      const rawLog = execSync(gitLogCmd, { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (!rawLog) return { recentCommits: [], touchedSummary: "" };

      const commits = rawLog.split("\n").map(line => {
        const [hash, message, relativeTime] = line.split("|");
        return { hash, message, relativeTime };
      }).filter(c => c.message && !c.message.startsWith("Merge"));

      let touchedSummary = "";
      try {
        touchedSummary = execSync("git diff --stat HEAD~2 HEAD", { encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).trim();
      } catch {
        // shallow clone diff fallback
      }

      return {
        recentCommits: commits,
        touchedSummary: touchedSummary.slice(0, 500)
      };
    } catch (err) {
      logger.warn(`AgentContextService: Failed to retrieve local git pulse: ${err.message}`);
      return { recentCommits: [], touchedSummary: "" };
    }
  }

  /**
   * Fetches real live commit activity across all active repositories of the authenticated user
   * using the configured GitHub PAT. Caches with a 2-hour TTL to respect rate limits.
   */
  async getMultiRepoGitPulse(forceRefresh = false) {
    // 1. Check cache first
    if (!forceRefresh) {
      const cached = this.safeReadJson(this.cachePath, null);
      if (cached && typeof cached.timestamp === "number") {
        const ageMs = Date.now() - cached.timestamp;
        if (ageMs < 2 * 60 * 60 * 1000 && Array.isArray(cached.repos) && cached.repos.length > 0) {
          logger.info("AgentContextService: Using cached multi-repo GitHub pulse.");
          return cached;
        }
      }
    }

    // 2. Fetch fresh data from GitHub API
    try {
      const githubService = require("./github");
      const octokit = githubService.octokit;
      const username = config.github.owner || "Drix10";

      logger.info(`AgentContextService: Fetching live multi-repo activity for GitHub user "${username}"...`);

      // Fetch recently updated repositories for the user
      const reposRes = await octokit.repos.listForUser({
        username,
        sort: "updated",
        per_page: 30
      });

      const priorityRepoNames = [
        "Grind",
        "payscope",
        "sentinal",
        "hypothesis-arena",
        "intent-canvas",
        "instagram-ai",
        "YourResume",
        "ai-resources",
        "Twitter-Gemini-GitHub-MVP"
      ];
      const activeRepos = (reposRes.data || []).filter(r => !r.fork && r.name !== username);

      // Prioritize core builder repos first so they are never omitted
      activeRepos.sort((a, b) => {
        const aIdx = priorityRepoNames.indexOf(a.name);
        const bIdx = priorityRepoNames.indexOf(b.name);
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        if (aIdx !== -1) return -1;
        if (bIdx !== -1) return 1;
        return 0;
      });

      const repoDetails = [];
      let totalFreshCommitsCount = 0;
      const now = Date.now();
      const twoDaysMs = 48 * 60 * 60 * 1000;
      const interestingKeywords = /\b(fix|refactor|perf|leak|timeout|optimize|memory|race|solve|crash|break|pointer|alloc|ast|sarif|stream|queue|buffer|sync)\b/i;

      for (const repo of activeRepos.slice(0, 10)) {
        try {
          const commitsRes = await octokit.repos.listCommits({
            owner: username,
            repo: repo.name,
            per_page: 25
          });

          const allCommits = (commitsRes.data || []).map(c => ({
            sha: c.sha ? c.sha.slice(0, 7) : "",
            message: (c.commit?.message || "").split("\n")[0].trim(),
            date: c.commit?.author?.date || ""
          })).filter(c => c.message && !c.message.startsWith("Merge"));

          const freshCommits = allCommits.filter(c => {
            if (!c.date) return false;
            return (now - new Date(c.date).getTime()) < twoDaysMs;
          });
          totalFreshCommitsCount += freshCommits.length;

          // Dig deep into historical commits for past architectural solved problems/bugs
          const historicalHighlights = allCommits
            .filter(c => interestingKeywords.test(c.message))
            .slice(0, 5);

          repoDetails.push({
            name: repo.name,
            fullName: repo.full_name,
            description: repo.description || "",
            language: repo.language || "Multi-language",
            stars: repo.stargazers_count || 0,
            updatedAt: repo.updated_at,
            recentCommits: freshCommits.length > 0 ? freshCommits.slice(0, 5) : allCommits.slice(0, 5),
            historicalHighlights,
            hasFreshCommits: freshCommits.length > 0
          });
        } catch (commitErr) {
          logger.warn(`AgentContextService: Failed to fetch commits for ${repo.name}: ${commitErr.message}`);
        }
      }

      const cachePayload = {
        timestamp: Date.now(),
        user: username,
        repos: repoDetails,
        sparseFreshCommits: totalFreshCommitsCount < 2
      };

      this.safeWriteJson(this.cachePath, cachePayload);
      return cachePayload;
    } catch (apiErr) {
      logger.warn(`AgentContextService: Failed to fetch live GitHub pulse: ${apiErr.message}`);
      const fallback = this.safeReadJson(this.cachePath, { timestamp: Date.now(), user: "Drix10", repos: [] });
      return fallback;
    }
  }

  /**
   * Loads the builder's persistent profile, projects, milestones, failures, and beliefs.
   */
  getBuilderProfile() {
    const defaultProfile = {
      builder: {
        name: "Drishtant Ghosh",
        handle: "Drix10",
        title: "Full-Stack AI Engineer",
        location: "Bengaluru, Karnataka, India",
        blogUrl: "https://blogs.drix10.com",
        githubUrl: "https://github.com/Drix10",
        linkedinUrl: "https://www.linkedin.com/in/drix10/"
      },
      education: [],
      certifications: [],
      experience: [],
      verifiedProjects: [],
      strictToneRules: {}
    };

    return this.safeReadJson(this.profilePath, defaultProfile);
  }

  /**
   * Loads recent post history to guarantee context and type diversity.
   */
  getRecentHistory() {
    return this.safeReadJson(this.historyPath, []);
  }

  /**
   * Records a published post to maintain diversity across consecutive runs.
   */
  recordPost(record) {
    const lockPath = `${this.historyPath}.lock`;
    let lockFd = null;
    try {
      // Acquire interprocess file lock with retry loop (up to 3 seconds)
      const startTime = Date.now();
      while (!lockFd && Date.now() - startTime < 3000) {
        try {
          lockFd = fs.openSync(lockPath, "wx");
        } catch (e) {
          if (e.code === "EEXIST") {
            try {
              const stat = fs.statSync(lockPath);
              if (Date.now() - stat.mtimeMs > 5000) {
                fs.unlinkSync(lockPath);
              }
            } catch {}
            const delay = Math.floor(Math.random() * 50) + 20;
            const waitUntil = Date.now() + delay;
            while (Date.now() < waitUntil) {}
          } else {
            break;
          }
        }
      }

      const history = this.getRecentHistory();
      const updated = [
        {
          ...record,
          timestamp: new Date().toISOString()
        },
        ...history.filter(h => h && h.topicTitle !== record.topicTitle)
      ].slice(0, 12);
      this.safeWriteJson(this.historyPath, updated);
    } catch (err) {
      logger.warn(`AgentContextService: Failed to record post history: ${err.message}`);
    } finally {
      if (lockFd !== null) {
        try { fs.closeSync(lockFd); } catch {}
        try { fs.unlinkSync(lockPath); } catch {}
      }
    }
  }

  /**
   * Concrete Engineering Archetypes Grounded in Real Experience:
   * Every archetype focuses on a real tool, concrete mechanism, or architectural lesson
   * directly from Drishtant's projects.
   */
  getPostTypes() {
    return [
      {
        id: "fintech-webhook-signatures",
        label: "Payment Webhooks & Raw Body Signatures (Drix10/intent-canvas)",
        targetAudience: "Full-stack developers, SaaS founders, backend engineers",
        focus: "Why payment webhooks (like Dodo Payments) silently fail HMAC signature verification when express.json() middleware parses the body before hashing. Explain how to capture the immutable binary Buffer via express.json({ verify: (req, res, buf) => req.rawBody = buf }), verify HMAC using crypto.createHmac and crypto.timingSafeEqual, and only then pass req.body into Zod schema validation.",
        primaryRepo: "intent-canvas"
      },
      {
        id: "multi-agent-crypto-trading",
        label: "Multi-Agent Systems & Orderbook Feeds (Canopy / Drix10/hypothesis-arena)",
        targetAudience: "AI systems engineers, quant developers, agent builders",
        focus: "Architecting 4 autonomous LLM agents debating WEEX crypto futures. Managing streaming WebSocket orderbook feeds without thread starvation, using Prisma ORM with LibSQL/Turso DB for sub-millisecond persistence.",
        primaryRepo: "hypothesis-arena"
      },
      {
        id: "appsec-ast-parsing",
        label: "AST Node Traversal vs Dumb Regex (Drix10/sentinal)",
        targetAudience: "Application security engineers, CLI developers, TypeScript devs",
        focus: "Why regex-based code scanners spam false positives. How parsing the Abstract Syntax Tree (AST) with Gemini AI maps real taint flow from user input to sinks, producing zero-noise vulnerability patches.",
        primaryRepo: "sentinal"
      },
      {
        id: "c-memory-alignment",
        label: "Struct Padding & 64-Byte Cache Lines (Drix10/Grind)",
        targetAudience: "C/C++ developers, systems programmers, low-level engineers",
        focus: "Why memorizing LeetCode graph tricks is useless if you don't understand raw memory in C. How careless struct member ordering turns a 16-byte payload into 32 bytes due to word alignment, doubling L1 cache line misses.",
        primaryRepo: "Grind"
      },
      {
        id: "realtime-websocket-architecture",
        label: "WebSockets & Redis Pub/Sub at Scale (Drix10/idolchat)",
        targetAudience: "Mobile & full-stack developers, React Native devs",
        focus: "Building real-time AI character chat in React Native/Expo. Handling mobile WebSocket disconnects, connection heartbeats, and Redis pub/sub state synchronization without dropping chat history in Prisma.",
        primaryRepo: "idolchat"
      },
      {
        id: "llm-code-orchestration",
        label: "LLM Code Orchestration for 400+ MVPs (CosLynx.com)",
        targetAudience: "AI product builders, full-stack engineers, startup founders",
        focus: "Lessons from shipping 400+ MVPs via CosLynx. How to structure TypeScript and Node.js multi-step LLM code generation pipelines so models don't hallucinate non-existent npm dependencies.",
        primaryRepo: "CosLynx"
      },
      {
        id: "practical-ml-inference-bounds",
        label: "Local Inference Latency & Memory Bounds (Drix10/ai-resources)",
        targetAudience: "AI engineers, ML infra practitioners",
        focus: "Concrete benchmarks when running local models (Ollama/NVIDIA NIM). Quantization trade-offs (4-bit vs 8-bit), KV cache memory limits, and why context window growth explodes GPU VRAM.",
        primaryRepo: "ai-resources"
      }
    ];
  }

  /**
   * Compiles the comprehensive all-source context snapshot.
   */
  async compileContextSnapshot(curatedArticles = []) {
    const localPulse = this.getLocalGitPulse();
    const multiRepoPulse = await this.getMultiRepoGitPulse();
    const profile = this.getBuilderProfile();
    const postTypes = this.getPostTypes();
    const recentHistory = this.getRecentHistory();

    return {
      builder: profile.builder,
      education: profile.education || [],
      certifications: profile.certifications || [],
      technicalSkills: profile.technicalSkills || {},
      experience: profile.experience || [],
      verifiedProjects: profile.verifiedProjects || [],
      strictToneRules: profile.strictToneRules || {},
      localPulse,
      multiRepoPulse,
      postTypes,
      recentHistory,
      curatedArticles: (curatedArticles || []).slice(0, 5).map(a => ({
        title: a.title,
        githubUrl: a.githubUrl,
        snippet: (a.fullContent || "").slice(0, 800)
      }))
    };
  }
}

module.exports = new AgentContextService();
