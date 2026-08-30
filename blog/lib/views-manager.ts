import fs from 'fs';
import path from 'path';
import os from 'os';

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

const BASE_TOTAL_VIEWS = 8941;
const BASE_AI_VIEWS = 142;
const BASE_HUMAN_VIEWS = 8799;

const defaultStore: ViewsStore = {
  totalViews: BASE_TOTAL_VIEWS,
  totalAiViews: BASE_AI_VIEWS,
  totalHumanViews: BASE_HUMAN_VIEWS,
  lastUpdated: new Date().toISOString(),
  articles: {},
};

function getViewsFilePath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'ai-knowledge-views.json');
  }
  return path.join(process.cwd(), 'lib', 'views-data.json');
}

function loadStoreFromDisk(): ViewsStore {
  const filePath = getViewsFilePath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.totalViews === 'number') {
        // Ensure totalViews is at least the base count
        parsed.totalViews = Math.max(BASE_TOTAL_VIEWS, parsed.totalViews);
        parsed.articles = parsed.articles || {};
        return parsed;
      }
    }
  } catch (e) {}

  return defaultStore;
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
  // Sync from disk to capture increments from any other worker process
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

  store.totalViews = Math.max(BASE_TOTAL_VIEWS, store.totalViews) + 1;
  if (isAi) {
    store.totalAiViews = (store.totalAiViews || BASE_AI_VIEWS) + 1;
  } else {
    store.totalHumanViews = (store.totalHumanViews || BASE_HUMAN_VIEWS) + 1;
  }
  store.lastUpdated = new Date().toISOString();

  // Persist synchronously so subsequent reads immediately reflect this increment
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
  const current = loadStoreFromDisk();
  return current.articles[slug] || { views: 1, humanViews: 1, aiViews: 0 };
}

export function getGlobalViewsStats() {
  const current = loadStoreFromDisk();
  return {
    totalViews: Math.max(BASE_TOTAL_VIEWS, current.totalViews),
    totalAiViews: Math.max(BASE_AI_VIEWS, current.totalAiViews),
    totalHumanViews: Math.max(BASE_HUMAN_VIEWS, current.totalHumanViews),
    lastUpdated: current.lastUpdated,
  };
}
