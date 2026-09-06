import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import indexData from './articles-index.json';

export interface ArticleSummary {
  slug: string;
  legacySlug?: string;
  category: string;
  categorySlug: string;
  filename: string;
  filePath: string;
  title: string;
  description: string;
  searchKeywords: string;
  date: string;
  isoTimestamp?: string;
  sortOrder?: number;
  readingTimeMinutes: number;
  wordCount: number;
  canonicalUrl: string;
  isPersonal?: boolean;
}

export interface Article extends ArticleSummary {
  content: string;
  htmlContent: string;
}

const renderer = new marked.Renderer();
renderer.image = ({ href, title, text }) => {
  return '<div class="my-6 text-center"><img src="' + href + '" alt="' + (text || 'Technical illustration') + '" title="' + (title || '') + '" class="rounded-xl border border-zinc-800 shadow-xl max-w-full h-auto mx-auto inline-block hover:border-zinc-700 transition-all" loading="lazy" />' + (text ? '<p class="text-xs text-zinc-500 mt-2 font-mono">' + text + '</p>' : '') + '</div>';
};
renderer.link = ({ href, title, text }) => {
  if (!href) return text || '';
  const isInternal = href.startsWith('/') || href.startsWith('https://blogs.drix10.com');
  const isExternal = href.startsWith('http') && !isInternal;
  return '<a href="' + href + '" ' + (isExternal ? 'target="_blank" rel="noopener noreferrer"' : '') + ' title="' + (title || '') + '" class="text-zinc-200 underline decoration-zinc-700 underline-offset-4 hover:decoration-zinc-300 hover:text-white transition-colors">' + text + (isExternal ? ' ↗' : '') + '</a>';
};
renderer.table = ({ header, rows }) => {
  return '<div class="my-6 overflow-x-auto rounded-lg border border-zinc-800"><table class="w-full text-left border-collapse text-xs"><thead class="bg-zinc-900/90 border-b border-zinc-800 text-zinc-300 font-semibold">' + header + '</thead><tbody class="divide-y divide-zinc-800/60 text-zinc-400 bg-zinc-950/40">' + rows + '</tbody></table></div>';
};
marked.setOptions({ gfm: true, breaks: true, renderer });

const articlesList: ArticleSummary[] = indexData.articles as ArticleSummary[];
const categoriesList = indexData.categories as { name: string; slug: string; count: number }[];
const slugMap = new Map<string, ArticleSummary>();

for (const a of articlesList) {
  // Primary SEO slug: e.g. "cs-academics/github-rest-api-updates-272"
  slugMap.set(a.slug.toLowerCase(), a);

  // Bare SEO slug without category: e.g. "github-rest-api-updates-272"
  const slugParts = a.slug.split('/');
  if (slugParts.length > 1) {
    slugMap.set(slugParts[slugParts.length - 1].toLowerCase(), a);
  }

  // Legacy counter slug: e.g. "cs-academics/resources-272"
  if (a.legacySlug) {
    slugMap.set(a.legacySlug.toLowerCase(), a);
  }

  // Legacy fileBase: e.g. "resources-272"
  const fileBase = a.filename.replace('.md', '').toLowerCase();
  slugMap.set(fileBase, a);
  slugMap.set(a.categorySlug + '/' + fileBase, a);
}

function resolveContentRootDir(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'content'))) return path.join(cwd, 'content');
  if (fs.existsSync(path.join(cwd, 'blog/content'))) return path.join(cwd, 'blog/content');
  return path.join(cwd, 'content');
}

export function getAllArticles(): ArticleSummary[] {
  return articlesList;
}

export function getArticleSummaries(): ArticleSummary[] {
  return articlesList;
}

export function getAllCategories() {
  return categoriesList;
}

export function getArticleBySlug(slugPath: string[]): Article | null {
  if (!Array.isArray(slugPath) || slugPath.length === 0) return null;
  let targetSlug = slugPath.join('/').toLowerCase();
  try {
    targetSlug = decodeURIComponent(targetSlug).toLowerCase();
  } catch (e) {}

  let summary = slugMap.get(targetSlug);
  if (!summary) {
    const lastPart = slugPath[slugPath.length - 1].toLowerCase();
    summary = slugMap.get(lastPart);
  }

  // Fallback: If slug ends with a number e.g. "-272", search by resource number
  if (!summary) {
    const lastPart = slugPath[slugPath.length - 1].toLowerCase();
    const numMatch = lastPart.match(/(?:resources-)?(\d+)$/);
    if (numMatch) {
      const paddedNum = numMatch[1].padStart(3, '0');
      const numInt = parseInt(numMatch[1], 10);
      if (slugPath.length > 1) {
        const cat = slugPath[0].toLowerCase();
        summary = slugMap.get(`${cat}/resources-${paddedNum}`) || slugMap.get(`${cat}/resources-${numInt}`);
      }
      if (!summary) {
        summary = slugMap.get(`resources-${paddedNum}`) || slugMap.get(`resources-${numInt}`);
      }
    }
  }
  if (!summary) return null;

  const contentDir = resolveContentRootDir();
  const fullPath = path.join(contentDir, summary.category, summary.filename);
  let content = '';
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch (err) {
    try {
      content = fs.readFileSync(path.join(process.cwd(), summary.filePath), 'utf8');
    } catch (e) {
      content = '# ' + summary.title + '\n\n' + summary.description;
    }
  }

  // For web blog rendering, strip the static GitHub promo section since the web
  // article page already renders the interactive React Author Card and GitHub source card.
  const cleanContentForWeb = content.replace(/(?:\r?\n)+\s*---\s*###\s*(?:🌐\s*)?(?:Read on the AI Knowledge Hub|Read More & Connect|⭐️\s*Support)[\s\S]*$/i, '').trim();

  return {
    ...summary,
    content,
    htmlContent: marked.parse(cleanContentForWeb) as string,
  };
}