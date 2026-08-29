const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");

class SyndicationService {
  constructor() {
    this.mediumAuthorId = null;
    this.DEFAULT_TIMEOUT_MS = 30000;
  }

  /**
   * Sanitizes tags to conform to platform constraints (alphanumeric, no spaces, lowercase, max 4-5)
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
   * Publish an article to DEV.to via REST API with timeout protection
   * Docs: https://developers.forem.com/api/v1#tag/articles/operation/createArticle
   */
  async publishToDevTo({ title, markdown, tags = [], canonicalUrl, coverImage, isDraft = false }) {
    const apiKey = config.syndication?.devto?.apiKey;
    if (!apiKey) {
      logger.warn("SyndicationService: DEVTO_API_KEY not configured. Skipping DEV.to publish.");
      return { success: false, platform: "devto", error: "Missing DEVTO_API_KEY" };
    }

    const safeTitle = String(title || "Untitled Article").trim().slice(0, 120);
    const cleanTags = this.sanitizeTags(tags, 4);
    const validCanonical = this.isValidUrl(canonicalUrl) ? canonicalUrl : undefined;

    const payload = {
      article: {
        title: safeTitle,
        published: !isDraft,
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
   * Get authenticated user ID for Medium API
   */
  async getMediumAuthorId(token) {
    if (this.mediumAuthorId) return this.mediumAuthorId;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("https://api.medium.com/v1/me", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data?.data?.id) {
        throw new Error(`Medium auth failed: ${JSON.stringify(data?.errors || data)}`);
      }
      this.mediumAuthorId = data.data.id;
      return this.mediumAuthorId;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Publish an article to Medium via REST API with timeout protection
   * Docs: https://github.com/Medium/medium-api-docs
   */
  async publishToMedium({ title, markdown, tags = [], canonicalUrl, publishStatus = "public" }) {
    const token = config.syndication?.medium?.token;
    if (!token) {
      logger.warn("SyndicationService: MEDIUM_TOKEN not configured. Skipping Medium publish.");
      return { success: false, platform: "medium", error: "Missing MEDIUM_TOKEN" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT_MS);

    try {
      const authorId = await this.getMediumAuthorId(token);
      const safeTitle = String(title || "Untitled Article").trim().slice(0, 100);
      const cleanTags = this.sanitizeTags(tags, 5);
      const validCanonical = this.isValidUrl(canonicalUrl) ? canonicalUrl : undefined;

      const payload = {
        title: safeTitle,
        contentFormat: "markdown",
        content: String(markdown || ""),
        tags: cleanTags.length > 0 ? cleanTags : ["Technology", "Artificial Intelligence"],
        publishStatus: publishStatus,
        ...(validCanonical ? { canonicalUrl: validCanonical } : {}),
      };

      logger.info(`SyndicationService: Publishing to Medium ("${safeTitle.slice(0, 40)}...")...`);
      const response = await fetch(`https://api.medium.com/v1/users/${authorId}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Medium returned HTTP ${response.status}: ${JSON.stringify(data?.errors || data)}`);
      }

      logger.info(`SyndicationService: Successfully published to Medium! URL: ${data?.data?.url}`);
      return { success: true, platform: "medium", url: data?.data?.url, id: data?.data?.id };
    } catch (error) {
      const msg = error?.name === "AbortError" ? "Medium request timed out" : error.message;
      logger.error(`SyndicationService: Medium publishing failed: ${msg}`);
      return { success: false, platform: "medium", error: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Publish an article to Hashnode via GraphQL API with timeout protection
   * Docs: https://apidocs.hashnode.com
   */
  async publishToHashnode({ title, markdown, tags = [], canonicalUrl, subtitle }) {
    const token = config.syndication?.hashnode?.token;
    const publicationId = config.syndication?.hashnode?.publicationId;

    if (!token || !publicationId) {
      logger.warn("SyndicationService: Hashnode token or publicationId missing. Skipping Hashnode publish.");
      return { success: false, platform: "hashnode", error: "Missing HASHNODE_TOKEN or HASHNODE_PUBLICATION_ID" };
    }

    const safeTitle = String(title || "Untitled Article").trim().slice(0, 150);
    const cleanTags = this.sanitizeTags(tags, 5).map((t) => ({ name: t, slug: t }));
    const slug = safeTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    const validCanonical = this.isValidUrl(canonicalUrl) ? canonicalUrl : undefined;

    const mutation = `
      mutation PublishPost($input: PublishPostInput!) {
        publishPost(input: $input) {
          post {
            id
            title
            url
            slug
          }
        }
      }
    `;

    const input = {
      title: safeTitle,
      ...(subtitle ? { subtitle: String(subtitle).slice(0, 200) } : {}),
      publicationId: publicationId,
      contentMarkdown: String(markdown || ""),
      tags: cleanTags.length > 0 ? cleanTags : [{ name: "Tech", slug: "tech" }],
      slug: slug || "article",
      ...(validCanonical ? { originalArticleURL: validCanonical } : {}),
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.DEFAULT_TIMEOUT_MS);

    try {
      logger.info(`SyndicationService: Publishing to Hashnode ("${safeTitle.slice(0, 40)}...")...`);
      const response = await fetch("https://gql.hashnode.com", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: token,
        },
        signal: controller.signal,
        body: JSON.stringify({ query: mutation, variables: { input } }),
      });

      const data = await response.json();
      if (data.errors && data.errors.length > 0) {
        throw new Error(`Hashnode GraphQL error: ${JSON.stringify(data.errors)}`);
      }

      const post = data?.data?.publishPost?.post;
      logger.info(`SyndicationService: Successfully published to Hashnode! URL: ${post?.url}`);
      return { success: true, platform: "hashnode", url: post?.url, id: post?.id };
    } catch (error) {
      const msg = error?.name === "AbortError" ? "Hashnode request timed out" : error.message;
      logger.error(`SyndicationService: Hashnode publishing failed: ${msg}`);
      return { success: false, platform: "hashnode", error: msg };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Main syndication orchestrator: distributes a newly saved Markdown file
   * across all enabled platforms in parallel with SEO canonical URL protection.
   */
  async syndicateMarkdownArticle({ title, markdown, tags = [], relativePath, category }) {
    const canonicalBaseUrl = config.syndication?.canonicalBaseUrl || "https://yourdomain.com";
    const slug = String(relativePath || title || "article")
      .replace(/\\/g, "/")
      .replace(/\.md$/i, "")
      .replace(/[^a-zA-Z0-9/_-]/g, "-")
      .toLowerCase();

    const canonicalUrl = `${canonicalBaseUrl}/articles/${slug}`;
    const results = {};
    const tasks = [];

    if (config.syndication?.devto?.enabled) {
      tasks.push(
        this.publishToDevTo({
          title,
          markdown,
          tags: [...tags, category].filter(Boolean),
          canonicalUrl,
        }).then((res) => {
          results.devto = res;
        }),
      );
    }

    if (config.syndication?.medium?.enabled) {
      tasks.push(
        this.publishToMedium({
          title,
          markdown,
          tags: [...tags, category].filter(Boolean),
          canonicalUrl,
        }).then((res) => {
          results.medium = res;
        }),
      );
    }

    if (config.syndication?.hashnode?.enabled) {
      tasks.push(
        this.publishToHashnode({
          title,
          markdown,
          tags: [...tags, category].filter(Boolean),
          canonicalUrl,
        }).then((res) => {
          results.hashnode = res;
        }),
      );
    }

    if (tasks.length > 0) {
      logger.info(`SyndicationService: Triggering syndication for ${tasks.length} active platform(s)...`);
      await Promise.allSettled(tasks);
    }

    return results;
  }
}

module.exports = new SyndicationService();
