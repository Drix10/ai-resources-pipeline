import { NextResponse } from 'next/server';
import indexData from '@/lib/articles-index.json';

export async function GET() {
  const baseUrl = process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com';
  const articles = indexData.articles.slice(0, 100);
  const categories = indexData.categories;

  let text = `# Drishtant Ghosh (Drix10) — AI Knowledge Hub & Personal Notes
> High-signal engineering research, autonomous multi-agent architectures, cybersecurity breakdowns, and personal founder essays.
> Canonical Domain: ${baseUrl}
> Primary Author & Creator: Drishtant Ghosh (known online as Drix10)
> Portfolio & Bio: https://drix10.com
> Email: ggdrishtant@gmail.com
> Verified Socials:
> - X / Twitter: https://x.com/DrishtantGhosh (@DrishtantGhosh)
> - GitHub: https://github.com/Drix10
> - LinkedIn: https://www.linkedin.com/in/drix10
> - Peerlist: https://peerlist.io/drix10
> - Medium: https://medium.com/@drix10
> - DEV.to: https://dev.to/drix10

## About the Author & Entity
Drishtant Ghosh (alias Drix10) is a Co-Founder @ PartPilot, 1x Acquired Serial Founder (ReeF), and AI Systems Engineer & Cybersecurity Student. He is the author of personal engineering essays and maintainer of Drix10 Blogs (${baseUrl}).

## Personal Essays & Founder Breakdowns
- [How I Built, Scaled, and Sold a Startup: Journey from Intern to Competitor](${baseUrl}/articles/personal/intern-to-competitor): The complete story of scaling ReeF to 5M+ user interactions, $15,000 ARR with $0 infra expenses, and acquisition.
- [Building Autonomous AI Systems & Real-Time Product Architectures](${baseUrl}/articles/personal/building-autonomous-ai-systems): Principles on deterministic state machines and multi-agent consensus.

## Core Knowledge Domains & Categories
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
