import { getAllCategories } from '@/lib/markdown';
import { MetadataRoute } from 'next';

export const dynamic = 'force-static';
export const revalidate = 86400;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://blogs.drix10.com';
  const categories = getAllCategories();

  // 1. Root & Personal Founder Essays (Top Priority)
  const coreRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/articles/personal/intern-to-competitor`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/articles/personal/building-autonomous-ai-systems`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
  ];

  // 2. Category Hub Silos (Google traverses all 520+ articles through these 42 category hubs)
  const categoryRoutes: MetadataRoute.Sitemap = categories.map((cat) => ({
    url: `${baseUrl}/categories/${cat.slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  return [...coreRoutes, ...categoryRoutes];
}
