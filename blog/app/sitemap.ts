import { MetadataRoute } from 'next';
import { getAllArticles, getAllCategories } from '@/lib/markdown';

export const dynamic = 'force-static';
export const revalidate = 86400;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://blogs.drix10.com';
  const articles = getAllArticles();
  const categories = getAllCategories();

  // 1. Core Homepage & Directories
  const coreRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/categories`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${baseUrl}/llms.txt`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
  ];

  // 2. All 43 Topical Category Hubs (Image 5: Hub Page Role)
  const categoryRoutes: MetadataRoute.Sitemap = categories.map((cat) => ({
    url: `${baseUrl}/categories/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.85,
  }));

  // 3. All 740+ Technical Breakdown Articles (Image 8: 0 Orphan Pages)
  const articleRoutes: MetadataRoute.Sitemap = articles.map((article) => {
    let articleDate = new Date();
    try {
      if (article.date) {
        const parsed = new Date(article.date);
        if (!isNaN(parsed.getTime())) articleDate = parsed;
      }
    } catch (e) {}

    return {
      url: article.canonicalUrl || `${baseUrl}/articles/${article.slug}`,
      lastModified: articleDate,
      changeFrequency: 'weekly',
      priority: article.isPersonal ? 0.9 : 0.75,
    };
  });

  return [...coreRoutes, ...categoryRoutes, ...articleRoutes];
}
