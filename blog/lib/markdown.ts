import fs from 'fs';
import path from 'path';
import { buildSections, cleanTitle, renderMarkdown, type DigestSection } from './render';
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
  items?: string[];
  itemCount?: number;
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
  // Present when the file is a multi-item digest; empty for single essays.
  sections: DigestSection[];
}

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

export { cleanTitle };
export type { DigestSection };

export function getAllCategories() {
  return categoriesList;
}

// "2026-10-05" -> "Oct 5, 2026" (UTC so server and client agree).
export function formatDate(iso: string): string {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (isNaN(d.getTime())) return String(iso || '');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
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
      // Without a matching category only an explicit "resources-N" is accepted, so arbitrary
      // "anything-123" URLs are a 404 instead of an unbounded space of duplicate pages.
      if (!summary && /^resources-\d+$/.test(lastPart)) {
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

  // The static GitHub promo footer is replaced on the web by the author card.
  const cleanContentForWeb = content
    .replace(/(?:\r?\n)+\s*---\s*###\s*(?:🌐\s*)?(?:Read on the AI Knowledge Hub|Read More & Connect|⭐️\s*Support)[\s\S]*$/i, '')
    .trim();

  const sections = summary.isPersonal || summary.category.toLowerCase() === 'personal' ? [] : buildSections(cleanContentForWeb);

  return {
    ...summary,
    content,
    htmlContent: renderMarkdown(cleanContentForWeb),
    sections,
  };
}
