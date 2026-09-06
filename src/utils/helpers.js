const winston = require("winston");
const fs = require("fs");
const path = require("path");

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "helpers" },
  transports: [
    new winston.transports.File({
      filename: "error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "helpers.log",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
  exitOnError: false,
});

/**
 * Sanitizes user input to prevent XSS attacks.
 * @param {string} input - The input string to sanitize.
 * @returns {string} - The sanitized string.
 */
const sanitizeInput = (input) => {
  if (typeof input !== "string") {
    logger.error("Invalid input type for sanitizeInput: Expected string, got", typeof input);
    return "";
  }

  if (!input.trim()) return "";

  return input
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .replace(/\\/g, "&#x5C;")
    .replace(/`/g, "&#x60;");
};

/**
 * Handles errors gracefully and logs them using Winston.
 */
const handleError = (error, message = "An error occurred", additionalContext = {}) => {
  if (!error) {
    logger.error("handleError called with null/undefined error");
    return;
  }

  const errorDetails = {
    message: error.message,
    stack: error.stack,
    code: error.code,
    name: error.name,
    ...additionalContext,
    timestamp: new Date().toISOString(),
  };

  logger.error(`${message}: ${error.message}`, errorDetails);
};

/**
 * Creates a standardized error response object.
 */
const createErrorResponse = (message, statusCode = 500, details = {}) => {
  return {
    success: false,
    error: {
      message,
      statusCode,
      ...details,
      timestamp: new Date().toISOString(),
    },
  };
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generates a clean, unique, keyword-rich SEO slug based on article title, content, and resource number.
 * E.g. "🤖 AI Systems - Cloud Storage Risks" in "resources-257.md" -> "ai-systems-cloud-storage-risks-257"
 * E.g. "Personal" article "intern-to-competitor.md" -> "intern-to-competitor"
 *
 * @param {string} rawTitle - Raw title of the article
 * @param {string} content - Markdown content for fallback keyword extraction
 * @param {string} filename - Filename (e.g. "resources-257.md")
 * @param {string} categoryName - Category name (e.g. "AI Developer Tools")
 * @returns {string} - Clean semantic SEO slug
 */
const generateSeoSlug = (rawTitle, content = "", filename = "", categoryName = "") => {
  const isPersonal = String(categoryName || "").toLowerCase() === "personal";
  const fileBase = String(filename || "").replace(/\.md$/i, "");

  // Personal articles keep their established filenames as slugs (e.g. "intern-to-competitor")
  if (isPersonal && fileBase && !fileBase.startsWith("resources-")) {
    return fileBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // 1. Strip emojis and common boilerplate prefixes from rawTitle
  let cleanTitle = String(rawTitle || "")
    .replace(/^#+\s*/, "")
    // Strip leading unicode emojis
    .replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1FA00}-\u{1FAFF}\s]+/u, "")
    // Strip common generic category/type prefixes like "Tech - ", "Tools - ", "AI Model - ", "Category - Specific Topic", "Technical - "
    .replace(/^(?:Tech(?:nical)?|Tools?|AI(?:\/ML)?(?: Model)?|Hardware Engineering|Award|Category|Specific Topic|Update|News)\s*[-:—–]\s*/i, "")
    .trim();

  // If title was "Specific Topic" or became empty, look at first paragraph for keywords
  const isGeneric = !cleanTitle || /^(?:specific topic|ai & tech|ai tools|tech updates|twitter\/?x threads)$/i.test(cleanTitle);
  if (isGeneric && content) {
    const firstLine = content
      .replace(/^#+.*$/gm, "")
      .replace(/\*\*|__|\*|_/g, "")
      .replace(/```[\s\S]*?```/g, "")
      .replace(/🔗.*$/gm, "")
      .trim()
      .split(/\r?\n/)[0] || "";
    const words = firstLine.replace(/[^a-zA-Z0-9\s]/g, " ").split(/\s+/).filter(w => w.length >= 3 && !/^(the|this|and|for|with|that|from|into|about)$/i.test(w)).slice(0, 6);
    if (words.length >= 2) {
      cleanTitle = words.join(" ");
    }
  }

  // Fallback to title or category if still empty
  if (!cleanTitle) {
    cleanTitle = rawTitle || categoryName || "breakdown";
  }

  // Convert to clean kebab-case
  let slug = cleanTitle
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");

  // Extract resource number if available to guarantee 100% uniqueness
  const numMatch = fileBase.match(/(?:resources-)?(\d+)/i);
  if (numMatch && !slug.endsWith(numMatch[1])) {
    slug = `${slug}-${numMatch[1]}`;
  }

  return slug || fileBase || "article";
};

/**
 * Automatically scans all workspace markdown folders and rebuilds blog/lib/articles-index.json
 */
const rebuildBlogIndex = () => {
  try {
    const rootDir = path.resolve(__dirname, "../../");
    const blogDir = path.join(rootDir, "blog");
    if (!fs.existsSync(blogDir)) return;

    const ignored = new Set(["node_modules", ".git", ".next", ".gemini", "blog", "config", "src", "utils", "tests", "logs", "linkedin-previews", "scratch", "temp", "tracker"]);
    const articles = [];
    const categoryCountMap = new Map();

    const contentDir = path.join(blogDir, "content");
    if (!fs.existsSync(contentDir)) return;

    // Auto-sync root content/Personal to blog/content/Personal if present
    const rootPersonal = path.join(rootDir, "content", "Personal");
    const blogPersonal = path.join(contentDir, "Personal");
    if (fs.existsSync(rootPersonal)) {
      if (!fs.existsSync(blogPersonal)) fs.mkdirSync(blogPersonal, { recursive: true });
      const rootFiles = fs.readdirSync(rootPersonal);
      for (const rf of rootFiles) {
        const srcPath = path.join(rootPersonal, rf);
        const destPath = path.join(blogPersonal, rf);
        if (!fs.existsSync(destPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    // Auto-sync root "LinkedIn Insights" to blog/content/LinkedIn Insights if present
    const rootLinkedIn = path.join(rootDir, "LinkedIn Insights");
    const blogLinkedIn = path.join(contentDir, "LinkedIn Insights");
    if (fs.existsSync(rootLinkedIn)) {
      if (!fs.existsSync(blogLinkedIn)) fs.mkdirSync(blogLinkedIn, { recursive: true });
      const rootFiles = fs.readdirSync(rootLinkedIn);
      for (const rf of rootFiles) {
        if (!rf.endsWith(".md") || rf.toLowerCase() === "readme.md") continue;
        const srcPath = path.join(rootLinkedIn, rf);
        const destPath = path.join(blogLinkedIn, rf);
        if (!fs.existsSync(destPath) || fs.statSync(srcPath).mtimeMs > fs.statSync(destPath).mtimeMs) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }

    const entries = fs.readdirSync(contentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const catDir = path.join(contentDir, entry.name);
      try {
        const files = fs.readdirSync(catDir);
        for (const file of files) {
          if (!file.endsWith(".md") || file.toLowerCase() === "readme.md") continue;
          const filePath = path.join(catDir, file);
          const stats = fs.statSync(filePath);
          if (stats.size < 40) continue; // skip stubs

          const content = fs.readFileSync(filePath, "utf8");
          const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^###\s+(.+)$/m);
          const rawTitle = titleMatch ? titleMatch[1] : (entry.name + " - " + file.replace(".md", ""));
          const title = String(rawTitle).replace(/^#+\s*/, "").trim();
          const isPersonal = entry.name.toLowerCase() === "personal";

          const snippet = content.replace(/^#+.*$/gm, "").replace(/\*\*|__|\*|_/g, "").replace(/```[\s\S]*?```/g, "").trim().slice(0, 180);
          const description = snippet || ("Technical breakdown of " + title);
          const wordCount = content.split(/\s+/).filter(Boolean).length;
          const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

          let date = stats.mtime.toISOString().split("T")[0];
          const numMatch = file.match(/resources-(\d+)/i);
          const tsMatch = file.match(/(\d{13})/);
          if (tsMatch) {
            try {
              const d = new Date(parseInt(tsMatch[1], 10));
              if (!isNaN(d.getTime())) date = d.toISOString().split("T")[0];
            } catch (e) {}
          } else if (numMatch) {
            try {
              const num = parseInt(numMatch[1], 10);
              // Only consult historical commit dates for old archival collections
              if (num < 200) {
                const datesMap = require(path.join(blogDir, "lib/commit-dates-map.json"));
                if (datesMap[num]) date = datesMap[num];
              }
            } catch (e) {}
          }

          const categorySlug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
          const fileBase = file.replace(".md", "");
          const legacySlug = categorySlug + "/" + fileBase;
          const articleSeoSlug = generateSeoSlug(title, content, file, entry.name);
          const slug = categorySlug + "/" + articleSeoSlug;

          const searchKeywords = (title + " " + description + " " + entry.name + " " + content.slice(0, 600)).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");

          articles.push({
            slug,
            legacySlug,
            category: entry.name,
            categorySlug,
            filename: file,
            filePath: path.relative(rootDir, filePath),
            title,
            description,
            searchKeywords,
            date,
            readingTimeMinutes,
            wordCount,
            author: "Drishtant Ghosh (Drix10)",
            isPersonal,
            canonicalUrl: "https://blogs.drix10.com/articles/" + slug,
            mtimeMs: stats.mtimeMs
          });

          categoryCountMap.set(entry.name, {
            name: entry.name,
            slug: categorySlug,
            count: (categoryCountMap.get(entry.name)?.count || 0) + 1
          });
        }
      } catch (e) {}
    }

    // Sort newest articles first:
    // 1. By Date (YYYY-MM-DD) descending
    // 2. By Resource collection number descending (e.g. resources-242 before resources-001)
    // 3. By file modification timestamp descending
    articles.sort((a, b) => {
      if (a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }
      const numA = parseInt(a.filename.match(/resources-(\d+)/i)?.[1] || "0", 10);
      const numB = parseInt(b.filename.match(/resources-(\d+)/i)?.[1] || "0", 10);
      if (numA !== numB) {
        return numB - numA;
      }
      return (b.mtimeMs || 0) - (a.mtimeMs || 0);
    });

    const categories = Array.from(categoryCountMap.values()).sort((a, b) => b.count - a.count);

    fs.writeFileSync(
      path.join(blogDir, "lib/articles-index.json"),
      JSON.stringify({ articles, categories }),
      "utf8"
    );
    logger.info("rebuildBlogIndex: Successfully updated blog/lib/articles-index.json with " + articles.length + " articles.");
  } catch (err) {
    logger.error("rebuildBlogIndex: Failed to rebuild blog index:", err);
  }
};

module.exports = Object.freeze({
  sanitizeInput,
  handleError,
  createErrorResponse,
  logger,
  sleep,
  generateSeoSlug,
  rebuildBlogIndex,
});
