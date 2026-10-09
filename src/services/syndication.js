const fs = require("fs");
const path = require("path");
const config = require("../../config");
const { logger, generateSeoSlug } = require("../utils/helpers");

class SyndicationService {
  constructor() {
    this.DEFAULT_TIMEOUT_MS = 30000;
    // DEV.to throttles article creation hard; 2.5s spacing tripped 429s on every batch.
    this.RATE_LIMIT_DELAY_MS = 10000;
    // Circuit breaker: after a 401/429 stop calling DEV.to for a cooldown instead of
    // burning a request (and a 429 strike) per queued article.
    this._blockedUntil = 0;
    this._blockReason = "";
    this._queue = Promise.resolve();
    this._pendingCount = 0;
    // Persistent queue (processQueue): live-check budget, post attempts before giving up,
    // and how long an article may wait for its canonical page before it is marked failed.
    this.LIVE_CHECK_TIMEOUT_MS = 10000;
    this.MAX_ATTEMPTS = 3;
    this.MAX_PENDING_MS = 14 * 24 * 60 * 60 * 1000;
  }

  /**
   * Serializes syndication tasks in a FIFO queue to prevent burst rate-limit violations
   * Automatically resets queue promise when empty to prevent long-term memory retention.
   */
  async enqueue(task) {
    this._pendingCount++;
    const run = this._queue.then(async () => {
      let result;
      try {
        result = await task();
        return result;
      } finally {
        // A skipped task made no request, so it owes no rate-limit spacing.
        if (!result?.skipped) await new Promise((res) => setTimeout(res, this.RATE_LIMIT_DELAY_MS));
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

  tripBreaker(ms, reason) {
    this._blockedUntil = Date.now() + ms;
    this._blockReason = reason;
    logger.warn(`SyndicationService: DEV.to paused for ${Math.round(ms / 60000)} min (${reason}).`);
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
      if (Date.now() < this._blockedUntil) {
        return { success: false, platform: "devto", skipped: true, error: `DEV.to paused: ${this._blockReason}` };
      }
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

            if (response.status === 401) {
              this.tripBreaker(6 * 60 * 60 * 1000, "HTTP 401 - check DEVTO_API_KEY");
              return { ok: false, status: 401, data };
            }
            const isTransient = response.status === 429 || response.status >= 500 || (typeof data?.error === "string" && data.error.toLowerCase().includes("retry later"));
            if (isTransient && attempt < maxRetries) {
              const retryAfter = Number(response.headers.get("retry-after"));
              const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 60) : 5 + attempt * 2;
              logger.warn(`SyndicationService: DEV.to transient response (${rawText.trim() || response.status}). Backing off for ${waitSeconds}s before retry (attempt ${attempt + 1}/${maxRetries})...`);
              await new Promise((res) => setTimeout(res, waitSeconds * 1000));
              continue;
            }

            if (response.status === 429) this.tripBreaker(15 * 60 * 1000, "HTTP 429 rate limited");
            return { ok: response.ok, status: response.status, data };
          } catch (fetchErr) {
            // ponytail: timeouts are transient too; error.log shows DEV.to
            // publishes dying on first-attempt AbortError with zero retries.
            if (attempt < maxRetries) {
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

        // Only "Canonical url has already been taken" means this article is already on DEV.to;
        // re-posting would publish a duplicate. Any other 422 (an invalid canonical, a bad
        // tag) is a real failure that must stay visible and be retried.
        if (!result.ok && result.status === 422 && /has already been taken/i.test(JSON.stringify(result.data))) {
          logger.info("SyndicationService: DEV.to already has an article with this canonical URL; skipping duplicate.");
          // Not "skipped": a request was made, so the queue still owes rate-limit spacing.
          return { success: true, platform: "devto", duplicate: true, status: 422 };
        }

        if (!result.ok) {
          const failed = new Error(`DEV.to returned HTTP ${result.status}: ${JSON.stringify(result.data?.error || result.data)}`);
          failed.status = result.status;
          throw failed;
        }

        logger.info(`SyndicationService: Successfully published to DEV.to! URL: ${result.data.url}`);
        return { success: true, platform: "devto", url: result.data.url, id: result.data.id, status: result.status };
      } catch (error) {
        const msg = error?.name === "AbortError" ? "DEV.to request timed out" : error.message;
        logger.error(`SyndicationService: DEV.to publishing failed: ${msg}`);
        return { success: false, platform: "devto", error: msg, status: error?.status || 0 };
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
   * Syndicate markdown article file from GitHub service hook with unique content-based SEO slug.
   * Posts immediately; the pipeline uses queueMarkdownArticle + processQueue instead, so DEV.to
   * never links to a canonical page that is not deployed yet.
   */
  async syndicateMarkdownArticle(args) {
    return this.syndicateAll(this.prepareMarkdownArticle(args));
  }

  /**
   * The DEV.to payload for a committed markdown file: title, enriched markdown and its canonical blog URL.
   */
  prepareMarkdownArticle({ title, markdown, tags = [], category, relativePath, coverImage, published = true, seoSlug }) {
    let canonicalUrl;
    let enrichedMarkdown = String(markdown || "");

    if (relativePath) {
      const normalizedPath = String(relativePath).replace(/\\/g, "/");
      const pathWithoutExt = normalizedPath.replace(/\.md$/i, "");
      const parts = pathWithoutExt.split("/");
      const folderName = parts.length > 1 ? parts[0] : (category || "AI");
      const fileBase = parts[parts.length - 1];
      const categorySlug = folderName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

      const fileName = `${fileBase}.md`;
      const titleMatch = enrichedMarkdown.match(/^#\s+(.+)$/m) || enrichedMarkdown.match(/^###\s+(.+)$/m);
      const rawTitle = titleMatch ? titleMatch[1] : (title || `${folderName} #${fileBase}`);
      const computedSlug = seoSlug || generateSeoSlug(rawTitle, enrichedMarkdown, fileName, folderName);

      const cleanPath = `${categorySlug}/${computedSlug}`;
      canonicalUrl = `${config.syndication.canonicalBaseUrl}/articles/${cleanPath}`;

      // Guarantee DEV.to articles contain reciprocal backlinks to both the blog and GitHub file
      const isSpecial = categorySlug === "personal" || categorySlug === "linkedin-insights";
      if (!isSpecial && !enrichedMarkdown.includes("Read More & Connect") && !enrichedMarkdown.includes("Read on the AI Knowledge Hub")) {
        const promoSection = `

---

### Read More & Connect

**Canonical / interactive version:** [blogs.drix10.com](${canonicalUrl})

Written by **[Drishtant Ghosh (Drix10)](https://drix10.com)**, a technical founder and engineer working across AI systems, developer infrastructure, and cybersecurity.

- [Blog](https://blogs.drix10.com) · [Portfolio](https://drix10.com) · [GitHub](https://github.com/Drix10)
- [LinkedIn](https://www.linkedin.com/in/drix10) · [X](https://x.com/DrishtantGhosh) · [Email](mailto:ggdrishtant@gmail.com)
`;
        enrichedMarkdown = enrichedMarkdown.trimEnd() + promoSection;
      }
    } else {
      const categorySlug = String(category || title || "tech").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
      canonicalUrl = `${config.syndication.canonicalBaseUrl}/articles/${categorySlug}-${Date.now()}`;
    }

    return {
      title: String(title || "Technical Breakdown").trim().slice(0, 120),
      markdown: enrichedMarkdown,
      tags: this.sanitizeTags(tags),
      canonicalUrl,
      coverImage,
      published,
    };
  }

  // ---------------------------------------------------------------------
  // Persistent DEV.to queue. A committed article is recorded here (keyed by its
  // canonical URL) and posted by processQueue() only once that URL is live on the
  // blog. The record survives restarts; a rate limit leaves the rest pending.
  // ---------------------------------------------------------------------

  queuePath() {
    return process.env.SYNDICATION_QUEUE_PATH || path.join(process.cwd(), "data", "syndication-queue.json");
  }

  readQueue() {
    const file = this.queuePath();
    let raw;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { items: {} };
      throw error; // unreadable for another reason: never overwrite it with an empty queue
    }
    try {
      const data = JSON.parse(raw);
      return { items: data && typeof data.items === "object" && data.items ? data.items : {} };
    } catch (error) {
      // Keep the damaged file for a human; start a fresh queue beside it.
      const aside = `${file}.corrupt-${Date.now()}`;
      try { fs.renameSync(file, aside); } catch { /* best effort */ }
      logger.error(`SyndicationService: ${file} was not valid JSON; moved it to ${aside}.`);
      return { items: {} };
    }
  }

  // Write-then-rename, retried: on Windows an antivirus or indexer briefly holding the
  // file makes rename fail with EPERM/EBUSY.
  async writeQueue(queue) {
    const file = this.queuePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(queue, null, 2), "utf8");
    for (let attempt = 1; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (error) {
        if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 6) {
          try { fs.unlinkSync(tmp); } catch { /* best effort */ }
          throw error;
        }
        await new Promise((res) => setTimeout(res, 50 * attempt));
      }
    }
  }

  // Read-modify-write under an in-process lock, so an enqueue during processQueue's
  // network calls is never overwritten by a stale copy.
  async mutateQueue(fn) {
    const run = (this._queueLock || Promise.resolve()).then(async () => {
      const queue = this.readQueue();
      const result = await fn(queue);
      await this.writeQueue(queue);
      return result;
    });
    this._queueLock = run.catch(() => {});
    return run;
  }

  /**
   * Records a committed markdown file for DEV.to. Never posts; processQueue does that once the
   * canonical page is live. An already-queued canonical URL is left as it is (no double post).
   */
  async queueMarkdownArticle(args) {
    if (!config.syndication?.devto?.apiKey) return null; // nothing would ever post it
    const article = this.prepareMarkdownArticle(args);
    if (!article.canonicalUrl) return null;
    return this.mutateQueue((queue) => {
      if (!queue.items[article.canonicalUrl]) {
        const now = new Date().toISOString();
        queue.items[article.canonicalUrl] = { ...article, status: "pending", attempts: 0, createdAt: now, updatedAt: now };
        logger.info(`SyndicationService: queued for DEV.to once live: ${article.canonicalUrl}`);
      }
      return queue.items[article.canonicalUrl];
    });
  }

  // True only when the canonical page answers 200 (HEAD, or GET where HEAD is not allowed).
  async isCanonicalLive(url) {
    for (const method of ["HEAD", "GET"]) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.LIVE_CHECK_TIMEOUT_MS);
      try {
        const res = await fetch(url, { method, redirect: "follow", signal: controller.signal, headers: { "User-Agent": "ai-resources-pipeline/1.0 (https://blogs.drix10.com)" } });
        try { await res.body?.cancel(); } catch { /* nothing to release */ }
        if (method === "HEAD" && (res.status === 405 || res.status === 501)) continue;
        return res.status === 200;
      } catch (error) {
        return false;
      } finally {
        clearTimeout(timeout);
      }
    }
    return false;
  }

  /**
   * Posts pending queue items whose canonical page is live. Not live yet: stays pending.
   * 429 or a tripped breaker: stops, leaving the rest pending. A duplicate canonical: done.
   * Any other failure: retried on later runs, failed after MAX_ATTEMPTS.
   */
  async processQueue({ maxItems = Infinity } = {}) {
    const summary = { posted: 0, duplicates: 0, notLive: 0, failed: 0, retrying: 0, paused: false };
    if (!config.syndication?.devto?.apiKey || this._processing) return summary; // one pass at a time: no double posts
    this._processing = true;
    try {
      await this.drainQueue(summary, maxItems);
    } finally {
      this._processing = false;
    }
    logger.info(`SyndicationService: DEV.to queue: ${summary.posted} posted, ${summary.duplicates} already there, ${summary.notLive} not live yet, ${summary.retrying} to retry, ${summary.failed} failed${summary.paused ? ", paused" : ""}.`);
    return summary;
  }

  async drainQueue(summary, maxItems) {
    const pending = Object.values(this.readQueue().items).filter((it) => it && it.status === "pending");
    let attempted = 0;
    for (const item of pending) {
      if (attempted >= maxItems) break;
      if (Date.now() < this._blockedUntil) { summary.paused = true; break; }
      if (!(await this.isCanonicalLive(item.canonicalUrl))) {
        summary.notLive++;
        const ageMs = Date.now() - Date.parse(item.createdAt || 0);
        if (ageMs > this.MAX_PENDING_MS) {
          await this.updateQueueItem(item.canonicalUrl, { status: "failed", lastError: "canonical page never went live" });
          summary.failed++;
        }
        continue;
      }
      attempted++;
      const result = await this.publishToDevTo(item);
      if (result.success) {
        // A posted article no longer needs its body in the queue file.
        await this.updateQueueItem(item.canonicalUrl, { status: "done", duplicate: Boolean(result.duplicate), devtoUrl: result.url || null, markdown: undefined, lastError: undefined });
        result.duplicate ? summary.duplicates++ : summary.posted++;
        continue;
      }
      if (result.skipped || result.status === 429 || result.status === 401) {
        summary.paused = true; // rate limit or bad key: the rest wait for the next run
        await this.updateQueueItem(item.canonicalUrl, { lastError: result.error });
        break;
      }
      const attempts = (Number(item.attempts) || 0) + 1;
      const failed = attempts >= this.MAX_ATTEMPTS;
      await this.updateQueueItem(item.canonicalUrl, { status: failed ? "failed" : "pending", attempts, lastError: result.error });
      failed ? summary.failed++ : summary.retrying++;
    }
  }

  async updateQueueItem(canonicalUrl, patch) {
    return this.mutateQueue((queue) => {
      const item = queue.items[canonicalUrl];
      if (!item) return null;
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete item[k];
        else item[k] = v;
      }
      item.updatedAt = new Date().toISOString();
      return item;
    });
  }
}

module.exports = new SyndicationService();
