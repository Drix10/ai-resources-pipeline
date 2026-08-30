const config = require("../../config");
const { logger } = require("../utils/helpers");

class SyndicationService {
  constructor() {
    this.DEFAULT_TIMEOUT_MS = 30000;
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
    const apiKey = config.syndication?.devto?.apiKey;
    if (!apiKey) {
      logger.warn("SyndicationService: DEVTO_API_KEY not configured. Skipping DEV.to publish.");
      return { success: false, platform: "devto", error: "Missing DEVTO_API_KEY" };
    }

    const safeTitle = String(title || "Technical Breakdown").trim().slice(0, 120);
    const cleanTags = this.sanitizeTags(tags, 4);
    const validCanonical = this.isValidUrl(canonicalUrl) ? canonicalUrl : undefined;

    const payload = {
      article: {
        title: safeTitle,
        published: Boolean(published),
        body_markdown: String(markdown || ""),
        tags: cleanTags.length > 0 ? cleanTags : ["tech", "ai", "coding"],
        ...(validCanonical ? { canonical_url: validCanonical } : {}),
        ...(coverImage && this.isValidUrl(coverImage) ? { main_image: coverImage } : {}),
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT_MS);

    try {
      logger.info(`SyndicationService: Publishing to DEV.to ("${safeTitle.slice(0, 40)}...")...`);
      const response = await fetch("https://dev.to/api/articles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
          "User-Agent": "ai-knowledge-pipeline/1.0 (https://blogs.drix10.com)",
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`DEV.to returned HTTP ${response.status}: ${JSON.stringify(data?.error || data)}`);
      }

      logger.info(`SyndicationService: Successfully published to DEV.to! URL: ${data.url}`);
      return { success: true, platform: "devto", url: data.url, id: data.id };
    } catch (error) {
      const msg = error?.name === "AbortError" ? "DEV.to request timed out" : error.message;
      logger.error(`SyndicationService: DEV.to publishing failed: ${msg}`);
      return { success: false, platform: "devto", error: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Broadcast an article across enabled syndication destinations (DEV.to)
   */
  async syndicateAll({ title, markdown, tags = [], canonicalUrl, coverImage, published = true }) {
    const results = [];

    if (config.syndication?.devto?.enabled || config.syndication?.devto?.apiKey) {
      const res = await this.publishToDevTo({ title, markdown, tags, canonicalUrl, coverImage, published });
      results.push(res);
    }

    return results;
  }

  /**
   * Syndicate markdown article file from GitHub service hook
   */
  async syndicateMarkdownArticle({ title, markdown, tags = [], category, relativePath, coverImage, published = true }) {
    const categorySlug = String(category || title || 'tech').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const canonicalUrl = `https://blogs.drix10.com/categories/${categorySlug}`;
    return this.syndicateAll({
      title: `${title} - Autonomous AI Engineering Resource Breakdown`,
      markdown,
      tags: this.sanitizeTags(tags),
      canonicalUrl,
      coverImage,
      published,
    });
  }
}

module.exports = new SyndicationService();
