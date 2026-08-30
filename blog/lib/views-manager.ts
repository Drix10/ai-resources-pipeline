import fs from 'fs';
import path from 'path';
import viewsInitialData from './views-data.json';

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

// Bounded regex targeting known AI crawlers and bots
const AI_BOT_REGEX = /(gptbot|claudebot|perplexitybot|google-extended|bytespider|anthropic-ai|ccbot|cohere-ai|diffbot|facebookexternalhit|meta-externalagent|yandexbot|bingbot|duckduckbot|slurp|baiduspider|twitterbot|linkedinbot|embedly|quora link preview|discordbot|slackbot|telegrambot|whatsapp|applebot|curl|wget|python-requests|axios|postman|insomnia|go-http-client)/i;

let store: ViewsStore = viewsInitialData as ViewsStore;
let isDirty = false;
let saveTimeout: NodeJS.Timeout | null = null;

function getViewsFilePath(): string {
  return path.join(process.cwd(), 'lib/views-data.json');
}

function scheduleSave() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    try {
      const filePath = getViewsFilePath();
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
      isDirty = false;
    } catch (e) {
      // In read-only serverless runtime, memory store continues uninterrupted
    } finally {
      saveTimeout = null;
    }
  }, 2000);

  if (saveTimeout?.unref) {
    saveTimeout.unref();
  }
}

export function isAiCrawler(userAgent: string): boolean {
  if (!userAgent || typeof userAgent !== 'string') return false;
  // Bounded slice to prevent ReDoS on maliciously crafted giant user-agents
  const sanitized = userAgent.slice(0, 500);
  return AI_BOT_REGEX.test(sanitized);
}

export function getGlobalViewsStats() {
  return {
    totalViews: store.totalViews,
    totalAiViews: store.totalAiViews,
    totalHumanViews: store.totalHumanViews,
  };
}


const MAX_ARTICLES_LIMIT = 50000;
function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-_/]{2,180}$/i.test(slug);
}

function normalizeSlug(slug: string): string {
  let clean = String(slug || '').toLowerCase().trim();
  try {
    clean = decodeURIComponent(clean).toLowerCase().trim();
  } catch (e) {}
  return clean.slice(0, 200);
}

export function getArticleViews(slug: string): ArticleViews {
  const key = normalizeSlug(slug);
  return store.articles[key] || { views: 1, humanViews: 1, aiViews: 0 };
}

export function recordView(slug: string, userAgent: string): { slug: string; stats: ArticleViews; isAi: boolean } {
  const key = normalizeSlug(slug);
  if (!key || !isValidSlug(key) || Object.keys(store.articles).length >= MAX_ARTICLES_LIMIT) {
    return {
      slug: '',
      stats: { views: 1, humanViews: 1, aiViews: 0 },
      isAi: false,
    };
  }

  const isAi = isAiCrawler(userAgent);

  if (!store.articles[key]) {
    store.articles[key] = { views: 0, humanViews: 0, aiViews: 0 };
  }

  store.articles[key].views += 1;
  store.totalViews += 1;

  if (isAi) {
    store.articles[key].aiViews += 1;
    store.totalAiViews += 1;
  } else {
    store.articles[key].humanViews += 1;
    store.totalHumanViews += 1;
  }

  isDirty = true;
  scheduleSave();

  return {
    slug: key,
    stats: store.articles[key],
    isAi,
  };
}
