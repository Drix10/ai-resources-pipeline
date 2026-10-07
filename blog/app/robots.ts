import { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// One rule for everyone, search engines and AI crawlers alike. (A crawler-specific group would
// replace this one for that crawler, so repeating "allow" per bot would silently drop the disallows.)
// Search result pages are an endless space of thin URLs, so they are not crawled.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/search'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
