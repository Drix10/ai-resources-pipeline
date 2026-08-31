import { MetadataRoute } from 'next';
import indexData from '@/lib/articles-index.json';

export const dynamic = 'force-static';
export const revalidate = 86400;

function parseSafeDate(dateStr?: string): Date {
  if (!dateStr) return new Date();
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://drix10.com';
  const blogBaseUrl = 'https://blogs.drix10.com';
  
  const articles = Array.isArray(indexData?.articles) ? indexData.articles : [];
  const categories = Array.isArray(indexData?.categories) ? indexData.categories : [];

  const mainPages: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  const blogArticleRoutes: MetadataRoute.Sitemap = articles
    .filter((a: any) => a.filename?.toLowerCase() !== 'readme.md')
    .map((article: any) => ({
      url: article.canonicalUrl || `${blogBaseUrl}/articles/${article.slug}`,
      lastModified: parseSafeDate(article.date),
      changeFrequency: 'weekly',
      priority: article.isPersonal ? 1.0 : 0.8,
    }));

  const blogCategoryRoutes: MetadataRoute.Sitemap = categories.map((cat: any) => ({
    url: `${blogBaseUrl}/categories/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.7,
  }));

  return [
    ...mainPages,
    ...blogCategoryRoutes,
    ...blogArticleRoutes,
  ];
}
