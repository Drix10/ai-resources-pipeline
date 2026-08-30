import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getAllArticles } from '@/lib/markdown';

export const metadata: Metadata = {
  title: 'About Drishtant Ghosh (Drix10) — AI Engineer & Serial Founder',
  description:
    'Biographical overview, technical background, open-source repositories, and engineering research by Drishtant Ghosh (known online as Drix10).',
  alternates: {
    canonical: 'https://blogs.drix10.com/about',
  },
  openGraph: {
    title: 'About Drishtant Ghosh (Drix10)',
    description:
      'AI Engineer, serial founder, and cybersecurity researcher. Author of 8,950+ technical breakdowns at Drix10 Blogs.',
    url: 'https://blogs.drix10.com/about',
    type: 'profile',
    images: ['/avatar.png'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'About Drishtant Ghosh (Drix10)',
    description: 'AI Engineer, serial founder, and cybersecurity researcher.',
    creator: '@drix10',
    images: ['/avatar.png'],
  },
};

export default function AboutPage() {
  const totalArticles = getAllArticles().length;

  const profilePageSchema = {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    mainEntity: {
      '@type': 'Person',
      '@id': 'https://drix10.com/#person',
      name: 'Drishtant Ghosh',
      alternateName: ['Drix10', 'drix10', 'Drix'],
      url: 'https://drix10.com',
      image: 'https://blogs.drix10.com/avatar.png',
      jobTitle: 'Founder & AI Engineer',
      description:
        'Drishtant Ghosh (known online as Drix10) is an AI Engineer, 1x acquired serial founder, and cybersecurity researcher. Founder of CosLynx, Canopy @ f.inc, and creator of the autonomous engineering curation hub at Drix10 Blogs.',
      sameAs: [
        'https://github.com/Drix10',
        'https://www.linkedin.com/in/drix10',
        'https://peerlist.io/drix10',
        'https://medium.com/@drix10',
        'https://dev.to/drix10',
        'https://x.com/Drix_10',
        'https://drix10.com',
      ],
      knowsAbout: [
        'Artificial Intelligence',
        'Large Language Models',
        'Autonomous Agent Systems',
        'Cybersecurity',
        'System Architecture',
        'Full Stack Software Engineering',
        'Next.js & React',
      ],
      hasOccupation: {
        '@type': 'Occupation',
        name: 'AI Software Engineer & Systems Architect',
        occupationalCategory: '15-1252.00',
      },
    },
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 sm:space-y-10">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(profilePageSchema) }}
      />

      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-1.5 sm:gap-2 text-xs font-medium text-zinc-500">
        <Link href="/" className="hover:text-zinc-200 transition-colors">
          Home
        </Link>
        <span>/</span>
        <span className="text-zinc-400">About Drishtant Ghosh (Drix10)</span>
      </nav>

      {/* Hero Header */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center gap-5 p-6 rounded-2xl bg-zinc-900/60 border border-zinc-800">
        <Image
          src="/avatar.png"
          alt="Drishtant Ghosh (Drix10)"
          width={84}
          height={84}
          priority
          className="w-20 h-20 rounded-full object-cover border-2 border-zinc-700 shadow-xl"
        />
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100">
              Drishtant Ghosh
            </h1>
            <span className="px-2.5 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 font-mono text-xs text-zinc-300">
              @Drix10
            </span>
          </div>
          <p className="text-sm text-zinc-400 font-medium">
            AI Engineer • 1x Acquired Serial Founder • Cybersecurity Researcher
          </p>
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            <a
              href="https://drix10.com"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-zinc-100 text-zinc-950 font-semibold hover:bg-zinc-200 transition-colors"
            >
              drix10.com ↗
            </a>
            <a
              href="https://github.com/Drix10"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors"
            >
              GitHub (Drix10)
            </a>
            <a
              href="https://www.linkedin.com/in/drix10"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors"
            >
              LinkedIn
            </a>
            <a
              href="https://peerlist.io/drix10"
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 transition-colors"
            >
              Peerlist
            </a>
          </div>
        </div>
      </header>

      {/* Main Narrative */}
      <section className="space-y-6 text-sm sm:text-base leading-relaxed text-zinc-300">
        <div className="space-y-3">
          <h2 className="text-lg font-bold text-zinc-100 font-mono uppercase tracking-wider text-xs">
            Biography & Engineering Background
          </h2>
          <p>
            <strong>Drishtant Ghosh</strong> (operating online under the moniker <strong>Drix10</strong>) is a software engineer, serial founder, and artificial intelligence researcher based in India. He focuses on autonomous multi-agent pipelines, deterministic LLM synthesis architectures, and cybersecurity systems.
          </p>
          <p>
            He previously founded and scaled <strong>ReeF</strong> (a popular anime Discord bot and platform) to a successful acquisition, built <strong>CosLynx</strong> (AI-powered codebase intelligence), and contributed to <strong>Canopy @ f.inc</strong>. His technical work on web design and CSS Cascade Layers has been featured in industry publications including <em>Smashing Magazine</em>.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-bold text-zinc-100 font-mono uppercase tracking-wider text-xs">
            About Drix10 Blogs ({totalArticles.toLocaleString()}+ Guides)
          </h2>
          <p>
            <Link href="/" className="text-zinc-100 underline hover:text-white font-medium">
              Drix10 Blogs (blogs.drix10.com)
            </Link>{' '}
            is an autonomous engineering research hub built and curated by Drishtant Ghosh. Running on Next.js 14 App Router, it ingests daily technical discussions, whitepapers, and architecture releases from verified engineering communities across X/Twitter and GitHub, transforming unstructured findings into production-ready technical guides.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-bold text-zinc-100 font-mono uppercase tracking-wider text-xs">
            Core Expertise & Technical Focus
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <div className="font-semibold text-zinc-200 mb-1">🤖 AI & LLM Systems</div>
              <div className="text-zinc-400">Autonomous multi-agent workflows, Ollama, NVIDIA NIM, deterministic validation pipelines.</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <div className="font-semibold text-zinc-200 mb-1">🛡️ Cybersecurity</div>
              <div className="text-zinc-400">Application security, CTF competitions, threat modeling, and network infrastructure audit.</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <div className="font-semibold text-zinc-200 mb-1">⚡ System Architecture</div>
              <div className="text-zinc-400">Serverless state reconciliation, Next.js SSG/SSR, high-throughput web scraping, Redis.</div>
            </div>
            <div className="p-3 rounded-lg bg-zinc-900/60 border border-zinc-800">
              <div className="font-semibold text-zinc-200 mb-1">🌐 Open Source & Research</div>
              <div className="text-zinc-400">Curator of Drix10/ai-resources on GitHub, authoring daily engineering breakdowns.</div>
            </div>
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100 font-mono uppercase tracking-wider text-xs">
            Verified Profiles & Digital Footprint
          </h2>
          <ul className="space-y-2 text-xs font-mono text-zinc-400">
            <li>
              • Portfolio Website:{' '}
              <a href="https://drix10.com" target="_blank" rel="noreferrer" className="text-zinc-200 underline">
                https://drix10.com
              </a>
            </li>
            <li>
              • GitHub:{' '}
              <a href="https://github.com/Drix10" target="_blank" rel="noreferrer" className="text-zinc-200 underline">
                https://github.com/Drix10
              </a>
            </li>
            <li>
              • LinkedIn:{' '}
              <a href="https://www.linkedin.com/in/drix10" target="_blank" rel="noreferrer" className="text-zinc-200 underline">
                https://www.linkedin.com/in/drix10
              </a>
            </li>
            <li>
              • Peerlist:{' '}
              <a href="https://peerlist.io/drix10" target="_blank" rel="noreferrer" className="text-zinc-200 underline">
                https://peerlist.io/drix10
              </a>
            </li>
            <li>
              • Medium:{' '}
              <a href="https://medium.com/@drix10" target="_blank" rel="noreferrer" className="text-zinc-200 underline">
                https://medium.com/@drix10
              </a>
            </li>
            <li>
              • DEV.to:{' '}
              <a href="https://dev.to/drix10" target="_blank" rel="noreferrer" className="text-zinc-200 underline">
                https://dev.to/drix10
              </a>
            </li>
          </ul>
        </div>
      </section>

      {/* Footer link back to articles */}
      <div className="pt-6 border-t border-zinc-800">
        <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-200 font-mono transition-colors">
          ← Explore 8,950+ Technical Guides
        </Link>
      </div>
    </div>
  );
}
