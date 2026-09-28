const fs = require("fs");
const path = require("path");
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

      const activeRepos = (reposRes.data || []).filter(r => !r.fork && r.name !== username);

      // ponytail: keep API sort:updated order. A priority re-sort here used to
      // bury the actually-active repos (ml-videos, ai-resources) under stale ones.
      // Union archetype repos that fall outside the per_page window so the pulse covers them.
      const extraRepos = [
        { owner: username, name: "idolchat" }
      ];
      const seen = new Set(activeRepos.map(r => `${r.owner?.login}/${r.name}`.toLowerCase()));
      for (const e of extraRepos) {
        if (seen.has(`${e.owner}/${e.name}`.toLowerCase())) continue;
        try {
          const { data } = await octokit.repos.get({ owner: e.owner, repo: e.name });
          if (!data.fork) activeRepos.push(data);
        } catch {
          // 404/private/renamed: skip, archetypes referencing it stay uncovered (see diagnosis).
        }
      }

      // Most-recently-updated first so the LLM sees live activity, not stale picks.
      activeRepos.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

      const repoDetails = [];
      let totalFreshCommitsCount = 0;
      const now = Date.now();
      const twoDaysMs = 48 * 60 * 60 * 1000;
      const interestingKeywords = /\b(fix|refactor|perf|leak|timeout|optimize|memory|race|solve|crash|break|pointer|alloc|ast|sarif|stream|queue|buffer|sync)\b/i;

      for (const repo of activeRepos.slice(0, 12)) {
        try {
          const commitsRes = await octokit.repos.listCommits({
            owner: (repo.owner && repo.owner.login) || username,
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
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
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
      ].slice(0, 30);
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
   * Compiles the comprehensive all-source context snapshot.
   */
  async compileContextSnapshot(curatedArticles = []) {
    const multiRepoPulse = await this.getMultiRepoGitPulse();
    const profile = this.getBuilderProfile();
    const recentHistory = this.getRecentHistory();

    return {
      builder: profile.builder,
      education: profile.education || [],
      certifications: profile.certifications || [],
      technicalSkills: profile.technicalSkills || {},
      experience: profile.experience || [],
      verifiedProjects: profile.verifiedProjects || [],
      strictToneRules: profile.strictToneRules || {},
      multiRepoPulse,
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
