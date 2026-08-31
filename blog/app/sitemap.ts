import { MetadataRoute } from 'next';

export const dynamic = 'force-static';
export const revalidate = 86400;

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = 'https://blogs.drix10.com';

  // 1. Core Homepage & Personal Pillar
  const coreRoutes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/categories/personal`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
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

  // 2. Primary Curated Category Hubs
  const pillarCategories = [
    'ai-developer-tools',
    'founders-and-entrepreneurs',
    'cybersecurity-and-tech',
    'tech-infrastructure',
    'ai-education',
    'computer-vision-and-ai-applications',
    'decentralized-ai',
    'devs-designers-devrel',
    'crypto-and-web3',
    'cs-academics',
  ];

  const categoryRoutes: MetadataRoute.Sitemap = pillarCategories.map((slug) => ({
    url: `${baseUrl}/categories/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'daily',
    priority: 0.8,
  }));

  return [...coreRoutes, ...categoryRoutes];
}
