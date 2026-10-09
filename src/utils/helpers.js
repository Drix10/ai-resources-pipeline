const winston = require("winston");
const fs = require("fs");
const path = require("path");

// logger.error("Step failed:", err.message) is used all over the codebase, and winston drops a
// string passed after the message. Fold every extra argument into the message instead.
const SPLAT = Symbol.for("splat");
const foldExtras = winston.format((info) => {
  const extras = info[SPLAT];
  if (Array.isArray(extras) && extras.length) {
    const parts = extras
      .map((x) => (x instanceof Error ? x.stack || x.message : x && typeof x === "object" ? (() => { try { return JSON.stringify(x); } catch { return String(x); } })() : String(x)))
      .filter((p) => p && !String(info.message).includes(p));
    if (parts.length) info.message = `${info.message} ${parts.join(" ")}`;
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    foldExtras(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "helpers" },
  transports: [
    // Test runs (node --test sets NODE_TEST_CONTEXT) must not write into the live bot's logs.
    ...(process.env.NODE_TEST_CONTEXT ? [] : [
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
    ]),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
  exitOnError: false,
});
// A full disk or a log file another program holds must never crash the long-running process.
logger.on("error", () => {});

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

// Read from env at call time: requiring config here would make every script
// that loads helpers fail without GitHub credentials, and helpers can load
// before dotenv runs. Same default as config.
const canonicalBaseUrl = () => (process.env.CANONICAL_BASE_URL || "https://blogs.drix10.com").replace(/\/$/, "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Credentials, webhook URLs, private keys and internal IPs must never reach a
// public commit. Applied to generated markdown and again right before upload.
const SECRET_PATTERNS = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]"],
  [/https?:\/\/(?:(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks|hooks\.slack\.com\/(?:services|workflows|triggers))\/[^\s)\]>"'`]+/gi, "[REDACTED WEBHOOK]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, "[REDACTED]"],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, "[REDACTED]"],
  [/\bsk-(?:ant-|proj-|or-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  [/\bnvapi-[A-Za-z0-9_-]{20,}/g, "[REDACTED]"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, "[REDACTED]"],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, "[REDACTED]"],
  [/\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g, "[REDACTED]"],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED JWT]"],
  // key = "literal": only a quoted literal is a leaked value (process.env.X and function calls are code).
  [/\b((?:api[_-]?key|secret|access[_-]?token|auth[_-]?token|password|passwd)["']?\s*[:=]\s*["'])[A-Za-z0-9_\-\/+=]{16,}(?=["'])/gi, "$1[REDACTED]"],
  // .env style: NAME_KEY=value on its own line, but only when the value looks like a real secret.
  [/^([A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)\s*=\s*)(?=[A-Za-z0-9_\-\/+=]*\d)(?=[A-Za-z0-9_\-\/+=]*[A-Za-z])[A-Za-z0-9_\-\/+=]{20,}$/gm, "$1[REDACTED]"],
  [/(https?:\/\/)[^\s\/:@]+:[^\s\/@]+@/gi, "$1[REDACTED]@"],
  [/\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g, "[internal IP]"],
];

const redactSecrets = (text) => {
  if (!text || typeof text !== "string") return text;
  let out = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) out = out.replace(pattern, replacement);
  return out;
};

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
const stripEmoji = (s) => String(s || "").replace(/^[\p{Extended_Pictographic}️‍\s]+/u, "").trim();
const cutAtSentence = (text, max) => {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const stop = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "));
  if (stop > max * 0.5) return head.slice(0, stop + 1);
  return head.replace(/\s+\S*$/, "") + "...";
};

/**
 * A digest file holds several "### " items. Returns the item titles plus a clean
 * one-paragraph summary (the first item's opening paragraph) for listings.
 */
const PLACEHOLDER_TITLE = /^(?:category\s*[-:]\s*)?specific topic$/i;

const parseDigestItems = (content) => {
  // Split on "### " lines that are outside fenced code, exactly as the blog does when it renders.
  const raw = [];
  let fence = null;
  for (const line of String(content || "").split(/\r?\n/)) {
    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && line.trim() === open[1]) fence = null;
    } else if (open) {
      fence = open[1];
    }
    const heading = !fence && !open && line.match(/^###\s+(.+)$/);
    if (heading) raw.push({ title: heading[1], lines: [] });
    else if (raw.length) raw[raw.length - 1].lines.push(line);
  }

  const items = [];
  for (const item of raw) {
    const title = stripEmoji(item.title.replace(/\*\*/g, ""));
    if (!title || PLACEHOLDER_TITLE.test(title) || /^(read more|read on the|support)/i.test(title)) continue;
    const body = item.lines.join("\n").trim();
    if (!body) continue; // the blog drops empty items, so they must not be counted here either
    const para = body.split(/\n\s*\n/).map((p) => p.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim())
      .find((p) => p.length > 40 && !/^(key points|🔗|resources|-|\*|•|\d+\.)/i.test(p));
    items.push({ title: title.slice(0, 120), summary: cutAtSentence(para || "", 170) });
  }
  const lead = items.find((i) => i.summary);
  return { items, summary: lead ? cutAtSentence(lead.summary, 200) : "" };
};

const isPersonalEntry = (name) => String(name).toLowerCase() === "personal";

const rebuildBlogIndex = () => {
  try {
    const rootDir = path.resolve(__dirname, "../../");
    const blogDir = path.join(rootDir, "blog");
    if (!fs.existsSync(blogDir)) return;

    const ignored = new Set(["node_modules", ".git", ".next", ".gemini", "blog", "config", "src", "utils", "tests", "logs", "linkedin-previews", "scratch", "temp", "tracker"]);
    const articles = [];
    const seenSlugs = new Set();
    const categoryCountMap = new Map();

    const contentDir = path.join(blogDir, "content");
    if (!fs.existsSync(contentDir)) return;

    let datesMap = null;
    try {
      const datesMapPath = path.join(blogDir, "lib", "commit-dates-map.json");
      if (fs.existsSync(datesMapPath)) {
        datesMap = JSON.parse(fs.readFileSync(datesMapPath, "utf8"));
      }
    } catch (e) {}

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
          const parsed = parseDigestItems(content);
          const titleMatch = content.match(/^#\s+(.+)$/m);
          const rawTitle = isPersonalEntry(entry.name) && titleMatch
            ? titleMatch[1]
            : (parsed.items[0] && parsed.items[0].title) || (titleMatch && titleMatch[1]) || (entry.name + " - " + file.replace(".md", ""));
          const title = String(rawTitle).replace(/^#+\s*/, "").trim();
          const isPersonal = entry.name.toLowerCase() === "personal";

          const { items, summary } = parsed;
          const description = summary || ("Technical breakdown of " + title);
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
              if (num < 200 && datesMap && datesMap[num]) {
                date = datesMap[num];
              }
            } catch (e) {}
          }

          const categorySlug = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
          const fileBase = file.replace(".md", "");
          const legacySlug = categorySlug + "/" + fileBase;
          const articleSeoSlug = generateSeoSlug(title, content, file, entry.name);
          let slug = categorySlug + "/" + articleSeoSlug;
          for (let n = 2; seenSlugs.has(slug); n++) slug = categorySlug + "/" + articleSeoSlug + "-" + n;
          seenSlugs.add(slug);

          const searchKeywords = (title + " " + description + " " + entry.name + " " + items.map((i) => i.title).join(" ") + " " + content.slice(0, 600)).toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");

          articles.push({
            slug,
            legacySlug,
            category: entry.name,
            categorySlug,
            filename: file,
            filePath: path.relative(rootDir, filePath),
            title,
            description,
            items: items.slice(0, 10).map((i) => i.title),
            itemCount: items.length,
            searchKeywords,
            date,
            readingTimeMinutes,
            wordCount,
            author: "Drishtant Ghosh (Drix10)",
            isPersonal,
            canonicalUrl: canonicalBaseUrl() + "/articles/" + slug,
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
      JSON.stringify({ articles: articles.map(({ mtimeMs, ...rest }) => rest), categories }),
      "utf8"
    );
    logger.info("rebuildBlogIndex: Successfully updated blog/lib/articles-index.json with " + articles.length + " articles.");
  } catch (err) {
    logger.error("rebuildBlogIndex: Failed to rebuild blog index:", err);
  }
};

// English-only gate for LinkedIn engagement. Rejects text written mostly in another script, and
// Latin-script text whose function words are clearly Spanish, Portuguese, French, German, Italian
// or Dutch. Short or all-technical text passes: it carries no language signal to reject.
const EN_WORDS = new Set("the and to of in is for that with on are this it as be we you at by from not have has can will but or an our your their about more how what new just was were been into than they them its who when which one all out up so if do does".split(" "));
const FOREIGN_WORDS = new Set((
  "el la los las de del que y en un una es por con para se no su al lo como mas pero sus le les des du et est une pour dans qui sur pas plus ce cette sont avec nous vous " +
  "der die das und ist nicht ein eine mit von zu den dem auf fur auch sich im es wie wir sie ich aber oder bei nach " +
  "o os as da do dos das em um uma nao para com por mais mas uma seu sua voce nos ao " +
  "il lo gli di che non per con una sono questo anche come ma " +
  "het een van en dat niet voor met zijn ook maar"
).split(" "));
function isEnglish(text) {
  const clean = String(text || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[@#]\w+/g, " ")
    .normalize("NFKC");
  const letters = clean.match(/\p{L}/gu) || [];
  if (letters.length === 0) return true;
  const latin = clean.match(/\p{Script=Latin}/gu) || [];
  if ((letters.length - latin.length) / letters.length > 0.15) return false;
  let en = 0, foreign = 0;
  for (const w of clean.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").match(/[a-z]+/g) || []) {
    if (EN_WORDS.has(w)) en++;
    if (FOREIGN_WORDS.has(w) && !EN_WORDS.has(w)) foreign++;
  }
  return !(foreign >= 2 && foreign > en);
}

module.exports = Object.freeze({
  sanitizeInput,
  handleError,
  createErrorResponse,
  logger,
  sleep,
  redactSecrets,
  generateSeoSlug,
  rebuildBlogIndex,
  parseDigestItems,
  isEnglish,
});
