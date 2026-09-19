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
    title: 'Night-Hunt — Evolving Mice',
    category: 'AI & LLMs',
    description:
      'An owl hunts 32 mice sharing one tiny MLP brain that evolves escape behavior from scratch, growing new senses level by level across 1800-frame episodes with deaths-dominated scoring, rendered as 9:16 video.',
    tags: ['Python', 'PyTorch', 'NumPy', 'Pygame'],
    github: 'https://github.com/Drix10/ml-videos',
    live: 'https://lnkd.in/p/gxWdsT4Q',
    highlight: 'From-Scratch Evolution',
  },
  {
    title: 'Keystroke-LLM — Built From Scratch',
    category: 'AI & LLMs',
    description:
      'Character-level Transformer LLM built from scratch in pure NumPy — no framework, no API — predicting the next key with sub-2ms latency and lighting Kreo Hive 75 LEDs via reverse-engineered EVision V2, trained on 207K chars.',
    tags: ['Python', 'Pure NumPy', 'USB HID', 'EVision V2'],
    github: 'https://github.com/Drix10/keystroke-llm',
    live: 'https://www.linkedin.com/posts/drix10_llm-ondeviceai-mechanicalkeyboards-activity-7503825549148975105-CW31',
    highlight: 'From-Scratch LLM',
  },
  {
    title: 'PayScope',
    category: 'AI & LLMs',
    description:
      'Autonomous payment-operations platform for Razorpay merchants with multi-agent investigation (Supervisor, Risk Analyst, Recovery Planner), 13 policy safety gates, HMAC-SHA256 webhooks and a sub-50ms SSE incident feed.',
    tags: ['TypeScript', 'React', 'Node.js', 'Supabase', 'Razorpay'],
    github: 'https://github.com/Drix10/payscope',
    highlight: 'Razorpay AI Buildathon',
  },
  {
    title: 'Sentinel — Security CLI',
    category: 'Cybersecurity',
    description:
      'Application security CLI combining deterministic AST parsing with knowledge/attack graphs and zero-breakage autonomous AI patching, built for the OpenAI Codex hackathon and NYC Code Quest live round.',
    tags: ['TypeScript', 'Node.js', 'AST Parser', 'Attack Graphs'],
    github: 'https://github.com/Drix10/sentinal',
    highlight: 'Zero-Breakage Patching',
  },
  {
    title: 'Intent Canvas',
    category: 'AI & LLMs',
    description:
      'Evidence-first revenue operations workspace turning Dodo Payments webhooks into churn risk scores and AI recovery plans with reviewable cases, built for the OpenAI Codex Hackathon.',
    tags: ['TypeScript', 'React', 'Express', 'Tailwind', 'Zod'],
    github: 'https://github.com/Drix10/intent-canvas',
    highlight: 'OpenAI Codex Hackathon',
  },
  {
    title: 'ReeF DM Bot — Instagram AI',
    category: 'AI & LLMs',
    description:
      'Instagram DM companion converting educational Reels into weekly study schedules with transcribed video notes and automated habit reminders, powered by Gemini, Node.js and MongoDB.',
    tags: ['Node.js', 'Instagram API', 'Gemini AI', 'MongoDB'],
    github: 'https://github.com/Drix10/instagram-ai',
    highlight: 'Reels → Study Plans',
  },
  {
    title: 'Carbon Trade X',
    category: 'Startups & Systems',
    description:
      'Institutional-grade carbon credit trading platform with verified credits, real-time pricing feeds and high-frequency transaction infrastructure, shipped Mar–Apr 2026 with a video walkthrough.',
    tags: ['Trading Systems', 'Real-Time Pricing', 'PostgreSQL', 'FinTech'],
    live: 'https://www.youtube.com/watch?v=RGB2SPp3Gk8',
    highlight: 'Institutional Trading',
  },
  {
    title: 'IdolChat.app',
    category: 'Web & Mobile',
    description:
      'Cross-platform AI character mobile game for creating unlimited custom characters, chatting with anime legends and collecting rare cards in daily drops, with 40+ beta testers and ~1,000 people on the waitlist.',
    tags: ['React Native', 'Expo', 'Node.js', 'Prisma', 'Redis'],
    github: 'https://github.com/Drix10/idolchat',
    live: 'https://idolchat.app',
    highlight: '40+ Beta · ~1K Waitlist',
  },
  {
    title: 'hypothesis-arena',
    category: 'AI & LLMs',
    description:
      'Four AI analysts (Jim, Ray, Karen, Quant) debate and execute WEEX crypto futures in real time over WebSockets with Gemini reasoning and Prisma/LibSQL persistence. 9 stars.',
    tags: ['TypeScript', 'Express', 'Gemini AI', 'WebSockets', 'Prisma'],
    github: 'https://github.com/Drix10/hypothesis-arena',
    highlight: '9 Stars · Live Agents',
  },
  {
    title: 'AI Resources Knowledge Hub',
    category: 'AI & LLMs',
    description:
      'Autonomous engineering knowledge hub syndicating deep technical breakdowns across blogs.drix10.com, GitHub and DEV.to with 40+ categories, 115+ stars and 25+ forks.',
    tags: ['Next.js', 'GH Actions', 'X Scraping', 'Blogs', 'Open Source'],
    github: 'https://github.com/Drix10/ai-resources',
    live: 'https://blogs.drix10.com',
    highlight: '115+ Stars · 25+ Forks',
  },
  {
    title: 'YourResume',
    category: 'Web & Mobile',
    description:
      'ATS-optimised resume builder turning GitHub and LinkedIn profiles into tailored, interview-ready resumes with React, Vite and Google AI, live as a hosted web app.',
    tags: ['React', 'Vite', 'TypeScript', 'Google AI'],
    github: 'https://github.com/Drix10/YourResume',
    live: 'https://your-resume-ai.vercel.app',
    highlight: 'Live Web App',
  },
  {
    title: 'PyAdvisor',
    category: 'AI & LLMs',
    description:
      'Python CLI career advisor turning GitHub activity into guided career paths and skill recommendations with Hugging Face models, packaged as a simple terminal workflow.',
    tags: ['Python', 'Hugging Face', 'CLI', 'GitHub API'],
    github: 'https://github.com/Drix10/PyAdvisor',
    highlight: 'AI Career CLI',
  },
  {
    title: 'ReeF Bot',
    category: 'Startups & Systems',
    description:
      'Anime card collection and battling Discord game scaling to thousands of users with 5M+ interactions and $15K ARR before its successful acquisition in August 2024.',
    tags: ['Discord.js', 'Node.js', 'Mongoose', 'Distributed Systems'],
    github: 'https://github.com/Drix10/reef-bot',
    highlight: '1x Acquired · $15K ARR',
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
              className={`px-3 py-1.5 rounded-lg transition-all ${activeCategory === cat
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
