// The parts of the profile GitHub cannot know. Projects, stars, activity and open-source
// work are loaded live (see lib/github.ts); only edit this file for roles, events and copy.

export const RESUME_URL = 'https://resume.drix10.com';

// A missing href renders the name as plain text (for private work such as Content Factory).
export const NOW_BUILDING: { name: string; href?: string }[] = [
  { name: 'Agent Flow', href: 'https://github.com/Drix10/agent-flow' },
  { name: 'MiroHedge', href: 'https://www.mirohedge.com' },
  { name: 'Guardian', href: 'https://github.com/Drix10/guardian-gpt' },
  { name: 'Content Factory' },
  { name: 'Keystroke-LLM', href: 'https://github.com/Drix10/keystroke-llm' },
  { name: 'IdolChat.app', href: 'https://idolchat.app' },
];

// Repos that exist on GitHub but should not be listed (names, case-insensitive).
export const HIDDEN_REPOS: string[] = ['video-storage', 'certificates'];

// The "More projects" list, in this order, below the pinned repos. Hand-picked so the list
// does not reshuffle every time an old repository gets a commit. Pinned repos are skipped
// here automatically; an empty list falls back to "most recently pushed".
export const MORE_REPOS: string[] = [
  'sentinal',
  'ai-resources-pipeline',
  'payscope',
  'intent-canvas',
  'ml-videos',
  'idolchat',
  'YourResume',
  'instagram-ai',
  'PyAdvisor',
  'discord-bot-web',
];

// Display names for repos whose GitHub name is not the product name (keys are lowercase).
// The repository name still appears in the meta line under the title.
export const PROJECT_NAMES: Record<string, string> = {
  'agent-flow': 'Agent Flow',
  'ai-resources': 'AI Resources',
  'ai-resources-pipeline': 'AI Resources pipeline',
  'hypothesis-arena': 'MiroHedge',
  'mirohedge-frontend': 'MiroHedge website',
  coslynx: 'CosLynx',
  'keystroke-llm': 'Keystroke-LLM',
  'guardian-gpt': 'Guardian',
  sentinal: 'Sentinel',
  payscope: 'PayScope',
  'intent-canvas': 'Intent Canvas',
  'ml-videos': 'ML videos (Night-Hunt)',
  idolchat: 'IdolChat',
  yourresume: 'YourResume',
  'instagram-ai': 'Instagram study agent',
  pyadvisor: 'PyAdvisor',
  'discord-bot-web': 'Discord bot website template',
  'reef-bot': 'ReeF Bot template',
  'twitter-tracker': 'Twitter tracker',
};

// Descriptions that replace the GitHub one, for repos that hold only part of a product.
export const PROJECT_DESCRIPTIONS: Record<string, string> = {
  idolchat:
    'IdolChat.app: an AI character chat and card-collection game. Create characters, chat in real time and collect cards in daily drops. React Native and Expo, Node.js, Prisma, Redis. 1,000+ people on the waitlist, and its AI marketer has driven 200K+ reel views. This repository serves the app’s character art.',
};

// Forks of my own organisation's repos: they are original work, so no "fork" tag.
export const OWN_FORKS: string[] = ['ai-resources-pipeline'];

export const ROLES = [
  {
    when: 'Apr to May 2026',
    title: 'AI Systems Engineer',
    org: 'Canopy, Founders, Inc.',
    where: 'Remote. Selected at ~1.5% acceptance',
    body: 'Built an AI hedge fund for consumers: four LLM agents with distinct analysis methods work in parallel on real-time WEEX crypto futures and a judge picks the trade, with WebSocket market streams, Prisma and Turso state, and compliance logging. It taught me that LLMs should not trade directly, which became MiroHedge.',
  },
  {
    when: 'May 2024 to May 2025',
    title: 'Founder and CEO',
    org: 'CosLynx',
    where: 'Won Backdrop Build v4 and v6',
    body: 'Built and ran an AI code-generation platform that takes an idea to a tested, GitHub-integrated repository; users shipped more than 400 MVPs. Wrote the core LLM orchestration system in TypeScript and Node.js, and applied to Y Combinator with the demo.',
  },
  {
    when: 'Apr 2022 to Aug 2024',
    title: 'Founder and CEO',
    org: 'ReeF',
    where: 'Acquired in August 2024',
    body: 'An anime collecting and battling game on Discord, built from the first commit: $15K in annual recurring revenue at 16, more than 5 million interactions across 2,000+ Discord servers, and a 15-person remote team.',
  },
  {
    when: 'Oct 2019 to Apr 2023',
    title: 'Software Engineer',
    org: 'Freelance',
    where: 'Remote',
    body: 'Started shipping with Node.js in 2019 and never stopped: Discord bots, web apps and automation for clients and communities. Uchiha Bot passed 500K interactions in 2021, and my open-source Discord bot website template has 29 stars.',
  },
];

// Newest first. Leave `when` empty when the date is not known.
export const HACKATHONS = [
  { event: 'OpenAI DevDay Community Hack', project: 'Guardian', when: 'Oct 2026', result: 'Bengaluru. Stops UPI and “digital arrest” scams at the moment of payment, ~185 ms per decision' },
  { event: 'Razorpay AI Buildathon', project: 'PayScope', when: 'Aug 2026', result: 'Autonomous payment-operations agent' },
  { event: 'OpenAI Codex Hackathon', project: 'Intent Canvas', when: 'Aug 2026', result: 'Top 60 of 2,000+ applicants, Bengaluru' },
  { event: 'NYC Code Quest', project: 'Sentinel', when: 'Jul 2026', result: '3rd place in the 8-hour live security round' },
  { event: 'Founders, Inc. Canopy', project: 'AI hedge fund', when: 'Apr 2026', result: 'Selected at ~1.5% acceptance' },
  { event: 'WEEX AI Wars', project: 'Hypothesis Arena', when: '2026', result: 'Finalist: four AI analysts trade live crypto futures in parallel and a judge picks the trade' },
  { event: 'Kaggle × Google Cloud hackathon', project: 'first MiroHedge prototype', when: '', result: 'Participant. Eight AI analysts debate investment decisions, then compete with simulated portfolios' },
  { event: 'Backdrop Build v6', project: 'CosLynx', when: 'Aug 2024', result: 'Winner; the demo went into the YC application' },
  { event: 'Backdrop Build v4', project: 'CosLynx', when: 'Jun 2024', result: 'Winner, AI MVP generator' },
];

// For structured data (search engines) and llms.txt.
export const AWARDS = [
  'Backdrop Build v4 winner (CosLynx)',
  'Backdrop Build v6 winner (CosLynx)',
  'NYC Code Quest, 3rd place (Sentinel)',
  'OpenAI Codex Hackathon Bengaluru, top 60 of 2,000+ applicants (Intent Canvas)',
  'WEEX AI Wars finalist',
  'Founders, Inc. Canopy, selected at ~1.5% acceptance',
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
  {
    name: 'St. Xavier’s High School',
    when: '2022 to 2024',
    line: 'Higher secondary, science.',
  },
];

export const SKILLS = [
  {
    group: 'AI and agent systems',
    items: 'Multi-agent orchestration and consensus, LLM evaluation, OpenAI APIs and the Model Context Protocol (MCP), Gemini, OpenRouter, NVIDIA NIM and Ollama, vector search and RAG, deterministic quality gates around model output.',
  },
  {
    group: 'Machine learning',
    items: 'Transformers written from scratch in NumPy, PyTorch, neuroevolution and genetic algorithms, reinforcement learning, training runs rendered as video.',
  },
  {
    group: 'Backend and data',
    items: 'Node.js and TypeScript, Python, C++17, Java, Express, WebSockets and real-time streams, Prisma, Redis, PostgreSQL and SQL, MongoDB, Supabase, Turso (LibSQL).',
  },
  {
    group: 'Frontend and mobile',
    items: 'Next.js with the App Router, React, React Native and Expo, Vite, Tailwind CSS.',
  },
  {
    group: 'Security',
    items: 'Application security, AST analysis and attack graphs, SARIF reporting, threat modeling, reverse engineering of USB HID protocols.',
  },
  {
    group: 'Cloud and delivery',
    items: 'Docker, GCP, AWS, Vercel, Cloudflare, Linux, GitHub Actions.',
  },
];
