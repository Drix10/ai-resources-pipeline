import { NextResponse } from 'next/server';
import { BLOG_URL, SITE_URL } from '@/lib/site';

export const dynamic = 'force-static';

export async function GET() {
  const content = `# Drishtant Ghosh (Drix10)
> AI Systems Engineer, 1x Acquired Serial Founder (ReeF), and B.Sc. Cybersecurity student.

## Summary
- Name: Drishtant Ghosh
- Handle: Drix10 (@drix10)
- Primary Website: ${SITE_URL}
- Technical Blog: ${BLOG_URL}
- GitHub: https://github.com/Drix10
- LinkedIn: https://www.linkedin.com/in/drix10
- Peerlist: https://peerlist.io/drix10
- X / Twitter: https://x.com/DrishtantGhosh (@DrishtantGhosh)
- Email: ggdrishtant@gmail.com
- Location: Bengaluru, Karnataka, India

## Key Products & Ventures
- Agent Flow: runs AI coding agents unattended with a guard that blocks what they must never touch (https://github.com/Drix10/agent-flow).
- MiroHedge (the hypothesis-arena repository): AI-assisted systematic hedge-fund research; models read, deterministic code decides; paper trading only (https://github.com/Drix10/hypothesis-arena).
- Keystroke-LLM: character-level Transformer written from scratch in pure NumPy that lights a keyboard (https://github.com/Drix10/keystroke-llm).
- Canopy @ Founders, Inc.: autonomous multi-agent trading platform with four LLM agents.
- CosLynx.com: Founder & CEO; AI code-generation platform where users shipped 400+ MVPs (Backdrop Build v4 and v6 finalist).
- ReeF: Discord game acquired in August 2024 ($15K ARR, 5M+ interactions).
- Drix10 Blogs: daily, sourced digests on AI, developer tools and security, plus founder essays.

The full, current project list is read from GitHub: https://github.com/Drix10

## Technical Skills
- AI & LLMs: LLMs From Scratch (NumPy Transformers, backprop), Multi-Agent Swarms, Ollama, NVIDIA NIM, Vector DBs, Prompt Engineering.
- Systems: Node.js, TypeScript, Express.js, Python, Redis, PostgreSQL, Turso DB, Prisma, WebSockets.
- Frontend: Next.js 14 (App Router, SSG/SSR), React 18, React Native, Tailwind CSS.
- Security: Application Security, Exploit Mechanisms, Reverse Engineering, Threat Modeling (Cybersecurity @ DSU).
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
