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

  const articleRoutes: MetadataRoute.Sitemap = articles.map((article) => ({
    url: article.canonicalUrl || `${baseUrl}/articles/${article.slug}`,
    lastModified: parseSafeDate(article.date),
    changeFrequency: 'weekly',
    priority: (article as any).isPersonal ? 1.0 : 0.8,
  }));

  const categoryRoutes: MetadataRoute.Sitemap = categories.map((cat) => ({
    url: `${baseUrl}/categories/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    ...categoryRoutes,
    ...articleRoutes,
  ];
}
