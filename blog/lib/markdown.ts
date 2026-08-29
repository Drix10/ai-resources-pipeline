import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import indexData from './articles-index.json';

export interface ArticleSummary {
  slug: string;
  category: string;
  categorySlug: string;
  filename: string;
  filePath: string;
  title: string;
  description: string;
  searchKeywords: string;
  date: string;
  readingTimeMinutes: number;
  wordCount: number;
  canonicalUrl: string;
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
  const isExternal = href && href.startsWith('http');
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
  slugMap.set(a.slug.toLowerCase(), a);
  const fileBase = a.filename.replace('.md', '').toLowerCase();
  slugMap.set(fileBase, a);
  slugMap.set(a.categorySlug + '/' + fileBase, a);
}

function resolveProjectRootDir(): string {
  const cwd = process.cwd();
  const parentPath = path.join(cwd, '..');
  if (fs.existsSync(path.join(parentPath, 'AI Developer Tools')) || fs.existsSync(path.join(parentPath, 'config'))) {
    return parentPath;
  }
  if (fs.existsSync(path.join(cwd, 'AI Developer Tools')) || fs.existsSync(path.join(cwd, 'blog'))) {
    return cwd;
  }
  return parentPath;
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
  if (!summary) return null;

  const rootDir = resolveProjectRootDir();
  const fullPath = path.join(rootDir, summary.filePath);
  let content = '';
  try {
    content = fs.readFileSync(fullPath, 'utf8');
  } catch (err) {
    content = '# ' + summary.title + '\n\n' + summary.description;
  }

  return {
    ...summary,
    content,
    htmlContent: marked.parse(content) as string,
  };
}