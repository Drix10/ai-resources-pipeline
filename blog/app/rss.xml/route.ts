import { getAllArticles } from '@/lib/markdown';

export async function GET() {
  const allArticles = getAllArticles();
  const recentArticles = allArticles.slice(0, 150);
  const siteUrl = process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com';

  const rssItems = recentArticles
    .map((article) => `
    <item>
      <title><![CDATA[${article.title}]]></title>
      <link>${article.canonicalUrl}</link>
      <guid>${article.canonicalUrl}</guid>
      <pubDate>${new Date(article.date).toUTCString()}</pubDate>
      <description><![CDATA[${article.description}]]></description>
      <category>${article.category}</category>
    </item>`)
    .join('');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Drix10 Blogs — AI & Engineering Knowledge Hub</title>
    <link>${siteUrl}</link>
    <description>Curated technical research, system architectures, cybersecurity breakdowns, and AI engineering notes by Drix10.</description>
    <language>en</language>
    <atom:link href="${siteUrl}/rss.xml" rel="self" type="application/rss+xml"/>
    ${rssItems}
  </channel>
</rss>`;

  return new Response(rss, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 's-maxage=3600, stale-while-revalidate',
    },
  });
}
