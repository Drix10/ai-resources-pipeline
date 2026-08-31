import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export async function GET() {
  const content = `# Drishtant Ghosh (Drix10)
> AI Software Engineer, 1x Acquired Serial Founder, and Cybersecurity Researcher.

## Summary
- Name: Drishtant Ghosh
- Handle: Drix10 (@drix10)
- Primary Website: https://drix10.com
- Technical Blog: https://blogs.drix10.com
- GitHub: https://github.com/Drix10
- LinkedIn: https://www.linkedin.com/in/drix10
- Peerlist: https://peerlist.io/drix10
- X / Twitter: https://x.com/Drix_10

## Key Products & Ventures
- CosLynx: AI-powered autonomous codebase intelligence & multi-agent debugging.
- ReeF: Scalable anime Discord ecosystem platform (1x Acquired).
- Canopy @ f.inc: High-throughput financial infrastructure and analytics.
- Drix10 Blogs: Autonomous engineering curation engine with 8,950+ technical breakdowns.

## Technical Skills
- AI & LLMs: Multi-Agent Swarms, Ollama, NVIDIA NIM, Vector DBs, Prompt Engineering.
- Systems: Node.js, TypeScript, Python, Rust, Redis, PostgreSQL, Docker, Microservices.
- Frontend: Next.js 14 (App Router, SSG/SSR), React 18, Tailwind CSS, CSS Cascade Layers.
- Security: Application Security, Exploit Mechanisms, Reverse Engineering, Threat Modeling.
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
