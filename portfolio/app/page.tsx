import Image from 'next/image';
import Link from 'next/link';
import RoleCycle from '@/components/RoleCycle';
import LocalTimeBadge from '@/components/LocalTimeBadge';
import ProjectsExplorer from '@/components/ProjectsExplorer';
import GitHubActivity from '@/components/GitHubActivity';
import ContactCard from '@/components/ContactCard';

export default function HomePage() {
  return (
    <div className="space-y-16 sm:space-y-20">
      {/* 1. Hero Section */}
      <section id="about" className="space-y-6 pt-4 sm:pt-6">
        <div className="flex items-center justify-between">
          <LocalTimeBadge />
          <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-500">
            <span>Press</span>
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300">
              ⌘K
            </kbd>
            <span>for quick menu</span>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <Image
            src="/avatar.png"
            alt="Drishtant Ghosh (Drix10)"
            width={112}
            height={112}
            priority
            className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover border-2 border-zinc-700 shadow-2xl shadow-zinc-950"
          />
          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-100">
                Drishtant Ghosh
              </h1>
              <span className="px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 font-mono text-xs text-zinc-300 font-semibold">
                @Drix10
              </span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-[11px] font-mono text-emerald-400 font-medium">
                📍 Bengaluru, India
              </span>
            </div>

            <div className="flex items-center gap-2 text-sm sm:text-base font-medium">
              <RoleCycle />
            </div>

            <p className="text-xs sm:text-sm text-zinc-300 max-w-2xl leading-relaxed">
              I build AI systems and full-stack products that turn complex workflows into usable software. My work spans multi-agent swarms, LLM orchestration, real-time distributed applications, developer tooling, and high-concurrency cloud infrastructure.
            </p>
          </div>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2">
          <a
            href="#projects"
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs font-mono transition-colors shadow-lg shadow-emerald-950/40 flex items-center gap-1.5"
          >
            <span>⚡ View Systems & Code</span>
            <span>↓</span>
          </a>
          <a
            href="https://github.com/Drix10"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>GitHub (@Drix10)</span>
          </a>
          <a
            href="https://www.linkedin.com/in/drix10"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>LinkedIn</span>
          </a>
          <a
            href="https://x.com/DrishtantGhosh"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>X / Twitter</span>
          </a>
          <a
            href="https://blogs.drix10.com"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-emerald-400 text-xs font-mono font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>Technical Writing</span>
            <span>↗</span>
          </a>
        </div>
      </section>

      {/* 2. Key Numbers & Metrics Ribbon */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-emerald-400">1x Acquired</div>
          <div className="text-[11px] text-zinc-500 font-medium">ReeF ($15k ARR, 5M+ reqs)</div>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-zinc-100">400+</div>
          <div className="text-[11px] text-zinc-500 font-medium">CosLynx MVP Deployments</div>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-zinc-100">5M+</div>
          <div className="text-[11px] text-zinc-500 font-medium">Production User Actions</div>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-emerald-400">2x 🏆</div>
          <div className="text-[11px] text-zinc-500 font-medium">International Hackathons</div>
        </div>
      </section>

      {/* 3. Work Experience & Startups Timeline */}
      <section id="experience" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            01. Professional Experience & Founder Journey
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Track record of founding, scaling, and architecting systems.
          </p>
        </div>

        <div className="space-y-6 border-l-2 border-zinc-800 pl-4 sm:pl-6 ml-2 sm:ml-4">
          {/* PartPilot */}
          <div className="relative space-y-2">
            <div className="absolute -left-[23px] sm:-left-[31px] top-1.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-zinc-100">Co-Founder — PartPilot</h3>
                <span className="text-xs text-zinc-400 font-medium">Remote • Self-Employed</span>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                Apr 2026 — Present
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Co-founded PartPilot, a platform designed to identify supply chain risks before they impact production. Developing a comprehensive intelligence tool for engineering, sourcing, compliance, and supply chain teams to manage component risk.
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Computer Hardware</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Start-up Leadership</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Supply Chain AI</span>
            </div>
          </div>

          {/* Canopy @ Founders, Inc. */}
          <div className="relative space-y-2 pt-4">
            <div className="absolute -left-[23px] sm:-left-[31px] top-5.5 w-3 h-3 rounded-full bg-zinc-400 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-zinc-100">AI Systems Architect — Canopy (Founders, Inc.)</h3>
                <span className="text-xs text-zinc-400 font-medium">San Francisco / Remote</span>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                Apr 2026 — May 2026
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Architected autonomous AI trading platform, integrating 4 LLM models with 4 different methodology agents for real-time WEEX crypto futures. Implemented WebSockets for live market event streams and Prisma with Turso DB, optimizing trade execution and multi-agent decision consensus.
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">LLM Multi-Agent Swarms</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">WebSockets</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Turso DB & Prisma</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Trading Systems</span>
            </div>
          </div>

          {/* CosLynx.com */}
          <div className="relative space-y-2 pt-4">
            <div className="absolute -left-[23px] sm:-left-[31px] top-5.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-zinc-100">Founder and CEO — CosLynx.com</h3>
                <span className="text-xs text-zinc-400 font-medium">Build with Backdrop v4 Winner</span>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                May 2024 — May 2025
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Founded and led CosLynx.com, an AI-driven code generation and codebase intelligence platform leveraging LLMs with TypeScript/Node.js. Enabled users to generate 400+ live MVPs and won Build with Backdrop v4.
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">LLM Code Generation</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">TypeScript</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Product Leadership</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">AST Parsing</span>
            </div>
          </div>

          {/* ReeF */}
          <div className="relative space-y-2 pt-4">
            <div className="absolute -left-[23px] sm:-left-[31px] top-5.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-base text-zinc-100">Ex Chief Executive Officer — ReeF (1x Acquired)</h3>
                <span className="text-xs text-emerald-400 font-medium">Acquired in August 2024</span>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300">
                Apr 2022 — Aug 2024
              </span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Spearheaded ReeF, an interactive anime character collection game, scaling to $15,000 Annual Recurring Revenue (ARR). Managed a user base generating 5M+ interactions and successfully orchestrated the acquisition of the platform.
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">1x Acquisition</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">Node.js & Redis</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">MongoDB</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/70">5M+ User Actions</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Projects & Live GitHub Matrix */}
      <section id="projects" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            02. Featured Projects & Production Systems
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Autonomous agents, revenue workspaces, and security tooling.
          </p>
        </div>

        <ProjectsExplorer />

        <div className="pt-2">
          <GitHubActivity />
        </div>
      </section>

      {/* 5. Education & Licenses */}
      <section id="education" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            03. Education & Professional Credentials
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Cybersecurity foundations and AI professional certifications.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-zinc-100">Dayananda Sagar University (DSU)</h3>
              <span className="text-xs font-mono text-zinc-500">2026 — 2029</span>
            </div>
            <p className="text-xs text-emerald-400 font-mono">Bachelor's Degree in Cybersecurity</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Focusing on application security, threat modeling, network security, cryptography, and reverse engineering.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-sm text-zinc-100">IBM AI Engineering Professional Certificate</h3>
              <span className="text-xs font-mono text-emerald-400">Verified</span>
            </div>
            <p className="text-xs text-zinc-300 font-mono">IBM • Credential ID: 7P0EYJX1P5NN</p>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Machine learning algorithms, deep neural network architectures, LLM fine-tuning, and scalable AI pipeline deployment.
            </p>
          </div>
        </div>
      </section>

      {/* 6. Core Skills Matrix */}
      <section id="skills" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            04. Core Technical Arsenal
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Specialized engineering stack and domain mastery.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-emerald-400">🤖 AI & LLM Systems</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Multi-Agent Swarms & Consensus</li>
              <li>• LLM Orchestration & Evaluation</li>
              <li>• NVIDIA NIM, Ollama & Gemini</li>
              <li>• Vector DBs, Embeddings & RAG</li>
              <li>• Deterministic Quality Gates</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-zinc-200">⚡ Backend & Systems</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Node.js & TypeScript</li>
              <li>• Express.js & Python</li>
              <li>• WebSockets & Real-Time Streams</li>
              <li>• Prisma, Redis & Turso DB</li>
              <li>• PostgreSQL & MongoDB</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-zinc-200">🎨 Frontend & Mobile</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Next.js 14 (App Router, SSG)</li>
              <li>• React 18 & Server Components</li>
              <li>• React Native (Cross-Platform)</li>
              <li>• Tailwind CSS & CSS Cascade</li>
              <li>• High-Performance UX Design</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-zinc-200">🛡️ Security & Cloud</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Application Security (AppSec)</li>
              <li>• AST Analysis & Attack Graphs</li>
              <li>• Docker & Containerization</li>
              <li>• Vercel, Cloudflare & Linux</li>
              <li>• GitHub Actions CI/CD</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 7. Writing & Technical Research Section */}
      <section id="writing" className="p-6 sm:p-8 rounded-3xl bg-zinc-900/30 border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-zinc-400 font-semibold">05. Research & Engineering Writing</span>
          <span className="text-xs font-mono text-emerald-400">Knowledge Hub</span>
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-zinc-100">
            Technical Research, Architecture Notes & Founder Essays
          </h3>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-2xl">
            Engineering deep dives, autonomous agent architectures, cybersecurity analyses, distributed systems postmortems, and startup lessons learned.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-mono">
          <a
            href="https://blogs.drix10.com"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:text-emerald-300 underline font-semibold"
          >
            Read Articles on Drix10 Blogs ↗
          </a>
          <span className="text-zinc-700">•</span>
          <a
            href="https://www.smashingmagazine.com"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-400 hover:text-zinc-200 underline"
          >
            Featured in Smashing Magazine ↗
          </a>
        </div>
      </section>

      {/* 8. Contact Section */}
      <section id="contact">
        <ContactCard />
      </section>
    </div>
  );
}
