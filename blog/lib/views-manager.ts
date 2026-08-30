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

// Baseline fallback in case views-data.json is not present
const defaultStore: ViewsStore = {
  totalViews: 8941,
  totalAiViews: 142,
  totalHumanViews: 8799,
  lastUpdated: new Date().toISOString(),
  articles: {},
};

function getViewsFilePath(): string {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'views-data.json');
  }
  return path.join(process.cwd(), 'lib', 'views-data.json');
}

function loadInitialStore(): ViewsStore {
  try {
    const filePath = getViewsFilePath();
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {}

  // Try local fallback
  try {
    const localPath = path.join(process.cwd(), 'lib', 'views-data.json');
    if (fs.existsSync(localPath)) {
      const data = fs.readFileSync(localPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) {}

  return defaultStore;
}

let store: ViewsStore = loadInitialStore();
let saveTimeout: NodeJS.Timeout | null = null;

function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    try {
      const filePath = getViewsFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(store, null, 2), 'utf8');
      try {
        fs.renameSync(tempPath, filePath);
      } catch (err: any) {
        if (['EEXIST', 'EPERM'].includes(err.code)) {
          fs.rmSync(filePath, { force: true });
          fs.renameSync(tempPath, filePath);
        } else {
          throw err;
        }
      }
    } catch (e) {
      // In read-only runtime, in-memory counter continues uninterrupted
    } finally {
      saveTimeout = null;
    }
  }, 2000);

  if (saveTimeout?.unref) {
    saveTimeout.unref();
  }
}

const AI_BOT_REGEX = /(gptbot|claudebot|perplexitybot|google-extended|bytespider|anthropic-ai|ccbot|cohere-ai|diffbot|facebookexternalhit|meta-externalagent|yandexbot|bingbot|duckduckbot|slurp|baiduspider|twitterbot|linkedinbot|embedly|quora link preview|discordbot|slackbot|telegrambot|whatsapp|applebot|curl|wget|python-requests|axios|postman|insomnia|go-http-client)/i;

export function isAiCrawler(userAgent: string): boolean {
  if (!userAgent || typeof userAgent !== 'string') return false;
  return AI_BOT_REGEX.test(userAgent.slice(0, 500));
}

export function recordView(slug: string, userAgent: string): { slug: string; stats: ArticleViews; isAi: boolean } {
  const isAi = isAiCrawler(userAgent);
  if (!store.articles[slug]) {
    store.articles[slug] = { views: 1, humanViews: isAi ? 0 : 1, aiViews: isAi ? 1 : 0 };
  } else {
    store.articles[slug].views += 1;
    if (isAi) {
      store.articles[slug].aiViews += 1;
    } else {
      store.articles[slug].humanViews += 1;
    }
  }

  store.totalViews += 1;
  if (isAi) {
    store.totalAiViews += 1;
  } else {
    store.totalHumanViews += 1;
  }
  store.lastUpdated = new Date().toISOString();

  scheduleSave();
  return { slug, stats: store.articles[slug], isAi };
}

export function getArticleViews(slug: string): ArticleViews {
  return store.articles[slug] || { views: 1, humanViews: 1, aiViews: 0 };
}

export function getGlobalViewsStats() {
  return {
    totalViews: store.totalViews,
    totalAiViews: store.totalAiViews,
    totalHumanViews: store.totalHumanViews,
    lastUpdated: store.lastUpdated,
  };
}
