import fs from 'fs';
import path from 'path';
import os from 'os';
import seedData from './views-data.json';

export interface ArticleViews {
  views: number;
  humanViews: number;
  aiViews: number;
}

export interface ViewsStore {
  totalViews: number;
  totalAiViews: number;
  totalHumanViews: number;
  lastUpdated: string;
  articles: Record<string, ArticleViews>;
}

// Dynamically seed from the committed views-data.json
const BASE_TOTAL_VIEWS = typeof (seedData as any)?.totalViews === 'number' ? (seedData as any).totalViews : 8950;
const BASE_AI_VIEWS = typeof (seedData as any)?.totalAiViews === 'number' ? (seedData as any).totalAiViews : 1;
const BASE_HUMAN_VIEWS = typeof (seedData as any)?.totalHumanViews === 'number' ? (seedData as any).totalHumanViews : BASE_TOTAL_VIEWS - BASE_AI_VIEWS;

// In-memory store — survives within a single serverless lambda lifecycle.
// Initialized ONCE from seed data. NOT re-read from disk on every function call.
const store: ViewsStore = {
  totalViews: BASE_TOTAL_VIEWS,
  totalAiViews: BASE_AI_VIEWS,
  totalHumanViews: BASE_HUMAN_VIEWS,
  lastUpdated: new Date().toISOString(),
  articles: ((seedData as any)?.articles as Record<string, ArticleViews>) || {},
};

const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

function getViewsFilePath(): string {
  if (IS_SERVERLESS) {
    return path.join(os.tmpdir(), 'ai-knowledge-views.json');
  }

  const candidates = [
    path.join(process.cwd(), 'lib', 'views-data.json'),
    path.join(process.cwd(), 'blog', 'lib', 'views-data.json'),
    path.resolve(__dirname, 'views-data.json'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  return candidates[0];
}

// Load from disk ONLY on cold-start initialization for local dev.
// On serverless, the in-memory store seeded from views-data.json is the source of truth.
let initialized = false;
function initStoreOnce(): void {
  if (initialized) return;
  initialized = true;

  // On serverless, the committed seed IS the truth. Don't try to read /tmp.
  if (IS_SERVERLESS) return;

  // Local dev: try to load latest state from disk
  const filePath = getViewsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.totalViews === 'number') {
        store.totalViews = Math.max(BASE_TOTAL_VIEWS, parsed.totalViews);
        store.totalAiViews = parsed.totalAiViews || store.totalAiViews;
        store.totalHumanViews = parsed.totalHumanViews || store.totalHumanViews;
        store.articles = parsed.articles || store.articles;
        store.lastUpdated = parsed.lastUpdated || store.lastUpdated;
      }
    }
  } catch (e) {
    // Silently use seed data
  }
}

function saveStoreToDisk(): void {
  // On serverless, skip disk writes — /tmp is ephemeral and misleading
  if (IS_SERVERLESS) return;

  const filePath = getViewsFilePath();
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    // In strict read-only environments, in-memory store continues
  }
}

const AI_BOT_REGEX = /(gptbot|claudebot|perplexitybot|google-extended|bytespider|anthropic-ai|ccbot|cohere-ai|diffbot|facebookexternalhit|meta-externalagent|yandexbot|bingbot|duckduckbot|slurp|baiduspider|twitterbot|linkedinbot|embedly|quora link preview|discordbot|slackbot|telegrambot|whatsapp|applebot|curl|wget|python-requests|axios|postman|insomnia|go-http-client)/i;

export function isAiCrawler(userAgent: string): boolean {
  if (!userAgent || typeof userAgent !== 'string') return false;
  return AI_BOT_REGEX.test(userAgent.slice(0, 500));
}

function normalizeSlug(slug: string): string {
  if (!slug || typeof slug !== 'string') return '';
  let clean = slug.trim().toLowerCase();
  try {
    clean = decodeURIComponent(clean).toLowerCase().trim();
  } catch (e) {}
  clean = clean.replace(/^\/+|\/+$/g, '');
  return clean.slice(0, 180);
}

export function recordView(slug: string, userAgent: string): {
  slug: string;
  stats: ArticleViews;
  isAi: boolean;
  totalViews: number;
  totalHumanViews: number;
  totalAiViews: number;
} {
  initStoreOnce();

  const cleanSlug = normalizeSlug(slug);
  const isAi = isAiCrawler(userAgent);

  if (!store.articles[cleanSlug]) {
    store.articles[cleanSlug] = {
      views: 1,
      humanViews: isAi ? 0 : 1,
      aiViews: isAi ? 1 : 0,
    };
  } else {
    store.articles[cleanSlug].views = (store.articles[cleanSlug].views || 0) + 1;
    if (isAi) {
      store.articles[cleanSlug].aiViews = (store.articles[cleanSlug].aiViews || 0) + 1;
    } else {
      store.articles[cleanSlug].humanViews = (store.articles[cleanSlug].humanViews || 0) + 1;
    }
  }

  // Strictly monotonic increment — never go below base
  store.totalViews = Math.max(BASE_TOTAL_VIEWS, store.totalViews) + 1;
  if (isAi) {
    store.totalAiViews = (store.totalAiViews || 0) + 1;
  } else {
    store.totalHumanViews = (store.totalHumanViews || 0) + 1;
  }
  store.lastUpdated = new Date().toISOString();

  saveStoreToDisk();

  return {
    slug: cleanSlug,
    stats: { ...store.articles[cleanSlug] },
    isAi,
    totalViews: store.totalViews,
    totalHumanViews: store.totalHumanViews,
    totalAiViews: store.totalAiViews,
  };
}

export function getArticleViews(slug: string): ArticleViews {
  initStoreOnce();

  const cleanSlug = normalizeSlug(slug);
  const found = store.articles[cleanSlug] || store.articles[slug];
  if (found) {
    return { ...found };
  }
  return {
    views: 0,
    humanViews: 0,
    aiViews: 0,
  };
}

export function getGlobalViewsStats(): {
  totalViews: number;
  totalAiViews: number;
  totalHumanViews: number;
  lastUpdated: string;
} {
  initStoreOnce();

  return {
    totalViews: Math.max(BASE_TOTAL_VIEWS, store.totalViews),
    totalAiViews: store.totalAiViews,
    totalHumanViews: store.totalHumanViews,
    lastUpdated: store.lastUpdated,
  };
}
