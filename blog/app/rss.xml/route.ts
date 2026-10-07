import { cleanTitle, getAllArticles } from '@/lib/markdown';
import { SITE_URL } from '@/lib/site';

// Text inside CDATA may not contain the terminator.
const cdata = (s: string) => String(s ?? '').replace(/\]\]>/g, ']]]]><![CDATA[>');
const xml = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function GET() {
  const allArticles = getAllArticles();
  const recentArticles = allArticles.slice(0, 150);
  const siteUrl = SITE_URL;

  const rssItems = recentArticles
    .map((article) => {
      let pubDateStr = new Date().toUTCString();
      try {
        if (article.date) {
          const d = new Date(article.date);
          if (!isNaN(d.getTime())) pubDateStr = d.toUTCString();
        }
      } catch (e) {}

      const linkUrl = article.canonicalUrl || `${siteUrl}/articles/${article.slug}`;
      return `
    <item>
      <title><![CDATA[${cdata(cleanTitle(article.title))}]]></title>
      <link>${linkUrl}</link>
      <guid>${linkUrl}</guid>
      <pubDate>${pubDateStr}</pubDate>
      <description><![CDATA[${cdata(article.description)}]]></description>
      <category>${xml(article.category)}</category>
      <author>ggdrishtant@gmail.com (Drishtant Ghosh)</author>
    </item>`;
    })
    .join('');

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Drishtant Ghosh (Drix10) — Technical Research & Engineering Hub</title>
    <link>${siteUrl}</link>
    <description>Curated technical research, system architectures, cybersecurity breakdowns, and AI engineering notes by Drishtant Ghosh (Drix10).</description>
    <language>en</language>
    <managingEditor>ggdrishtant@gmail.com (Drishtant Ghosh)</managingEditor>
    <webMaster>ggdrishtant@gmail.com (Drishtant Ghosh)</webMaster>
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
