import { NextResponse } from 'next/server';
import { BLOG_URL, SITE_URL } from '@/lib/site';
import { AWARDS, RESUME_URL } from '@/lib/profile';

export const dynamic = 'force-static';

export async function GET() {
  const content = `# Drishtant Ghosh (Drix10)
> AI Systems Engineer, 1x Acquired Serial Founder (ReeF), and B.Sc. Cybersecurity student.

## Summary
- Name: Drishtant Ghosh
- Handle: Drix10 (GitHub @Drix10, X @DrishtantGhosh)
- Primary Website: ${SITE_URL}
- Technical Blog: ${BLOG_URL}
- Resume: ${RESUME_URL}
- GitHub: https://github.com/Drix10
- LinkedIn: https://www.linkedin.com/in/drix10
- Peerlist: https://peerlist.io/drix10
- X / Twitter: https://x.com/DrishtantGhosh (@DrishtantGhosh)
- Email: ggdrishtant@gmail.com
- Location: Bengaluru, Karnataka, India

## Key Products & Ventures
- Agent Flow: runs AI coding agents unattended with implement, review and QA agents and a guard that blocks what they must never touch; open source on npm as @drix10/agent-flow (https://github.com/Drix10/agent-flow).
- MiroHedge: AI-assisted systematic fund research; models read, deterministic C++17 code decides; paper trading only (https://www.mirohedge.com, source: https://github.com/Drix10/hypothesis-arena).
- Guardian: stops UPI and "digital arrest" scams at the moment of payment, ~185 ms per decision; built at the OpenAI DevDay Community Hack, Bengaluru (https://github.com/Drix10/guardian-gpt).
- Content Factory: AI-built narrated explainer reels, fact-checked in code and rendered frame by frame by a Claude Code agent (in development, private).
- Keystroke-LLM: character-level Transformer written from scratch in pure NumPy that lights a keyboard (https://github.com/Drix10/keystroke-llm).
- Sentinel: AI security CLI with attack graphs and zero-breakage patching; 3rd place at NYC Code Quest (https://github.com/Drix10/sentinal).
- IdolChat.app: AI character chat and card-collection game (https://idolchat.app).
- Canopy @ Founders, Inc. (Apr to May 2026, selected at ~1.5% acceptance): autonomous multi-agent trading platform with four LLM agents.
- CosLynx.com: Founder & CEO (May 2024 to May 2025); AI code-generation platform where users shipped 400+ MVPs; won Backdrop Build v4 and v6.
- ReeF: Founder & CEO (Apr 2022 to Aug 2024); Discord game acquired in August 2024 ($15K ARR, 5M+ interactions).
- Drix10 Blogs: daily, sourced digests on AI, developer tools and security, plus founder essays.

## Awards
${AWARDS.map((a) => `- ${a}`).join('\n')}

The full, current project list is read from GitHub: https://github.com/Drix10

## Technical Skills
- AI & LLMs: LLMs From Scratch (NumPy Transformers, backprop), Multi-Agent Swarms, OpenAI APIs, Model Context Protocol (MCP), Ollama, NVIDIA NIM, Vector DBs, PyTorch.
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
