const winston = require("winston");

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
 * @returns {string} - The sanitized string. Returns an empty string if input is invalid.
 */
const sanitizeInput = (input) => {
  if (typeof input !== "string") {
    logger.error(
      "Invalid input type for sanitizeInput: Expected string, got",
      typeof input
    );
    return "";
  }

  if (!input.trim()) {
    return "";
  }

  const sanitizedInput = input
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/\//g, "&#x2F;")
    .replace(/\\/g, "&#x5C;")
    .replace(/`/g, "&#x60;");

  return sanitizedInput;
};

/**
 * Handles errors gracefully and logs them using Winston.
 * @param {Error} error - The error object.
 * @param {string} message - A message to log.
 * @param {Object} [additionalContext] - Optional additional context for the error.
 */
const handleError = (
  error,
  message = "An error occurred",
  additionalContext = {}
) => {
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
 * @param {string} message - The error message.
 * @param {number} [statusCode=500] - The HTTP status code.
 * @param {Object} [details] - Additional error details.
 * @returns {Object} Standardized error response object.
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

module.exports = Object.freeze({
  sanitizeInput,
  handleError,
  createErrorResponse,
  logger,
  sleep,
});

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

    const contentDir = path.join(blogDir, 'content');
    const entries = fs.readdirSync(contentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || ignored.has(entry.name)) continue;
      const catDir = path.join(contentDir, entry.name);
      try {
        const files = fs.readdirSync(catDir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const filePath = path.join(catDir, file);
          const stats = fs.statSync(filePath);
          if (stats.size < 40) continue; // skip stubs

          const content = fs.readFileSync(filePath, "utf8");
          const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^###\s+(.+)$/m);
          const rawTitle = titleMatch ? titleMatch[1] : (entry.name + " - " + file.replace(".md", ""));
          const title = String(rawTitle).replace(/^#+\s*/, "").trim();

          const snippet = content.replace(/^#+.*$/gm, "").replace(/\*\*|__|\*|_/g, "").replace(/```[\s\S]*?```/g, "").trim().slice(0, 180);
          const description = snippet || ("Technical breakdown of " + title);
          const wordCount = content.split(/\s+/).filter(Boolean).length;
          const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
          // Extract authentic GitHub commit date
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
              const datesMap = require(path.join(blogDir, "lib/commit-dates-map.json"));
              const num = parseInt(numMatch[1], 10);
              if (datesMap[num]) date = datesMap[num];
            } catch (e) {}
          }

          const categorySlug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
          const fileBase = file.replace(".md", "");
          const articleSlug = fileBase.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
          const slug = categorySlug + "/" + (articleSlug || fileBase);

          const searchKeywords = (title + " " + description + " " + entry.name + " " + content.slice(0, 600)).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");

          articles.push({
            slug,
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
            canonicalUrl: "https://blogs.drix10.com/articles/" + slug
          });

          categoryCountMap.set(entry.name, {
            name: entry.name,
            slug: categorySlug,
            count: (categoryCountMap.get(entry.name)?.count || 0) + 1
          });
        }
      } catch (e) {}
    }

    articles.sort((a, b) => b.date.localeCompare(a.date));
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
