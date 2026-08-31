import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { MetadataRoute } from 'next';

export const dynamic = 'force-static';
export const revalidate = 86400;

function parseSafeDate(dateStr?: string): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = (process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com').replace(/\/+$/, '');
  const articles = getAllArticles();
  const categories = getAllCategories();

  // 1. Personal posts (100% priority)
  const personalArticles = articles
    .filter((a: any) => a.isPersonal && a.filename?.toLowerCase() !== 'readme.md')
    .map((article) => ({
      url: article.canonicalUrl || `${baseUrl}/articles/${article.slug}`,
      lastModified: parseSafeDate(article.date),
      changeFrequency: 'weekly' as const,
      priority: 1.0,
    }));

  // 2. High-value category hubs
  const categoryRoutes: MetadataRoute.Sitemap = categories.slice(0, 15).map((cat) => ({
    url: `${baseUrl}/categories/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily' as const,
    priority: 0.8,
  }));

  // 3. Top curated recent technical guides (Staged rollout for optimal indexing)
  const recentCurated = articles
    .filter((a: any) => !a.isPersonal && a.filename?.toLowerCase() !== 'readme.md')
    .slice(0, 25)
    .map((article) => ({
      url: article.canonicalUrl || `${baseUrl}/articles/${article.slug}`,
      lastModified: parseSafeDate(article.date),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...personalArticles,
    ...categoryRoutes,
    ...recentCurated,
  ];
}
