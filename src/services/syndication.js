const config = require("../../config");
const { logger } = require("../utils/helpers");

class SyndicationService {
  constructor() {
    this.DEFAULT_TIMEOUT_MS = 30000;
    this.RATE_LIMIT_DELAY_MS = 2500;
    this._queue = Promise.resolve();
    this._pendingCount = 0;
  }

  /**
   * Serializes syndication tasks in a FIFO queue to prevent burst rate-limit violations
   * Automatically resets queue promise when empty to prevent long-term memory retention.
   */
  async enqueue(task) {
    this._pendingCount++;
    const run = this._queue.then(async () => {
      try {
        return await task();
      } finally {
        await new Promise((res) => setTimeout(res, this.RATE_LIMIT_DELAY_MS));
      }
    });
    this._queue = run
      .catch(() => {})
      .finally(() => {
        this._pendingCount = Math.max(0, this._pendingCount - 1);
        if (this._pendingCount === 0) {
          this._queue = Promise.resolve();
        }
      });
    return run;
  }

  /**
   * Sanitizes tags to conform to platform constraints (alphanumeric, lowercase, max 4)
   */
  sanitizeTags(tags = [], maxTags = 4) {
    if (!Array.isArray(tags)) {
      tags = typeof tags === "string" ? tags.split(/[\s,#]+/) : [];
    }
    const clean = tags
      .map((t) => String(t || "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().trim())
      .filter((t) => t.length >= 2 && t.length <= 20);
    return Array.from(new Set(clean)).slice(0, maxTags);
  }

  /**
   * Validates if a URL is well-formed http(s)
   */
  isValidUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Publish an article to DEV.to via REST API with canonical URL backlink protection
   */
  async publishToDevTo({ title, markdown, tags = [], canonicalUrl, coverImage, published = true }) {
    return this.enqueue(async () => {
      const apiKey = config.syndication?.devto?.apiKey;
      if (!apiKey) {
        logger.warn("SyndicationService: DEVTO_API_KEY not configured. Skipping DEV.to publish.");
        return { success: false, platform: "devto", error: "Missing DEVTO_API_KEY" };
      }

      const safeTitle = String(title || "Technical Breakdown").trim().slice(0, 120);
      const cleanTags = this.sanitizeTags(tags, 4);
      let validCanonical = this.isValidUrl(canonicalUrl) ? canonicalUrl : undefined;

      const autoPublish = config.syndication?.devto?.enabled ?? true;
      const isPublished = typeof published === "boolean" ? (published && autoPublish) : autoPublish;

      const buildPayload = (cUrl) => ({
        article: {
          title: safeTitle,
          published: Boolean(isPublished),
          body_markdown: String(markdown || ""),
          tags: cleanTags.length > 0 ? cleanTags : ["tech", "ai", "coding"],
          ...(cUrl ? { canonical_url: cUrl } : {}),
          ...(coverImage && this.isValidUrl(coverImage) ? { main_image: coverImage } : {}),
        },
      });

      const sendRequest = async (payload, maxRetries = 2) => {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT_MS);
          try {
            const response = await fetch("https://dev.to/api/articles", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "api-key": apiKey,
                "User-Agent": "ai-resources-pipeline/1.0 (https://blogs.drix10.com)",
              },
              signal: controller.signal,
              body: JSON.stringify(payload),
            });

            const rawText = await response.text();
            let data;
            try {
              data = JSON.parse(rawText);
            } catch {
              data = { error: rawText.trim() };
            }

            const isTransient = response.status === 429 || response.status >= 500 || (typeof data?.error === "string" && data.error.toLowerCase().includes("retry later"));
            if (isTransient && attempt < maxRetries) {
              const waitSeconds = 5 + attempt * 2;
              logger.warn(`SyndicationService: DEV.to transient response (${rawText.trim() || response.status}). Backing off for ${waitSeconds}s before retry (attempt ${attempt + 1}/${maxRetries})...`);
              await new Promise((res) => setTimeout(res, waitSeconds * 1000));
              continue;
            }

            return { ok: response.ok, status: response.status, data };
          } catch (fetchErr) {
            if (attempt < maxRetries && fetchErr.name !== "AbortError") {
              const waitSeconds = 3 + attempt * 2;
              logger.warn(`SyndicationService: Network error (${fetchErr.message}). Retrying in ${waitSeconds}s (attempt ${attempt + 1}/${maxRetries})...`);
              await new Promise((res) => setTimeout(res, waitSeconds * 1000));
              continue;
            }
            throw fetchErr;
          } finally {
            clearTimeout(timeout);
          }
        }
      };

      try {
        logger.info(`SyndicationService: Publishing to DEV.to ("${safeTitle.slice(0, 40)}...")...`);
        let result = await sendRequest(buildPayload(validCanonical));

        // Edge-Case Safeguard: If DEV.to rejects with 422 due to duplicate canonical URL, retry with unique timestamp param or standalone
        if (!result.ok && result.status === 422 && JSON.stringify(result.data).toLowerCase().includes("canonical url")) {
          logger.warn("SyndicationService: Canonical URL collision detected. Retrying with unique timestamped canonical...");
          const uniqueCanonical = validCanonical ? `${validCanonical}?v=${Date.now()}` : undefined;
          result = await sendRequest(buildPayload(uniqueCanonical));
        }

        if (!result.ok) {
          throw new Error(`DEV.to returned HTTP ${result.status}: ${JSON.stringify(result.data?.error || result.data)}`);
        }

        logger.info(`SyndicationService: Successfully published to DEV.to! URL: ${result.data.url}`);
        return { success: true, platform: "devto", url: result.data.url, id: result.data.id };
      } catch (error) {
        const msg = error?.name === "AbortError" ? "DEV.to request timed out" : error.message;
        logger.error(`SyndicationService: DEV.to publishing failed: ${msg}`);
        return { success: false, platform: "devto", error: msg };
      }
    });
  }

  /**
   * Broadcast an article across enabled syndication destinations (DEV.to)
   */
  async syndicateAll({ title, markdown, tags = [], canonicalUrl, coverImage, published = true }) {
    const results = [];

    const isDevToConfigured = Boolean(config.syndication?.devto?.apiKey);
    if (isDevToConfigured) {
      const res = await this.publishToDevTo({ title, markdown, tags, canonicalUrl, coverImage, published });
      results.push(res);
    }

    return results;
  }

  /**
   * Syndicate markdown article file from GitHub service hook with unique article slug
   */
  async syndicateMarkdownArticle({ title, markdown, tags = [], category, relativePath, coverImage, published = true }) {
    let canonicalUrl;
    let enrichedMarkdown = String(markdown || "");

    if (relativePath) {
      const normalizedPath = String(relativePath).replace(/\\/g, "/");
      const pathWithoutExt = normalizedPath.replace(/\.md$/i, "");
      const parts = pathWithoutExt.split("/");
      const folderName = parts.length > 1 ? parts[0] : (category || "AI");
      const fileBase = parts[parts.length - 1];
      const categorySlug = folderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      const articleSlug = fileBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      const cleanPath = `${categorySlug}/${articleSlug}`;
      canonicalUrl = `https://blogs.drix10.com/articles/${cleanPath}`;

      // Guarantee DEV.to articles contain reciprocal backlinks to both the blog and GitHub file
      const isSpecial = categorySlug === "personal" || categorySlug === "linkedin-insights";
      if (!isSpecial && !enrichedMarkdown.includes("Read on the AI Knowledge Hub")) {
        const fileName = `${fileBase}.md`;
        const githubUrl = `https://github.com/Drix10/ai-resources/blob/main/${encodeURIComponent(folderName)}/${encodeURIComponent(fileName)}`;

        const promoSection = `

---

### 🌐 Read on the AI Knowledge Hub & Connect
> **Interactive Article & Live Reader View**: [Read on blogs.drix10.com](${canonicalUrl})

Curated and maintained by **[Drishtant Ghosh (Drix10)](https://drix10.com)** — Co-Founder @ PartPilot, 1x Acquired Serial Founder (ReeF), Canopy @ Founders, Inc., & Cybersecurity Researcher.

- **Interactive Article Breakdown**: [blogs.drix10.com/articles/${cleanPath}](${canonicalUrl})
- **GitHub Source File**: [${folderName}/${fileName}](${githubUrl})
- **Explore Full Knowledge Base**: [blogs.drix10.com](https://blogs.drix10.com)
- **Personal Portfolio & Projects**: [drix10.com](https://drix10.com)
- **Connect on LinkedIn**: [linkedin.com/in/drix10](https://www.linkedin.com/in/drix10)
- **Follow on X / Twitter**: [@Drix_10](https://x.com/Drix_10)
- **GitHub Repository**: [Drix10/ai-resources](https://github.com/Drix10/ai-resources)
`;
        enrichedMarkdown = enrichedMarkdown.trimEnd() + promoSection;
      }
    } else {
      const categorySlug = String(category || title || "tech").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      canonicalUrl = `https://blogs.drix10.com/articles/${categorySlug}-${Date.now()}`;
    }

    return this.syndicateAll({
      title: `${title} - Autonomous AI Engineering Resource Breakdown`,
      markdown: enrichedMarkdown,
      tags: this.sanitizeTags(tags),
      canonicalUrl,
      coverImage,
      published,
    });
  }
}

module.exports = new SyndicationService();
