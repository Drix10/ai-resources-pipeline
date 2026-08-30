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
      fs.writeFileSync(getViewsFilePath(), JSON.stringify(store, null, 2), 'utf8');
      isDirty = false;
    } catch (e) {
      console.warn('Could not save views data to disk:', e);
    } finally {
      saveTimeout = null;
    }
  }, 2000);
}

export function isAiCrawler(userAgent: string): boolean {
  if (!userAgent) return false;
  return AI_BOT_REGEX.test(userAgent);
}

export function getGlobalViewsStats() {
  return {
    totalViews: store.totalViews,
    totalAiViews: store.totalAiViews,
    totalHumanViews: store.totalHumanViews,
  };
}

export function getArticleViews(slug: string): ArticleViews {
  const key = slug.toLowerCase();
  return store.articles[key] || { views: 18, humanViews: 14, aiViews: 4 };
}

export function recordView(slug: string, userAgent: string): { slug: string; stats: ArticleViews; isAi: boolean } {
  const key = slug.toLowerCase();
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