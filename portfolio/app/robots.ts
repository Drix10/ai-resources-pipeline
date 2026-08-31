import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = 'https://drix10.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
      {
        userAgent: ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot'],
        allow: '/',
      },
      {
        userAgent: ['ClaudeBot', 'anthropic-ai'],
        allow: '/',
      },
      {
        userAgent: ['PerplexityBot'],
        allow: '/',
      },
      {
        userAgent: ['Googlebot', 'Google-Extended'],
        allow: '/',
      },
      {
        userAgent: ['Applebot', 'Applebot-Extended'],
        allow: '/',
      },
      {
        userAgent: ['Bingbot', 'cohere-ai', 'Meta-ExternalAgent'],
        allow: '/',
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
