import { MetadataRoute } from 'next';

export const dynamic = 'force-static';

// A sitemap may only list URLs on its own host; the blog serves its own at blogs.drix10.com/sitemap.xml.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: 'https://drix10.com', changeFrequency: 'weekly', priority: 1 }];
}
