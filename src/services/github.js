const { Octokit } = require("@octokit/rest");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { logger, handleError, generateSeoSlug, digestLead, rebuildBlogIndex, redactSecrets, blogDir } = require("../utils/helpers");
const syndicationService = require("./syndication");

// Files are zero-padded to 3 digits but keep growing past 999
// (resources-1000.md), so match 3 or more digits.
const resourceNumber = (name) => {
  const m = String(name || "").match(/^resources-(\d{3,})\.md$/);
  return m ? parseInt(m[1], 10) : null;
};

// Commits on the resources repo carry the author's handle (else name) and email; with either
// missing, GitHub attributes them to the token's account.
const commitIdentity = () => {
  const name = config.author.handle || config.author.name;
  return name && config.author.email ? { name, email: config.author.email } : null;
};

// The co-author trailer every commit of a run carries ("Name <email>" from GITHUB_CO_AUTHOR), or "".
const coAuthorTrailer = () => (config.github.coAuthor ? `\n\nCo-authored-by: ${config.github.coAuthor}` : "");

// A run's commits go to the branch of its day ("run/2026-10-29"), merged into main by a pull request at the end.
const RUN_BRANCH_PREFIX = "run/";
const runBranchName = (now = new Date()) => `${RUN_BRANCH_PREFIX}${now.toLocaleDateString("en-CA")}`;

// The pipeline owns only the category list under this README heading; everything above it (title,
// about, badges) is the repository owner's own text and is kept as it is.
const README_CATEGORIES_HEADING = "## 📚 Resource Categories";

// How many of the newest digest headlines each category shows in the README.
const README_HEADLINES_PER_CATEGORY = 3;

// The digest headlines ("### 🤖 Title") of one resources file, without the leading emoji, in file order.
const digestHeadlines = (markdown, max = README_HEADLINES_PER_CATEGORY) =>
  String(markdown || "")
    .split("\n")
    .filter((line) => line.startsWith("### "))
    .map((line) => line.slice(4).replace(/^[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\uFE0F\u200D\u20E3\s]+/u, "").replace(/\s+/g, " ").trim())
    .filter((h) => h && h !== "Read More & Connect")
    .slice(0, max);

// The blog's page for a category (same slug rule as the blog index), or null without a blog address.
const blogCategoryUrl = (name) => {
  const base = config.syndication?.canonicalBaseUrl;
  if (!base) return null;
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base}/categories/${slug}`;
};

// One category's README section: its newest digest, the newest headlines in it and the digest count.
const renderCategorySection = (folder, files, headlines = []) => {
  let out = `### ${folder.name}\n\n`;
  if (!files.length) return `${out}*   No resources yet.\n\n`;
  const latest = files[0];
  const number = String(latest.number).padStart(3, "0");
  const about = folder.description ? `${folder.description} · ` : "";
  const blog = blogCategoryUrl(folder.name);
  out += `<sub>${about}${files.length} digests · [latest: #${number}](${latest.url})${blog ? ` · [read on the blog](${blog})` : ""}</sub>\n\n`;
  if (headlines.length) out += headlines.map((h) => `*   ${h.replace(/[[\]]/g, "").replace(/</g, "&lt;")}`).join("\n") + "\n";
  else out += `*   [Latest Update (#${number})](${latest.url})\n`;
  return `${out}\n`;
};

// GitHub's heading anchor: lowercase, punctuation dropped, spaces to hyphens ("Devs, Designers, DevRel" -> "devs-designers-devrel").
const headingAnchor = (name) => String(name).toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");

// The line under the categories heading: the live digest total and a jump link to every category.
const renderCategoryIndex = (sections) => {
  const total = sections.reduce((sum, s) => sum + (s.count || 0), 0);
  const links = sections.map((s) => `[${s.name}](#${headingAnchor(s.name)})`).join(" · ");
  return `**${total.toLocaleString("en-US")} digests in ${sections.length} categories.** Each category shows its newest headlines; jump to one:\n\n<sub>${links}</sub>\n\n`;
};

// The pipeline's own repository (package.json), linked from the footer as the place the digests come from.
const pipelineRepoUrl = String(require("../../package.json").repository?.url || "").replace(/^git\+/, "").replace(/\.git$/, "");

// Kept under the regenerated category list on every run (the list replaces everything below the heading).
const readmeFooter = (owner, repo) => {
  const home = `https://github.com/${owner}/${repo}`;
  const by = config.author?.name ? ` © ${config.author.name}` : "";
  const blog = config.syndication?.canonicalBaseUrl;
  const more = [
    blog && `[Read on the blog](${blog})`,
    blog && `[RSS feed](${blog}/rss.xml)`,
    pipelineRepoUrl && `[How it is built](${pipelineRepoUrl})`,
  ].filter(Boolean);
  return [
    "---",
    "",
    "<div align=\"center\">",
    "",
    `**Found something useful?** ⭐ [Star the repo](${home}) to keep it handy and help others find it, or [suggest a source](${home}/issues/new/choose).`,
    "",
    ...(more.length ? [more.join(" · "), ""] : []),
    `<sub>Summaries${by}, licensed [CC BY 4.0](LICENSE). Every digest links to its original post where one exists; the posts and linked pages belong to their authors.</sub>`,
    "",
    "</div>",
    "",
  ].join("\n");
};

// The "Read More & Connect" footer of a committed article: the blog link, the byline and the
// author's links (config.author), each line only when its value is set. Null when there is nothing to add.
const articleFooter = (blogArticleUrl) => {
  const { byline, bio, websiteUrl, links } = config.author;
  const lines = [];
  if (blogArticleUrl) lines.push(`**Interactive version:** [${new URL(blogArticleUrl).host}](${blogArticleUrl})`);
  if (byline) lines.push(`Written by **${websiteUrl ? `[${byline}](${websiteUrl})` : byline}**${bio ? `, ${bio}` : ""}.`);
  if (links.length) lines.push(links.map((l) => `- **${l.label}:** [${l.text}](${l.url})`).join("\n"));
  return lines.length ? `\n\n---\n\n### Read More & Connect\n\n${lines.join("\n\n")}\n` : null;
};

// The git blob id GitHub gives a file with this content.
const blobSha = (content) => {
  const body = Buffer.from(String(content), "utf8");
  return crypto.createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
};

class GithubService {
  constructor() {
    this.RATE_LIMIT_BUFFER = 100;
    this.MAX_RETRIES = 3;
    this.RETRY_DELAY_MS = 2000; // times the attempt number

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
   * @param {Array<Object>} items - Array of { folder, fileBuffer, markdownContent, tweets, queryName }
   * @param {string} repoName - "owner/repo"
   * @param {Object} [options]
   * @param {Array<Object>} [options.prepared] - error.prepared of an earlier failed call: its numbered paths
   *   are reused (numbering again would add an attempt that did land a second time, as resources-N+1)
   * @param {Function} [options.onCommitted] - called with the committed items as soon as the branch holds them
   * @returns {Promise<Array<Object>>} - Array of { success, url, content, folder, number, sha, tweets, queryName }
   */
  async uploadMarkdownBatch(items, repoName = `${config.github.owner}/${config.github.repo}`, { branch = null, prepared = null, onCommitted = null } = {}) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    if (typeof repoName !== "string" || !repoName.includes("/")) {
      throw new Error("Repository must use the owner/repository format");
    }
    const [owner, repo] = repoName.split("/");
    branch = branch || await this.workBranch(owner, repo);

    const rateLimit = await this.checkRateLimit();
    if (rateLimit.isLimited) {
      throw new Error(`Rate limit exceeded. Resets at ${rateLimit.resetTime}`);
    }

    await this.checkRepoAccess(owner, repo);

    // 1. Prepare file numbers, paths, and content strings for every item in the batch
    const reused = Array.isArray(prepared) && prepared.length > 0;
    const preparedItems = reused ? prepared : await this.prepareBatch(items, owner, repo, branch);

    // 2. Commit all files in ONE single commit via GitHub Git Data API
    let newCommitSha = null;
    let commitError = null;

    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const branchRef = await this.octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
        const latestCommitSha = branchRef.data.object.sha;
        // An attempt that reported an error may still have landed (a timeout after GitHub applied the
        // ref update): then the branch already holds these files and a new commit would add them twice.
        if ((attempt > 1 || reused) && (await this.batchOnBranch(owner, repo, latestCommitSha, preparedItems))) {
          newCommitSha = latestCommitSha;
          logger.info(`Batch (${preparedItems.length} files) is already on ${owner}/${repo}@${branch}; not committing it again.`);
          break;
        }
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
        const fullMessage = commitMessage + coAuthorTrailer();

        const authorInfo = commitIdentity();

        const newCommit = await this.octokit.git.createCommit({
          owner,
          repo,
          message: fullMessage,
          tree: newTree.data.sha,
          parents: [latestCommitSha],
          ...(authorInfo ? { author: authorInfo, committer: authorInfo } : {})
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
        if (err.code === "BATCH_PATH_TAKEN") break; // a retry cannot free the path
        if (attempt < this.MAX_RETRIES) {
          await new Promise(res => setTimeout(res, this.RETRY_DELAY_MS * attempt));
        }
      }
    }

    if (!newCommitSha) {
      const error = new Error(`Failed to commit batch to GitHub: ${commitError?.message}`);
      // A retry passes these back: the same paths are checked on the branch first, then reused.
      error.prepared = preparedItems;
      throw error;
    }

    // The sources are consumed the moment the branch holds the files: before the local copies, the
    // DEV.to queue or any post, so a crash in between cannot leave them to be curated again.
    if (onCommitted) {
      try {
        await onCommitted(preparedItems);
      } catch (err) {
        logger.error(`Marking the committed batch failed: ${err.message}`);
      }
    }

    // 3. Post-commit operations for each file (local blog copy & syndication)
    for (const item of preparedItems) {
      try {
        const localBlogContentDir = path.join(blogDir(), "content", item.decodedFolder);
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

    // DEV.to is only queued here: the canonical blog page does not exist until the blog is
    // pushed and deployed. syndicationService.processQueue() posts once that URL is live.
    for (const item of preparedItems) {
      try {
        // The lead item's headline and summary are the search title and snippet, as on the blog page.
        const lead = digestLead(item.content);
        await syndicationService.queueMarkdownArticle({
          title: lead.title || `${item.decodedFolder} #${item.nextNumber}`,
          description: lead.summary,
          markdown: item.content,
          tags: syndicationService.topicTags(item.decodedFolder),
          category: item.decodedFolder,
          relativePath: item.filePath,
          seoSlug: item.seoSlug,
        });
      } catch (err) {
        logger.warn(`Syndication queue error (non-fatal): ${err.message}`);
      }
    }

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
    }));
  }

  // Numbers, paths and final content (promo section, redaction) for each item of a batch.
  async prepareBatch(items, owner, repo, branch) {
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
      // (on main: a run's branch is merged there at the end of the run, then deleted)
      const fileUrl = `https://github.com/${owner}/${repo}/blob/main/${urlSafeFolder}/${fileName}`;
      // Last boundary before a public commit: redact again in case content came
      // from anywhere other than generateArticle.
      let content = redactSecrets(item.fileBuffer ? item.fileBuffer.toString("utf8") : String(item.markdownContent || ""));

      // Attach the footer and SEO backlink (not for the Personal and LinkedIn Insights folders)
      const isSpecialFolder = decodedFolder.toLowerCase() === "personal" || decodedFolder.toLowerCase() === "linkedin insights";
      let seoSlug = null;
      if (!isSpecialFolder) {
        const categorySlug = decodedFolder.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
        const fileBase = fileName.replace(".md", "");
        const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^###\s+(.+)$/m);
        const rawTitle = titleMatch ? titleMatch[1] : (`${decodedFolder} #${nextNumber}`);
        seoSlug = generateSeoSlug(rawTitle, content, fileName, decodedFolder);
        const blogArticleUrl = config.syndication.canonicalBaseUrl ? `${config.syndication.canonicalBaseUrl}/articles/${categorySlug}/${seoSlug}` : "";
        const footer = articleFooter(blogArticleUrl);

        if (footer && !content.includes("Read More & Connect") && !content.includes("Read on the AI Knowledge Hub")) {
          content = content.trimEnd() + footer;
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
    return preparedItems;
  }

  // True when the commit holds every prepared file with this exact content. A path that holds other
  // content throws BATCH_PATH_TAKEN: committing would overwrite another article.
  async batchOnBranch(owner, repo, ref, preparedItems) {
    let present = 0;
    for (const it of preparedItems) {
      let data;
      try {
        ({ data } = await this.octokit.repos.getContent({ owner, repo, path: it.filePath, ref }));
      } catch (error) {
        if (error.status === 404) continue;
        throw error;
      }
      if (!data || data.sha !== blobSha(it.content)) {
        const taken = new Error(`${it.filePath} already exists with other content; not overwriting it`);
        taken.code = "BATCH_PATH_TAKEN";
        throw taken;
      }
      present++;
    }
    return present === preparedItems.length;
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
      if (existing.data?.encoding !== "base64") {
        // Over 1 MB GitHub returns no content: never overwrite a README that could not be read.
        logger.warn("README.md could not be read; not updating it.");
        return;
      }

      // Everything up to the categories heading is kept; a README without it gets it appended.
      const current = Buffer.from(existing.data.content || "", "base64").toString("utf8");
      const at = current.indexOf(README_CATEGORIES_HEADING);
      const headerContent = at >= 0
        ? `${current.slice(0, at + README_CATEGORIES_HEADING.length)}\n\n`
        : `${current.trimEnd()}\n\n${README_CATEGORIES_HEADING}\n\n`;

      let updatesContent = "";

      // GitHub's contents API is rate-limited. A small bounded pool is faster
      // than sequential calls without turning one README refresh into a burst.
      const folderResults = await this.mapWithConcurrency(config.folders, 4, async (folder) => {
        const decodedFolder = folder.name;
        try {
          // A short courtesy delay per folder: GitHub serves these reads concurrently.
          await new Promise(resolve => setTimeout(resolve, 250));

          const { data } = await this.octokit.repos.getContent({
            owner,
            repo,
            path: decodedFolder,
          });

          const files = data
            .filter((file) => resourceNumber(file.name) !== null)
            .map((file) => ({
              name: file.name,
              number: resourceNumber(file.name),
              url: `https://github.com/${owner}/${repo}/blob/main/${encodeURIComponent(
                decodedFolder
              )}/${file.name}`,
            }))
            .sort((a, b) => b.number - a.number);

          // The newest digest's headlines; a failed read only drops the headlines, not the section.
          let headlines = [];
          if (files.length > 0) {
            try {
              const { data: latest } = await this.octokit.repos.getContent({
                owner,
                repo,
                path: `${decodedFolder}/${files[0].name}`,
              });
              if (latest?.encoding === "base64") headlines = digestHeadlines(Buffer.from(latest.content || "", "base64").toString("utf8"));
            } catch (error) {
              logger.warn(`Could not read the newest digest in ${decodedFolder}: ${error.message}`);
            }
          }
          const sectionContent = renderCategorySection(folder, files, headlines);
          return { name: folder.name, content: sectionContent, count: files.length };
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
      const ordered = config.folders.map(folder =>
        folderResults.find(r => r.name === folder.name) || { name: folder.name, content: "", count: 0 }
      );

      updatesContent += renderCategoryIndex(ordered) + ordered.map((r) => r.content).join("");

      const newContent = headerContent + updatesContent + readmeFooter(owner, repo);

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

  // The branch this run commits to: main, or (GITHUB_RUN_BRANCHES, on by default) the day's run branch, made
  // from main the first time it is needed. A day's branch left by a run that stopped early is reused.
  async workBranch(owner, repo) {
    if (!config.github.runBranches) return "main";
    const name = runBranchName();
    if (this._runBranch === name) return name;
    try {
      await this.octokit.git.getRef({ owner, repo, ref: `heads/${name}` });
    } catch (error) {
      if (error.status !== 404) throw error;
      const main = await this.octokit.git.getRef({ owner, repo, ref: "heads/main" });
      await this.octokit.git.createRef({ owner, repo, ref: `refs/heads/${name}`, sha: main.data.object.sha });
      logger.info(`This run commits to ${owner}/${repo}@${name}.`);
    }
    this._runBranch = name;
    return name;
  }

  // End of a run: every run branch (this run's, and any an earlier run left unmerged) goes into main through a
  // pull request merged with a merge commit, then is deleted; an empty one is just deleted. Never fatal: a
  // branch that does not merge stays for the next run. Returns the merged pull request numbers.
  async finishRunBranches(owner, repo) {
    const merged = [];
    if (!config.github.runBranches) return merged;
    let refs = [];
    try {
      refs = (await this.octokit.git.listMatchingRefs({ owner, repo, ref: `heads/${RUN_BRANCH_PREFIX}` })).data;
    } catch (error) {
      logger.error(`Run branches could not be listed: ${error.message}`);
      return merged;
    }
    for (const ref of refs) {
      const name = ref.ref.replace(/^refs\/heads\//, "");
      try {
        const cmp = await this.octokit.repos.compareCommits({ owner, repo, base: "main", head: name });
        if (cmp.data.ahead_by > 0) {
          const open = (await this.octokit.pulls.list({ owner, repo, state: "open", head: `${owner}:${name}`, base: "main" })).data[0];
          const pr = open || (await this.octokit.pulls.create({
            owner, repo, head: name, base: "main",
            title: `📚 Run ${name.slice(RUN_BRANCH_PREFIX.length)}: ${cmp.data.ahead_by} commit(s) of new digests`,
            body: `The digests and README refresh committed by the pipeline's run on ${name.slice(RUN_BRANCH_PREFIX.length)}.`,
          })).data;
          await this.octokit.pulls.merge({ owner, repo, pull_number: pr.number, merge_method: "merge" });
          merged.push(pr.number);
          logger.info(`Run branch ${name} merged into main (pull request #${pr.number}).`);
        }
        await this.octokit.git.deleteRef({ owner, repo, ref: `heads/${name}` });
        if (this._runBranch === name) this._runBranch = null;
      } catch (error) {
        logger.error(`Run branch ${name} not merged (kept for the next run): ${error.message}`);
      }
    }
    return merged;
  }

  async createOrUpdateReadme(owner, repo, content) {
    try {
      const path = "README.md";
      const branch = await this.workBranch(owner, repo);

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

      const committer = commitIdentity();
      const response = await this.octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path,
        message: "📚 README: refresh the category list with the newest digests" + coAuthorTrailer(),
        content: Buffer.from(content).toString("base64"),
        sha: existingSha,
        branch,
        ...(committer ? { committer } : {}),
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
module.exports.readme = { digestHeadlines, renderCategorySection, renderCategoryIndex, blogCategoryUrl, readmeFooter, README_CATEGORIES_HEADING };
