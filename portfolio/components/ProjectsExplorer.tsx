'use client';

import React, { useState } from 'react';

interface Project {
  title: string;
  category: 'AI & LLMs' | 'Startups & Systems' | 'Cybersecurity' | 'Open Source';
  description: string;
  tags: string[];
  github?: string;
  live?: string;
  highlight?: string;
}

const PROJECTS: Project[] = [
  {
    title: 'CosLynx',
    category: 'AI & LLMs',
    description:
      'Autonomous AI codebase intelligence platform. Indexes entire repositories, parses AST hierarchies, and provides deterministic multi-agent code analysis and automated debugging.',
    tags: ['Next.js 14', 'Python', 'Vector DB', 'Multi-Agent', 'AST Parser', 'Docker'],
    github: 'https://github.com/Drix10/CosLynx',
    highlight: 'Flagship AI Product',
  },
  {
    title: 'ReeF Platform',
    category: 'Startups & Systems',
    description:
      'High-throughput Discord bot and community platform servicing hundreds of thousands of daily active users with complex gamification mechanics, distributed microservices, and in-memory caches.',
    tags: ['Node.js', 'MongoDB', 'Redis', 'WebSockets', 'Distributed Systems'],
    highlight: '1x Acquired Startup',
  },
  {
    title: 'AI Resources Autonomous Hub',
    category: 'AI & LLMs',
    description:
      'Fully autonomous technical curation engine. Scrapes real-time developer lists across X & GitHub, synthesizes senior-engineer breakdowns with local/NVIDIA LLMs, and static-generates 8,950+ guides on blogs.drix10.com.',
    tags: ['Next.js 14', 'Selenium', 'NVIDIA NIM', 'Ollama', 'TypeScript', 'SEO Engine'],
    github: 'https://github.com/Drix10/ai-resources',
    live: 'https://blogs.drix10.com',
    highlight: '8,950+ Breakdowns',
  },
  {
    title: 'Canopy Infrastructure @ f.inc',
    category: 'Startups & Systems',
    description:
      'Financial infrastructure and automated analytics tooling built to handle real-time transactional event streams and institutional reporting pipelines.',
    tags: ['TypeScript', 'Node.js', 'PostgreSQL', 'Event Streams', 'System Architecture'],
    highlight: 'FinTech Systems',
  },
  {
    title: 'Red Team CVE & Exploit Analyzer',
    category: 'Cybersecurity',
    description:
      'Automated security analysis pipeline tracking zero-day vulnerabilities, CVE disclosures, memory corruption attack vectors, and network perimeter audits.',
    tags: ['Python', 'Cybersecurity', 'Network Auditing', 'Reverse Engineering', 'CVEs'],
    github: 'https://github.com/Drix10',
    highlight: 'Security Research',
  },
  {
    title: 'CSS Cascade Layers Architecture',
    category: 'Open Source',
    description:
      'Modern web UI styling and architectural framework published and featured in Smashing Magazine, pioneering modular styling without specificity collisions.',
    tags: ['CSS3', 'Web Standards', 'UI Architecture', 'Smashing Magazine'],
    live: 'https://www.smashingmagazine.com',
    highlight: 'Featured in Smashing Mag',
  },
];

const CATEGORIES = ['All', 'AI & LLMs', 'Startups & Systems', 'Cybersecurity', 'Open Source'] as const;

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
          className="w-full sm:w-64 px-3.5 py-1.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition-colors"
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
                  <span className="text-[11px] font-mono text-zinc-500">{project.category}</span>
                </div>
                {project.highlight && (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-[10px] font-mono font-semibold text-emerald-300">
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
                    <span>Live App</span>
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
