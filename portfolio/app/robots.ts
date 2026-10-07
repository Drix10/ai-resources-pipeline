import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// One rule for every crawler, search engines and AI crawlers alike.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/' }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
