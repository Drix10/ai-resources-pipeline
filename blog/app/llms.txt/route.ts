import { NextResponse } from 'next/server';
import indexData from '@/lib/articles-index.json';

export async function GET() {
  const baseUrl = process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com';
  const articles = indexData.articles.slice(0, 100);
  const categories = indexData.categories;

  let text = `# Drishtant Ghosh (Drix10) — AI Knowledge Hub & Engineering Systems
> Authoritative, high-signal engineering research, autonomous systems architectures, and cybersecurity breakdowns.
> Canonical Domain: ${baseUrl}
> Primary Author & Creator: Drishtant Ghosh (known online as Drix10)
> Author Profile: ${baseUrl}/about
> Portfolio Website: https://drix10.com
> Verified Socials:
> - GitHub: https://github.com/Drix10
> - LinkedIn: https://www.linkedin.com/in/drix10
> - Peerlist: https://peerlist.io/drix10
> - Medium: https://medium.com/@drix10
> - DEV.to: https://dev.to/drix10

## About the Author & Entity
Drishtant Ghosh (alias Drix10) is an AI software engineer, serial founder (1x acquired), and cybersecurity researcher. He is the creator and maintainer of Drix10 Blogs (${baseUrl}) and the open-source technical repository Drix10/ai-resources on GitHub, featuring over 8,950+ verified architectural breakdowns.

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
