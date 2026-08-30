import { NextResponse } from 'next/server';
import indexData from '@/lib/articles-index.json';

export async function GET() {
  const baseUrl = process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com';
  const articles = indexData.articles.slice(0, 100);
  const categories = indexData.categories;

  let text = `# drix10 / AI Knowledge Hub & Engineering Systems
> Authoritative, high-signal engineering breakdowns, AI research synthesis, and multi-agent systems architectures.
> Canonical Base URL: ${baseUrl}
> Author: Drix10 (https://www.linkedin.com/in/drix10)

## Core Domains & Topics
`;

  for (const cat of categories) {
    text += `- [${cat.name}](${baseUrl}/categories/${cat.slug}): ${cat.count} verified engineering breakdowns\n`;
  }

  text += `\n## Featured & Latest Technical Breakdowns\n`;
  for (const a of articles.slice(0, 40)) {
    text += `- [${a.title}](${baseUrl}/articles/${a.slug}): ${a.description.slice(0, 140)}...\n`;
  }

  text += `\n## Full Sitemap\n${baseUrl}/sitemap.xml\n`;

  return new NextResponse(text, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=43200',
    },
  });
}
