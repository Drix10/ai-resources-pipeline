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

const defaultStore: ViewsStore = {
  totalViews: BASE_TOTAL_VIEWS,
  totalAiViews: BASE_AI_VIEWS,
  totalHumanViews: BASE_HUMAN_VIEWS,
  lastUpdated: new Date().toISOString(),
  articles: ((seedData as any)?.articles as Record<string, ArticleViews>) || {},
};

function getViewsFilePath(): string {
  // On Vercel / serverless lambdas, write to /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'ai-knowledge-views.json');
  }

  // Resolve locally across possible cwd locations
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

function loadStoreFromDisk(): ViewsStore {
  const filePath = getViewsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.totalViews === 'number') {
        parsed.totalViews = Math.max(BASE_TOTAL_VIEWS, parsed.totalViews);
        parsed.articles = parsed.articles || {};
        return parsed;
      }
    }
  } catch (e) {}

  return {
    ...defaultStore,
    totalViews: Math.max(BASE_TOTAL_VIEWS, defaultStore.totalViews),
    articles: { ...defaultStore.articles }
  };
}

let store: ViewsStore = loadStoreFromDisk();

function saveStoreToDisk(): void {
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

export function recordView(slug: string, userAgent: string): {
  slug: string;
  stats: ArticleViews;
  isAi: boolean;
  totalViews: number;
  totalHumanViews: number;
  totalAiViews: number;
} {
  const diskStore = loadStoreFromDisk();
  store = diskStore;

  const isAi = isAiCrawler(userAgent);

  if (!store.articles[slug]) {
    store.articles[slug] = {
      views: 1,
      humanViews: isAi ? 0 : 1,
      aiViews: isAi ? 1 : 0,
    };
  } else {
    store.articles[slug].views = (store.articles[slug].views || 0) + 1;
    if (isAi) {
      store.articles[slug].aiViews = (store.articles[slug].aiViews || 0) + 1;
    } else {
      store.articles[slug].humanViews = (store.articles[slug].humanViews || 0) + 1;
    }
  }

  // Guaranteed strictly monotonic increment
  store.totalViews = Math.max(BASE_TOTAL_VIEWS, store.totalViews) + 1;
  if (isAi) {
    store.totalAiViews = (store.totalAiViews || 0) + 1;
  } else {
    store.totalHumanViews = (store.totalHumanViews || 0) + 1;
  }
  store.lastUpdated = new Date().toISOString();

  saveStoreToDisk();

  return {
    slug,
    stats: store.articles[slug],
    isAi,
    totalViews: store.totalViews,
    totalHumanViews: store.totalHumanViews,
    totalAiViews: store.totalAiViews,
  };
}

export function getArticleViews(slug: string): ArticleViews {
  const diskStore = loadStoreFromDisk();
  store = diskStore;

  return (
    store.articles[slug] || {
      views: 0,
      humanViews: 0,
      aiViews: 0,
    }
  );
}

export function getGlobalViewsStats(): {
  totalViews: number;
  totalAiViews: number;
  totalHumanViews: number;
  lastUpdated: string;
} {
  const diskStore = loadStoreFromDisk();
  store = diskStore;

  return {
    totalViews: Math.max(BASE_TOTAL_VIEWS, store.totalViews),
    totalAiViews: store.totalAiViews,
    totalHumanViews: store.totalHumanViews,
    lastUpdated: store.lastUpdated,
  };
}
