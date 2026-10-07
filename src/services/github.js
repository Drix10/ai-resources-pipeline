const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { logger, handleError, generateSeoSlug, rebuildBlogIndex, redactSecrets } = require("../utils/helpers");
const syndicationService = require("./syndication");

// Files are zero-padded to 3 digits but keep growing past 999
// (resources-1000.md), so match 3 or more digits.
const resourceNumber = (name) => {
  const m = String(name || "").match(/^resources-(\d{3,})\.md$/);
  return m ? parseInt(m[1], 10) : null;
};

class GithubService {
  constructor() {
    this.RATE_LIMIT_BUFFER = 100;
    this.MAX_RETRIES = 3;

    try {
      // Plain Octokit: @octokit/rest ships without the retry/throttling plugins,
      // so options for them were silently ignored. uploadMarkdownBatch retries
      // the commit itself.
      this.octokit = new Octokit({
        auth: config.github.personalAccessToken,
        timeZone: "UTC",
      });
      logger.info("GitHub client initialized successfully");
    } catch (error) {
      handleError(error, "Failed to initialize GitHub client");
      throw error;
    }
  }

  /**
   * Batches multiple folder markdown files into ONE consolidated GitHub commit using the Git Data API.
   * Eliminates commit flooding (e.g. groups 5-10 folders into 1 commit instead of 1 by 1).
   *
   * @param {Array<Object>} items - Array of { folder, fileBuffer, markdownContent, tweets, linkedinPosts, queryName }
   * @param {string} repoName - e.g. "Drix10/ai-resources"
   * @returns {Promise<Array<Object>>} - Array of { success, url, content, folder, number, sha, tweets, queryName }
   */
  async uploadMarkdownBatch(items, repoName = `${config.github.owner}/${config.github.repo}`, branch = "main") {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (typeof repoName !== "string" || !repoName.includes("/")) {
      throw new Error("Repository must use the owner/repository format");
    }
    const [owner, repo] = repoName.split("/");

    const rateLimit = await this.checkRateLimit();
    if (rateLimit.isLimited) {
      throw new Error(`Rate limit exceeded. Resets at ${rateLimit.resetTime}`);
    }

    await this.checkRepoAccess(owner, repo);

    // 1. Prepare file numbers, paths, and content strings for every item in the batch
    const folderNumberMap = new Map();
    const preparedItems = [];

    for (const item of items) {
      const folderObj = item.folder || { name: item.queryName };
      if (!folderObj || typeof folderObj.name !== "string" || !folderObj.name.trim()) {
        throw new Error("A valid destination folder is required for each batch item");
      }
      const decodedFolder = folderObj.name;
      const urlSafeFolder = encodeURIComponent(decodedFolder);

      let nextNumber;
      if (folderNumberMap.has(decodedFolder)) {
        nextNumber = folderNumberMap.get(decodedFolder) + 1;
      } else {
        nextNumber = await this.getNextFileNumber(owner, repo, decodedFolder, branch);
      }
      folderNumberMap.set(decodedFolder, nextNumber);

      const fileName = `resources-${String(nextNumber).padStart(3, "0")}.md`;
      const filePath = `${decodedFolder}/${fileName}`;
      const fileUrl = `https://github.com/${owner}/${repo}/blob/${branch}/${urlSafeFolder}/${fileName}`;
      // Last boundary before a public commit: redact again in case content came
      // from anywhere other than generateArticle.
      let content = redactSecrets(item.fileBuffer ? item.fileBuffer.toString("utf8") : String(item.markdownContent || ""));

      // Attach promotional section and exact SEO backlink (skip for personal & linkedin insights)
      const isSpecialFolder = decodedFolder.toLowerCase() === "personal" || decodedFolder.toLowerCase() === "linkedin insights";
      let seoSlug = null;
      if (!isSpecialFolder) {
        const categorySlug = decodedFolder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
        const fileBase = fileName.replace(".md", "");
        const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^###\s+(.+)$/m);
        const rawTitle = titleMatch ? titleMatch[1] : (`${decodedFolder} #${nextNumber}`);
        seoSlug = generateSeoSlug(rawTitle, content, fileName, decodedFolder);
        const blogArticleUrl = `${config.syndication.canonicalBaseUrl}/articles/${categorySlug}/${seoSlug}`;

        if (!content.includes("Read More & Connect") && !content.includes("Read on the AI Knowledge Hub")) {
          const promoSection = `

---

### Read More & Connect

**Interactive version:** [blogs.drix10.com](${blogArticleUrl})

Written by **[Drishtant Ghosh (Drix10)](https://drix10.com)**, a technical founder and engineer working across AI systems, developer infrastructure, and cybersecurity.

- **Blog:** [blogs.drix10.com](https://blogs.drix10.com)
- **Portfolio:** [drix10.com](https://drix10.com)
- **GitHub:** [github.com/Drix10](https://github.com/Drix10)
- **LinkedIn:** [linkedin.com/in/drix10](https://www.linkedin.com/in/drix10)
- **X:** [@DrishtantGhosh](https://x.com/DrishtantGhosh)
- **Email:** [ggdrishtant@gmail.com](mailto:ggdrishtant@gmail.com)
`;
          content = content.trimEnd() + promoSection;
        }
      }

      preparedItems.push({
        ...item,
        folder: folderObj,
        queryName: folderObj.name,
        decodedFolder,
        urlSafeFolder,
        nextNumber,
        fileName,
        filePath,
        fileUrl,
        content,
        seoSlug
      });
    }

    // 2. Commit all files in ONE single commit via GitHub Git Data API
    let newCommitSha = null;
    let commitError = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const branchRef = await this.octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const latestCommitSha = branchRef.data.object.sha;
        const commitData = await this.octokit.git.getCommit({ owner, repo, commit_sha: latestCommitSha });
        const baseTreeSha = commitData.data.tree.sha;

        const treeEntries = preparedItems.map(it => ({
          path: it.filePath,
          mode: "100644",
          type: "blob",
          content: it.content
        }));

        const newTree = await this.octokit.git.createTree({
          owner,
          repo,
          base_tree: baseTreeSha,
          tree: treeEntries
        });

        const commitMessage = preparedItems.length === 1
          ? `📝 Add resource collection: ${preparedItems[0].decodedFolder} #${preparedItems[0].nextNumber}`
          : `📝 Batch sync: ${preparedItems.length} resource collections\n\n` +
          preparedItems.map(it => `- ${it.decodedFolder} (#${it.nextNumber})`).join("\n");

        const authorInfo = {
          name: "Drix10",
          email: "ggdrishtant@gmail.com"
        };

        const newCommit = await this.octokit.git.createCommit({
          owner,
          repo,
          message: commitMessage,
          tree: newTree.data.sha,
          parents: [latestCommitSha],
          author: authorInfo,
          committer: authorInfo
        });

        await this.octokit.git.updateRef({
          owner,
          repo,
          ref: `heads/${branch}`,
          sha: newCommit.data.sha
        });

        newCommitSha = newCommit.data.sha;
        logger.info(`Successfully pushed batched commit (${preparedItems.length} files) to ${owner}/${repo}: ${newCommitSha}`);
        break;
      } catch (err) {
        commitError = err;
        logger.warn(`Batch commit attempt ${attempt}/${this.MAX_RETRIES} failed: ${err.message}`);
        if (attempt < this.MAX_RETRIES) {
          await new Promise(res => setTimeout(res, 2000 * attempt));
        }
      }
    }

    if (!newCommitSha) {
      throw new Error(`Failed to commit batch to GitHub after ${this.MAX_RETRIES} attempts: ${commitError?.message}`);
    }

    // 3. Post-commit operations for each file (local blog copy & syndication)
    for (const item of preparedItems) {
      try {
        const localBlogContentDir = path.join(process.cwd(), "blog", "content", item.decodedFolder);
        if (!fs.existsSync(localBlogContentDir)) {
          fs.mkdirSync(localBlogContentDir, { recursive: true });
        }
        fs.writeFileSync(path.join(localBlogContentDir, item.fileName), item.content, "utf8");
      } catch (localErr) {
        logger.warn(`Local blog save warning (non-fatal): ${localErr.message}`);
      }
    }

    try {
      rebuildBlogIndex();
    } catch (idxErr) {
      logger.warn(`Blog index rebuild warning (non-fatal): ${idxErr.message}`);
    }

    // Syndicate sequentially in background; SyndicationService's queue paces requests and trips a breaker on 401/429
    (async () => {
      for (const item of preparedItems) {
        try {
          await syndicationService.syndicateMarkdownArticle({
            title: `${item.decodedFolder} #${item.nextNumber}`,
            markdown: item.content,
            tags: [item.decodedFolder.toLowerCase().replace(/[^a-z0-9]/g, "")],
            category: item.decodedFolder,
            relativePath: item.filePath,
            seoSlug: item.seoSlug,
          });
        } catch (err) {
          logger.warn(`Syndication error (non-fatal): ${err.message}`);
        }
      }
    })().catch((err) => {
      logger.warn(`Syndication batch runner error (non-fatal): ${err.message}`);
    });

    return preparedItems.map(it => ({
      success: true,
      message: "File uploaded successfully as part of batch commit",
      url: it.fileUrl,
      sha: newCommitSha,
      number: it.nextNumber,
      content: it.content,
      queryName: it.queryName,
      folder: it.folder,
      tweets: it.tweets || [],
      linkedinPosts: it.linkedinPosts || []
    }));
  }

  async getNextFileNumber(owner, repo, folder, branch = "main") {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner,
        repo,
        path: folder,
        ref: branch,
      });

      const numbers = data
        .map((file) => resourceNumber(file.name))
        .filter((n) => n !== null);

      // GitHub Contents API caps at 1000 entries. If we're at the limit the
      // folder may have more files than returned; fall back to the Git tree API
      // which returns all entries without pagination gaps.
      if (data.length >= 1000) {
        logger.warn(`getNextFileNumber: folder "${folder}" hit the 1000-entry Contents API cap, falling back to git tree.`);
        try {
          const branchData = await this.octokit.repos.getBranch({ owner, repo, branch });
          const treeSha = branchData.data.commit.commit.tree.sha;
          const tree = await this.octokit.git.getTree({ owner, repo, tree_sha: treeSha, recursive: "1" });
          const prefix = folder.replace(/\/?$/, "/");
          if (tree.data.truncated) {
            // Recursive tree was truncated; fetch just the folder's own subtree non-recursively.
            const folderEntry = (tree.data.tree || []).find(e => e.type === "tree" && (e.path === folder || e.path + "/" === prefix));
            if (folderEntry) {
              const subTree = await this.octokit.git.getTree({ owner, repo, tree_sha: folderEntry.sha });
              const subNumbers = (subTree.data.tree || [])
                .map(e => resourceNumber(e.path))
                .filter(n => n !== null);
              return subNumbers.length > 0 ? Math.max(...subNumbers) + 1 : 1;
            }
            // Folder entry was not in the partial recursive tree. Walk the path
            // components with non-recursive fetches to find the folder's tree SHA.
            const parts = folder.replace(/\/$/, "").split("/").filter(Boolean);
            let currentSha = treeSha;
            for (const part of parts) {
              const level = await this.octokit.git.getTree({ owner, repo, tree_sha: currentSha });
              const entry = (level.data.tree || []).find(e => e.type === "tree" && e.path === part);
              if (!entry) throw new Error(`folder component "${part}" not found in tree`);
              currentSha = entry.sha;
            }
            const subTree2 = await this.octokit.git.getTree({ owner, repo, tree_sha: currentSha });
            const subNumbers2 = (subTree2.data.tree || [])
              .map(e => resourceNumber(e.path))
              .filter(n => n !== null);
            return subNumbers2.length > 0 ? Math.max(...subNumbers2) + 1 : 1;
          } else {
            const treeNumbers = (tree.data.tree || [])
              .filter(e => e.path.startsWith(prefix))
              .map(e => resourceNumber(e.path.slice(prefix.length)))
              .filter(n => n !== null);
            return treeNumbers.length > 0 ? Math.max(...treeNumbers) + 1 : 1;
          }
        } catch (treeErr) {
          logger.warn(`getNextFileNumber: git tree fallback failed: ${treeErr.message}`);
        }
      }

      return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;
    } catch (error) {
      if (error.status === 404) {
        return 1;
      }
      throw error;
    }
  }

  async createOrUpdateFile(owner, repo, path, content, message) {
    try {
      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: message || `Update ${path}`,
        content,
        branch: "main",
      });
      return response;
    } catch (error) {
      logger.error("File creation/update failed:", {
        error: error.message,
        owner,
        repo,
        path,
      });
      throw error;
    }
  }

  async updateReadmeWithNewFile(owner, repo) {
    try {
      const path = "README.md";
      let existing;
      try {
        existing = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: "main",
        });
      } catch (error) {
        if (error.status !== 404) throw error;
        existing = null;
      }

      if (!existing) {
        logger.warn("README.md not found");
        return;
      }

      const headerContent = `
<p align="center">
  <img src="https://raw.githubusercontent.com/tandpfun/skill-icons/main/icons/Markdown-Dark.svg" width="80" alt="Drishtant Ghosh (Drix10) — AI Resources" />
</p>

<h1 align="center">Drishtant Ghosh (Drix10) — AI Resources</h1>

<p align="center">
  <strong>AI Systems Engineer • 1x Acquired Founder (ReeF) • Autonomous LLM Architect • Technical Writer</strong>
</p>

<p align="center">
  <em>Continuous technical curation by <a href="https://drix10.com">Drishtant Ghosh</a> — zero-slop engineering breakdowns across AI systems, distributed infrastructure, and cybersecurity.</em>
</p>

<p align="center">
  <a href="https://drix10.com"><img src="https://img.shields.io/badge/PORTFOLIO-DRIX10.COM-10b981?style=for-the-badge&logo=vercel&logoColor=white" alt="Drishtant Ghosh Portfolio" /></a>
  <a href="https://blogs.drix10.com"><img src="https://img.shields.io/badge/BLOG-BLOGS.DRIX10.COM-0077b5?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Drix10 Blogs" /></a>
  <img src="https://img.shields.io/github/last-commit/${owner}/${repo}?style=for-the-badge&color=5D6D7E&label=LAST_UPDATE" alt="Last Updated" />
  <a href="https://github.com/${owner}/${repo}"><img src="https://img.shields.io/github/stars/${owner}/${repo}?style=for-the-badge&color=yellow&label=STARS" alt="GitHub Stars" /></a>
</p>

<p align="center">
  <a href="https://x.com/DrishtantGhosh"><img src="https://img.shields.io/badge/FOLLOW_ON_𝕏-000000?style=for-the-badge&logo=x&logoColor=white" alt="Drishtant Ghosh on X" /></a>
  <a href="https://github.com/Drix10"><img src="https://img.shields.io/badge/FOLLOW_ON_GITHUB-181717?style=for-the-badge&logo=github&logoColor=white" alt="Drix10 on GitHub" /></a>
  <a href="https://www.linkedin.com/in/drix10"><img src="https://img.shields.io/badge/CONNECT_ON_LINKEDIN-0077b5?style=for-the-badge&logo=linkedin&logoColor=white" alt="Drishtant Ghosh on LinkedIn" /></a>
  <a href="https://peerlist.io/drix10"><img src="https://img.shields.io/badge/PEERLIST-DRIX10-00AA45?style=for-the-badge&logo=peerlist&logoColor=white" alt="Drix10 on Peerlist" /></a>
</p>

---

## 👤 About Drishtant Ghosh (Drix10)

**Drishtant Ghosh** — known online as **Drix10** — is an AI Systems Engineer and 1x Acquired Founder based in **Bengaluru, India**. He builds autonomous LLM architectures, multi-agent swarms, real-time distributed systems, and high-performance full-stack products.

- **1x Acquired Founder** — ReeF (scaled to $15,000 ARR and 5M+ user interactions before acquisition in August 2024)
- **Founder & CEO** — CosLynx.com (AI code-generation platform, 400+ live MVPs, Build with Backdrop v4 Winner)
- **AI Systems Architect** — Canopy @ Founders, Inc. (4-LLM autonomous multi-agent trading engine)
- **Cybersecurity Student** — Dayananda Sagar University
- **2x International Hackathon Winner** • **IBM AI Engineering Professional Certificate**

> This repository is the public knowledge base behind that work: a continuously updated, high-signal archive of AI systems, developer infrastructure, and security engineering breakdowns — no motivational fluff, no consultant larp, just mechanics and code reality.

**Connect:** [Portfolio](https://drix10.com) • [Blog](https://blogs.drix10.com) • [GitHub](https://github.com/Drix10) • [LinkedIn](https://www.linkedin.com/in/drix10) • [X / Twitter](https://x.com/DrishtantGhosh) • [Peerlist](https://peerlist.io/drix10) • [DEV.to](https://dev.to/drix10) • [Medium](https://medium.com/@drix10)

---

## 📦 What's Inside This Repository

This is not a link dump. It is a **continuously regenerated technical archive** — an autonomous pipeline scrapes curated X/Twitter lists, LinkedIn insights, and systems research, then distills each signal into a structured, publish-ready markdown article.

| Layer | What It Contains |
| --- | --- |
| **🗂️ 41 Curated Categories** | AI Developer Tools, AI Leaders & Thinkers, AI Companies & Ventures, CS Academics, Tech VIPs, VC Firms, Devs/Designers/DevRel, Tech Infrastructure, Founders & Entrepreneurs, AI Organizations & Media, AI in Healthcare & Science, AI Generated Music & Audio, AI Policy & Ethics, AI & Robotics, AI Driven Vehicles, Computer Vision, Crypto & Web3, Decentralized AI, Quantum Computing, Spatial Computing, Cybersecurity & Tech, Neuroscience & AI, Climate Tech, AR/VR, and more. |
| **📝 Scraped & Synthesized Articles** | Every \`resources-NNN.md\` file is generated from real X/Twitter list content and LinkedIn insights — deduplicated, ranked, and rewritten into dense technical breakdowns with concrete mechanics instead of hype. |
| **🧠 LinkedIn Insights** | Long-form postmortems and engineering reflections (payment webhook failures, vector search tuning, struct padding, AST vs regex scanning, concurrency races) captured as standalone markdown. |
| **✍️ Personal Essays** | Founder-journey and systems-thinking pieces — building autonomous AI systems, scaling and selling a startup, the memory-first mental model, and the signal-to-noise problem in AI resources. |
| **🔗 Multi-Channel Syndication** | Every article is cross-published to [blogs.drix10.com](https://blogs.drix10.com) and [DEV.to](https://dev.to/drix10), each with a canonical SEO backlink and a Next.js 14 interactive version. |
| **⚙️ Zero-Slop Quality Gates** | Deterministic validation rejects any model output that lacks a real article, strips credentials/secrets, and bans motivational fluff and consultant larp before anything is committed. |

### 🔄 How It Works

\`\`\`mermaid
flowchart LR
    A["X/Twitter Curated Lists (41 categories)"] --> D["Autonomous Curation Engine"]
    B["LinkedIn Insights & Postmortems"] --> D
    C["Systems Research & Repo Pulse"] --> D
    D --> E["LLM Synthesis (Ollama / NVIDIA NIM)"]
    E --> F["Zero-Slop Quality Gate + Secret Redaction"]
    F --> G["resources-NNN.md committed to this repo"]
    G --> H["blogs.drix10.com (Next.js 14)"]
    G --> I["DEV.to Syndication"]
\`\`\`

---

## 📚 Resource Categories

`;

      let updatesContent = "";

      // GitHub's contents API is rate-limited. A small bounded pool is faster
      // than sequential calls without turning one README refresh into a burst.
      const folderResults = await this.mapWithConcurrency(config.folders, 4, async (folder) => {
        const decodedFolder = folder.name;
        try {
          // ponytail: fixed 250ms courtesy delay; was random 0-2s x41 folders (~1min/run) for reads GitHub happily serves concurrently.
          await new Promise(resolve => setTimeout(resolve, 250));

          const { data } = await this.octokit.repos.getContent({
            owner,
            repo,
            path: decodedFolder,
          });

          const files = data
            .filter((file) => resourceNumber(file.name) !== null)
            .map((file) => ({
              number: resourceNumber(file.name),
              url: `https://github.com/${owner}/${repo}/blob/main/${encodeURIComponent(
                decodedFolder
              )}/${file.name}`,
            }))
            .sort((a, b) => b.number - a.number);

          let sectionContent = `### ${folder.name}\n\n`;

          if (files.length > 0) {
            sectionContent += `*   [Latest Update (#${String(
              files[0].number
            ).padStart(3, "0")})](${files[0].url}) - *${folder.description || "Resources related to " + folder.name
              }*\n`;
          } else {
            sectionContent += `*   No resources yet.\n`;
          }
          sectionContent += "\n";
          return { name: folder.name, content: sectionContent };
        } catch (error) {
          let sectionContent = `### ${folder.name}\n\n`;
          if (error.status === 404) {
            sectionContent += `*   No resources yet.\n\n`;
          } else {
            logger.error(`Error getting content for ${decodedFolder}:`, error);
            sectionContent += `*   Error loading resources.\n\n`;
          }
          return { name: folder.name, content: sectionContent };
        }
      });

      // Sort results to maintain order from config
      const orderedContent = config.folders.map(folder =>
        folderResults.find(r => r.name === folder.name)?.content || ""
      ).join("");

      updatesContent += orderedContent;

      const newContent = headerContent + updatesContent;

      await this.createOrUpdateReadme(owner, repo, newContent);
    } catch (error) {
      logger.error("Failed to update README:", error);
    }
  }

  async checkRepoAccess(owner, repo) {
    try {
      if (!owner || !repo) {
        throw new Error("Owner and repository name are required");
      }

      const { data } = await this.octokit.repos.get({ owner, repo });

      if (data.archived) {
        throw new Error(`Repository ${owner}/${repo} is archived`);
      }
      if (data.disabled) {
        throw new Error(`Repository ${owner}/${repo} is disabled`);
      }
      if (!data.permissions?.push) {
        throw new Error(`No write access to repository ${owner}/${repo}`);
      }

      return data;
    } catch (error) {
      if (error.status === 404) {
        throw new Error(`Repository ${owner}/${repo} not found`);
      }
      if (error.status === 403) {
        throw new Error(`No access to repository ${owner}/${repo}`);
      }
      throw error;
    }
  }

  async checkRateLimit() {
    try {
      const { data } = await this.octokit.rateLimit.get();
      const { remaining, reset, used, limit } = data.rate;

      return {
        remaining,
        resetTime: new Date(reset * 1000),
        isLimited: remaining < this.RATE_LIMIT_BUFFER,
        used,
        limit,
      };
    } catch (error) {
      handleError(error, "Failed to check rate limit");
      return {
        remaining: 0,
        resetTime: new Date(Date.now() + 3600000),
        isLimited: true,
        used: 0,
        limit: 0,
      };
    }
  }

  async createOrUpdateReadme(owner, repo, content) {
    try {
      const path = "README.md";
      const branch = "main";

      let existingSha = null;
      let existingContent = null;
      try {
        const existing = await this.octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        existingSha = existing.data.sha;
        existingContent = Buffer.from(existing.data.content || "", "base64").toString("utf8");
      } catch (error) {
        if (error.status !== 404) {
          throw error;
        }
        logger.info("README.md not found, creating a new one.");
      }

      if (existingContent === content) {
        logger.info("README is already current; skipping redundant commit.");
        return {
          success: true,
          skipped: true,
          url: `https://github.com/${owner}/${repo}/blob/main/${path}`,
          sha: existingSha,
        };
      }

      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: "📚 Update README with latest tweets",
        content: Buffer.from(content).toString("base64"),
        sha: existingSha,
        branch,
        committer: {
          name: "Drix10",
          email: "ggdrishtant@gmail.com",
        },
      });

      logger.info("README updated successfully");

      return {
        success: true,
        url: `https://github.com/${owner}/${repo}/blob/main/README.md`,
        sha: response.data.content.sha,
      };
    } catch (error) {
      handleError(error, "Failed to update README");
      return {
        success: false,
        message: "Failed to update README",
        error: error.message,
      };
    }
  }

  async mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(1, limit), items.length);

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await worker(items[index], index);
      }
    }));

    return results;
  }
}

module.exports = new GithubService();
