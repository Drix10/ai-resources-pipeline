// The parts of the profile GitHub cannot know. Projects, stars, activity and open-source
// work are loaded live (see lib/github.ts); only edit this file for roles, events and copy.

export const NOW_BUILDING = [
  { name: 'Agent Flow', href: 'https://github.com/Drix10/agent-flow' },
  { name: 'MiroHedge', href: 'https://github.com/Drix10/hypothesis-arena' },
  { name: 'Keystroke-LLM', href: 'https://github.com/Drix10/keystroke-llm' },
  { name: 'IdolChat.app', href: 'https://idolchat.app' },
];

// Repos that exist on GitHub but should not be listed (names, case-insensitive).
export const HIDDEN_REPOS: string[] = ['video-storage', 'certificates'];

export const ROLES = [
  {
    when: 'Apr to May 2026',
    title: 'AI Systems Engineer',
    org: 'Canopy, Founders, Inc.',
    where: 'San Francisco and remote',
    body: 'Architected an autonomous multi-agent trading platform: four LLM agents in distinct methodology roles, real-time market streaming, persistent state and compliance logging.',
  },
  {
    when: 'May 2024 to May 2025',
    title: 'Founder and CEO',
    org: 'CosLynx',
    where: 'Backdrop Build v4 and v6 finalist',
    body: 'Built and ran an AI code-generation platform on which users shipped more than 400 MVPs. Wrote the core LLM orchestration system in TypeScript and Node.js.',
  },
  {
    when: 'Apr 2022 to Aug 2024',
    title: 'CEO',
    org: 'ReeF',
    where: 'Acquired in August 2024',
    body: 'An anime collecting and battling game on Discord, run from the first commit to acquisition: $15K in annual recurring revenue and more than 5 million interactions.',
  },
  {
    when: 'Oct 2019 to Apr 2023',
    title: 'Software Engineer',
    org: 'Freelance',
    where: 'Remote',
    body: 'Started shipping with Node.js in 2019 and never stopped. Uchiha Bot, a Discord bot, passed 500K interactions in 2021.',
  },
];

export const HACKATHONS = [
  { event: 'Backdrop Build v4', project: 'CosLynx', when: 'Jun 2024', result: 'Finalist, AI MVP generator' },
  { event: 'Backdrop Build v6', project: 'CosLynx', when: 'Aug 2024', result: 'Finalist, YC application cycle' },
  { event: 'NYC Code Quest', project: 'Sentinel', when: 'Jul 2026', result: '3rd place in the 8-hour live security round' },
  { event: 'OpenAI Codex Hackathon', project: 'Intent Canvas', when: 'Aug 2026', result: 'Top 60 of 2,000+ applicants, Bengaluru' },
  { event: 'Razorpay AI Buildathon', project: 'PayScope', when: 'Aug 2026', result: 'Autonomous payment-operations agent' },
];

export const EDUCATION = [
  {
    name: 'Dayananda Sagar University',
    when: '2026 to 2029',
    line: 'B.Sc. Cybersecurity: application security, threat modeling, network security, cryptography and reverse engineering.',
  },
  {
    name: 'IBM AI Engineering Professional Certificate',
    when: 'Issued January 2026',
    line: 'Machine learning, deep neural networks, LLM fine-tuning and deploying AI pipelines. Credential ID 7P0EYJX1P5NN.',
  },
];

export const SKILLS = [
  {
    group: 'AI and agent systems',
    items: 'Multi-agent orchestration and consensus, LLM evaluation, NVIDIA NIM, Ollama, Gemini and OpenRouter, vector search and RAG, deterministic quality gates around model output.',
  },
  {
    group: 'Backend and data',
    items: 'Node.js and TypeScript, Python, C++17, Express, WebSockets and real-time streams, Prisma, Redis, PostgreSQL, MongoDB, Supabase.',
  },
  {
    group: 'Frontend and mobile',
    items: 'Next.js with the App Router, React, React Native and Expo, Vite, Tailwind CSS.',
  },
  {
    group: 'Security and delivery',
    items: 'Application security, AST analysis and attack graphs, Docker, Vercel, Cloudflare, Linux, GitHub Actions.',
  },
];
