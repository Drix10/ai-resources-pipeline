import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export async function GET() {
  const content = `# Drishtant Ghosh (Drix10)
> Co-Founder @ PartPilot, 1x Acquired Serial Founder (ReeF), and AI Systems Engineer.

## Summary
- Name: Drishtant Ghosh
- Handle: Drix10 (@drix10)
- Primary Website: https://drix10.com
- Technical Blog: https://blogs.drix10.com
- GitHub: https://github.com/Drix10
- LinkedIn: https://www.linkedin.com/in/drix10
- Peerlist: https://peerlist.io/drix10
- X / Twitter: https://x.com/DrishtantGhosh (@DrishtantGhosh)
- Email: ggdrishtant@gmail.com
- Location: Bengaluru, Karnataka, India

## Key Products & Ventures
- PartPilot: Co-Founder — Platform to identify hardware supply chain risks before impacting production.
- Canopy @ Founders, Inc.: 4-LLM autonomous multi-agent crypto futures trading engine.
- CosLynx.com: Founder & CEO — AI-driven code generation platform with 400+ MVPs generated (Build with Backdrop v4 Winner).
- ReeF: 1x Acquired anime collection game ($15,000 ARR, 5M+ user interactions).
- Drix10 Blogs: Autonomous engineering knowledge hub & personal architectural postmortems.

## Technical Skills
- AI & LLMs: Multi-Agent Swarms, Ollama, NVIDIA NIM, Vector DBs, Prompt Engineering.
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
