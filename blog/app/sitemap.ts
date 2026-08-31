import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { MetadataRoute } from 'next';

export const dynamic = 'force-static';
export const revalidate = 86400;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com';
  const articles = getAllArticles();
  const categories = getAllCategories();

  const articleRoutes: MetadataRoute.Sitemap = articles.map((article) => ({
    url: article.canonicalUrl,
    lastModified: new Date(article.date),
    changeFrequency: 'weekly',
    priority: 0.9,
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
    {
      url: `${baseUrl}/about`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.95,
    },
    ...categoryRoutes,
    ...articleRoutes,
  ];
}
