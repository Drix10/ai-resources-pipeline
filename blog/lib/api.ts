import { cleanTitle, getArticleSource, stripFooter, type ArticleSummary } from './markdown';
import { absolute } from './site';

// The public, documented shape of one briefing in /api/articles, /api/categories and /llms/*.txt.
export interface ApiItem {
  title: string;
  url: string;
  slug: string;
  category: string;
  categorySlug: string;
  date: string;
  description: string;
  headlines: string[];
  sources: { title: string; url: string }[];
  content?: string;
}

export const LICENSE_NOTE = 'Data: github.com/Drix10/ai-resources (CC BY 4.0)';

// Any site or agent may read the API; content only changes with a deploy, which clears the CDN.
export const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800',
};

// Outbound links of a digest (images and links back to this site are left out).
export function extractSources(markdown: string): { title: string; url: string }[] {
  const seen = new Set<string>();
  const out: { title: string; url: string }[] = [];
  for (const m of stripFooter(markdown).matchAll(/(!?)\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
    const [, bang, text, url] = m;
    if (bang || seen.has(url) || /^https?:\/\/(www\.)?blogs\.drix10\.com/i.test(url)) continue;
    seen.add(url);
    out.push({ title: text.trim() || url, url });
  }
  return out;
}

export function toApiItem(a: ArticleSummary, withContent = false): ApiItem {
  const source = getArticleSource(a);
  return {
    title: cleanTitle(a.title),
    url: a.canonicalUrl || absolute(`/articles/${a.slug}`),
    slug: a.slug,
    category: a.category,
    categorySlug: a.categorySlug,
    date: a.date,
    description: a.description,
    headlines: a.items || [],
    sources: extractSources(source),
    ...(withContent ? { content: stripFooter(source) } : {}),
  };
}
