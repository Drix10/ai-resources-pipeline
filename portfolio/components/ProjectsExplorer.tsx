'use client';

import React, { useState } from 'react';

interface Project {
  title: string;
  category: 'AI & LLMs' | 'Startups & Systems' | 'Cybersecurity' | 'Web & Mobile';
  description: string;
  tags: string[];
  github?: string;
  live?: string;
  highlight?: string;
  period?: string;
}

const PROJECTS: Project[] = [
  {
    title: 'PartPilot',
    category: 'Startups & Systems',
    period: 'Apr 2026 — Present',
    description:
      'Platform engineered to identify hardware supply chain risks before they impact production. Comprehensive component intelligence tool for engineering, sourcing, and compliance teams.',
    tags: ['Next.js 14', 'TypeScript', 'Prisma', 'PostgreSQL', 'Supply Chain AI', 'Cloud Infra'],
    highlight: 'Co-Founded Startup',
  },
  {
    title: 'Canopy @ Founders, Inc.',
    category: 'AI & LLMs',
    period: 'Apr 2026 — May 2026',
    description:
      'Autonomous AI trading engine integrating 4 distinct LLMs and 4 methodology agents for real-time WEEX crypto-futures execution. WebSockets for live data streams and Prisma with Turso DB.',
    tags: ['Multi-Agent LLMs', 'WebSockets', 'Prisma', 'Turso DB', 'TypeScript', 'Crypto Futures'],
    highlight: 'Founders, Inc.',
  },
  {
    title: 'CosLynx.com',
    category: 'AI & LLMs',
    period: 'May 2024 — May 2025',
    description:
      'AI-driven code-generation and repository intelligence platform leveraging LLMs with TypeScript/Node.js. Powered 400+ MVP deployments and won Build with Backdrop v4.',
    tags: ['LLM Orchestration', 'Node.js', 'TypeScript', 'AST Analysis', 'Docker'],
    github: 'https://github.com/Drix10/CosLynx',
    live: 'https://www.youtube.com/watch?v=_iC2qcaqgyE',
    highlight: 'Backdrop v4 Winner • 400+ MVPs',
  },
  {
    title: 'ReeF Platform',
    category: 'Startups & Systems',
    period: 'Apr 2022 — Aug 2024',
    description:
      'Interactive anime character collection and gaming ecosystem scaled to $15,000 ARR and 5M+ user interactions before being successfully acquired in August 2024.',
    tags: ['Node.js', 'MongoDB', 'Redis', 'WebSockets', 'Distributed Systems', 'Discord API'],
    github: 'https://github.com/Drix10/reef-bot',
    highlight: '1x Acquired ($15k ARR)',
  },
  {
    title: 'AI Resources Knowledge Hub',
    category: 'AI & LLMs',
    period: 'Dec 2024 — Present',
    description:
      'Autonomous system curating senior-level AI engineering updates, synthesizing structured breakdowns via local & NVIDIA LLMs, and static-generating curated engineering breakdowns on blogs.drix10.com.',
    tags: ['Next.js 14', 'Selenium', 'NVIDIA NIM', 'TypeScript', 'Ollama', 'SEO Pipeline'],
    github: 'https://github.com/Drix10/ai-resources',
    live: 'https://blogs.drix10.com',
    highlight: 'Autonomous Hub • 100+ Stars',
  },
  {
    title: 'Intent Canvas',
    category: 'AI & LLMs',
    period: 'Aug 2026',
    description:
      'Evidence-first revenue operations workspace for SaaS teams built for the OpenAI Codex Hackathon. Integrates with Dodo Payments to turn webhook signals into reviewable recovery cases.',
    tags: ['React.js', 'OpenAI Codex', 'Dodo Payments', 'Webhook Analytics', 'UX'],
    highlight: 'OpenAI Codex Hackathon',
  },
  {
    title: 'Sentinel — Security CLI',
    category: 'Cybersecurity',
    period: 'Jul 2026',
    description:
      'Application security CLI combining deterministic AST parsing, attack/knowledge graphs, multi-file codebase context, Gemini 2.5 Flash AI reasoning, and zero-breakage autonomous patching.',
    tags: ['Cybersecurity', 'AST Parser', 'Attack Graphs', 'Gemini 2.5 Flash', 'Python/Node'],
    github: 'https://github.com/Drix10',
    highlight: 'AppSec & Zero-Breakage',
  },
  {
    title: 'Idolchat.app',
    category: 'Web & Mobile',
    period: 'May 2025 — Present',
    description:
      'Cross-platform AI character-interaction mobile game. Create unlimited custom AI characters, chat with anime legends and gaming icons, and collect rare digital cards in daily drops.',
    tags: ['React Native', 'WebSockets', 'Mobile App', 'LLM Prompting', 'Gamification'],
    highlight: 'Mobile & AI Gaming',
  },
  {
    title: 'ReeF — Instagram Timetable & Reel NoteTaker',
    category: 'AI & LLMs',
    period: 'Jul 2026',
    description:
      'Intelligent Instagram DM companion converting educational Reels into actionable weekly schedules, transcribing video notes, and setting automated habit reminders with Gemini 3.5 Flash.',
    tags: ['Instagram API', 'Gemini 3.5 Flash', 'Node.js', 'Audio Transcription'],
    highlight: 'Gemini 3.5 Flash',
  },
  {
    title: 'Carbon Trade X',
    category: 'Startups & Systems',
    period: 'Mar 2026 — Apr 2026',
    description:
      'Institutional-grade carbon credit trading platform with verified credits, real-time pricing feeds, and high-frequency backend transaction infrastructure.',
    tags: ['FinTech', 'Real-Time Pricing', 'PostgreSQL', 'Trading Infrastructure'],
    live: 'https://www.youtube.com/watch?v=RGB2SPp3Gk8',
    highlight: 'Institutional Trading',
  },
];

const CATEGORIES = ['All', 'AI & LLMs', 'Startups & Systems', 'Cybersecurity', 'Web & Mobile'] as const;

export default function ProjectsExplorer() {
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filtered = PROJECTS.filter((p) => {
    const matchesCategory = activeCategory === 'All' || p.category === activeCategory;
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Category Pills and Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs font-medium">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeCategory === cat
                  ? 'bg-zinc-100 text-zinc-950 font-semibold shadow'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <input
          type="text"
          placeholder="Filter by keyword or stack..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full sm:w-64 px-3.5 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors font-mono"
        />
      </div>

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((project) => (
          <div
            key={project.title}
            className="flex flex-col justify-between p-5 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/70 border border-zinc-800 hover:border-zinc-700 transition-all group"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-zinc-100 text-base group-hover:text-white transition-colors">
                      {project.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <span className="text-[11px] font-mono text-zinc-400">{project.category}</span>
                    {project.period && (
                      <>
                        <span className="text-zinc-600 text-xs">•</span>
                        <span className="text-[10px] font-mono text-zinc-500">{project.period}</span>
                      </>
                    )}
                  </div>
                </div>
                {project.highlight && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-[10px] font-mono font-semibold text-emerald-300 shrink-0">
                    {project.highlight}
                  </span>
                )}
              </div>

              <p className="text-xs text-zinc-300 leading-relaxed">{project.description}</p>
            </div>

            <div className="pt-4 space-y-3 mt-2 border-t border-zinc-800/60">
              <div className="flex flex-wrap gap-1.5">
                {project.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded bg-zinc-800/70 border border-zinc-700/50 text-[10px] font-mono text-zinc-400"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs font-mono">
                {project.live && (
                  <a
                    href={project.live}
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 hover:underline flex items-center gap-1"
                  >
                    <span>{project.live.includes('youtube') ? 'Demo Video' : 'Live Site'}</span>
                    <span>↗</span>
                  </a>
                )}
                {project.github && (
                  <a
                    href={project.github}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-400 hover:text-zinc-200 hover:underline flex items-center gap-1"
                  >
                    <span>Source Repo</span>
                    <span>↗</span>
                  </a>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
