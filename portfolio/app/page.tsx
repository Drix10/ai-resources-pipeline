import Image from 'next/image';
import Link from 'next/link';
import RoleCycle from '@/components/RoleCycle';
import LocalTimeBadge from '@/components/LocalTimeBadge';
import ProjectsExplorer from '@/components/ProjectsExplorer';
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
            </div>

            <div className="flex items-center gap-2 text-sm sm:text-base font-medium">
              <RoleCycle />
            </div>

            <p className="text-xs sm:text-sm text-zinc-400 max-w-2xl leading-relaxed">
              Architecting deterministic LLM synthesis pipelines, autonomous multi-agent swarms, and high-concurrency systems. Author of 8,950+ technical breakdowns at{' '}
              <a href="https://blogs.drix10.com" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline font-medium">
                Drix10 Blogs
              </a>.
            </p>
          </div>
        </div>

        {/* Quick Social / Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5 pt-2">
          <a
            href="https://blogs.drix10.com"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs font-mono transition-colors shadow-lg shadow-emerald-950/40 flex items-center gap-1.5"
          >
            <span>👁️ Read 8,950+ Tech Breakdowns</span>
            <span>↗</span>
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
            href="https://peerlist.io/drix10"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <span>Peerlist</span>
          </a>
        </div>
      </section>

      {/* 2. Key Numbers & Metrics Ribbon */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-zinc-100">8,950+</div>
          <div className="text-[11px] text-zinc-500 font-medium">Technical Guides Curated</div>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-emerald-400">1x Acquired</div>
          <div className="text-[11px] text-zinc-500 font-medium">Startup Exit (ReeF)</div>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-zinc-100">50M+</div>
          <div className="text-[11px] text-zinc-500 font-medium">Platform Events Handled</div>
        </div>
        <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 space-y-1 text-center sm:text-left">
          <div className="text-2xl font-black font-mono text-zinc-100">140+</div>
          <div className="text-[11px] text-zinc-500 font-medium">Repos & Open Source Work</div>
        </div>
      </section>

      {/* 3. Flagship Startups & Ventures */}
      <section id="startups" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            01. Entrepreneurial Milestones & Startups
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Companies founded, scaled, and acquired.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-emerald-400 font-semibold px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-800/80">
                1x Acquired Venture
              </span>
              <span className="text-xs font-mono text-zinc-500">2021 — 2023</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-zinc-100">ReeF Platform</h3>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Founded and bootstrapped ReeF, an interactive anime Discord platform that grew to hundreds of thousands of users across millions of message interactions before being successfully acquired.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Node.js</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Redis</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">MongoDB</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Microservices</span>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-zinc-900/50 border border-zinc-800 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-zinc-300 font-semibold px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700">
                AI Product
              </span>
              <span className="text-xs font-mono text-zinc-500">2024 — Present</span>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-bold text-zinc-100">CosLynx</h3>
              <p className="text-xs text-zinc-300 leading-relaxed">
                Autonomous AI codebase exploration and multi-agent intelligence assistant. Parses abstract syntax trees (ASTs), embeds repository graphs, and debugs full-stack issues with zero human friction.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px] font-mono text-zinc-400">
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Python</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Next.js 14</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Vector DB</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80">Multi-Agent</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Interactive Projects Explorer */}
      <section id="projects" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            02. Featured Engineering & Open Source
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Production systems, security tools, and libraries.
          </p>
        </div>

        <ProjectsExplorer />
      </section>

      {/* 5. Experience Timeline */}
      <section id="experience" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            03. Career & Engineering Timeline
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Proven track record of building and scaling systems.
          </p>
        </div>

        <div className="space-y-4 border-l-2 border-zinc-800 pl-4 sm:pl-6 ml-2 sm:ml-4">
          <div className="relative space-y-1.5">
            <div className="absolute -left-[23px] sm:-left-[31px] top-1.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-zinc-100">Founder & AI Architect — CosLynx</h3>
              <span className="text-xs font-mono text-zinc-500">2024 — Present</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Designed multi-agent codebase analysis pipelines, vector graph embedding indices, and autonomous code review workflows.
            </p>
          </div>

          <div className="relative space-y-1.5 pt-4">
            <div className="absolute -left-[23px] sm:-left-[31px] top-5.5 w-3 h-3 rounded-full bg-zinc-600 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-zinc-100">Systems Contributor — Canopy @ f.inc</h3>
              <span className="text-xs font-mono text-zinc-500">2023 — 2024</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Developed distributed backend infrastructure, high-throughput event processing pipelines, and data synchronization services.
            </p>
          </div>

          <div className="relative space-y-1.5 pt-4">
            <div className="absolute -left-[23px] sm:-left-[31px] top-5.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-[#09090b]"></div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-zinc-100">Founder & Lead Engineer — ReeF (1x Acquired)</h3>
              <span className="text-xs font-mono text-zinc-500">2021 — 2023</span>
            </div>
            <p className="text-xs text-zinc-300 leading-relaxed">
              Bootstrapped and scaled the platform from 0 to over 50M+ processed platform events; engineered real-time Redis state machines and led to an acquisition.
            </p>
          </div>
        </div>
      </section>

      {/* 6. Core Skills Matrix */}
      <section id="skills" className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            04. Core Technical Expertise
          </h2>
          <p className="text-xl font-bold text-zinc-100 tracking-tight">
            Specialized engineering stack and domain mastery.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-emerald-400">🤖 AI & LLM Systems</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Multi-Agent Swarms</li>
              <li>• NVIDIA NIM & Ollama</li>
              <li>• Prompt Engineering</li>
              <li>• Quality Assurance Gates</li>
              <li>• Vector DBs & RAG</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-zinc-200">⚡ Backend & Infra</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Node.js & TypeScript</li>
              <li>• Python & Rust</li>
              <li>• Redis & PostgreSQL</li>
              <li>• High-Throughput Scrapers</li>
              <li>• Docker & Microservices</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-zinc-200">🎨 Frontend & UI/UX</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• Next.js 14 App Router</li>
              <li>• React 18 & Server Comp.</li>
              <li>• Tailwind CSS & Radix</li>
              <li>• CSS Cascade Layers</li>
              <li>• Static Generation (SSG)</li>
            </ul>
          </div>

          <div className="p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800 space-y-2">
            <div className="font-bold text-zinc-200">🛡️ Security & DevOps</div>
            <ul className="text-zinc-400 space-y-1 text-[11px]">
              <li>• AppSec & Threat Modeling</li>
              <li>• CVE & Exploit Analysis</li>
              <li>• Cloudflare & Vercel</li>
              <li>• Linux Internals</li>
              <li>• GitHub Actions CI/CD</li>
            </ul>
          </div>
        </div>
      </section>

      {/* 7. Publications & Knowledge Hub */}
      <section id="writing" className="p-6 sm:p-8 rounded-3xl bg-zinc-900/30 border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono text-zinc-400 font-semibold">05. Publications & Hub</span>
          <span className="text-xs font-mono text-emerald-400">8,950+ Articles</span>
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-zinc-100">
            Drix10 Blogs — Autonomous Engineering Knowledge Hub
          </h3>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-2xl">
            A real-time technical breakdown repository covering AI Developer Tools, Cybersecurity, Distributed Systems, Quantum Computing, and CS Academics.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-mono">
          <a
            href="https://blogs.drix10.com"
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 hover:text-emerald-300 underline font-semibold"
          >
            Explore Knowledge Hub (8,950+ Guides) ↗
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
