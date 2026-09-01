import HeaderLiveCounter from '@/components/HeaderLiveCounter';
import Link from 'next/link';
import Image from 'next/image';
import { Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { getAllCategories } from '@/lib/markdown';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const viewport: Viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

export const metadata: Metadata = {
  metadataBase: new URL(process.env.CANONICAL_BASE_URL || 'https://blogs.drix10.com'),
  title: {
    default: 'Drishtant Ghosh (Drix10) — Technical Research & Engineering Hub',
    template: '%s | Drishtant Ghosh (Drix10)',
  },
  description: 'Authoritative technical research, system designs, cybersecurity notes, and autonomous AI architectures by Drishtant Ghosh (Drix10).',
  keywords: [
    'Drishtant Ghosh',
    'Drix10',
    'Drishtant Ghosh Drix10',
    'Drishtant Ghosh AI',
    'Drishtant Ghosh Cybersecurity',
    'Drishtant Ghosh Founder',
    'Drishtant Ghosh Blogs',
    'Drix10 Blogs',
    'AI Engineering',
    'Cybersecurity',
    'System Architecture',
    'Software Development',
    'LLM Engineering',
    'Autonomous Agents'
  ],
  authors: [{ name: 'Drishtant Ghosh (Drix10)', url: 'https://drix10.com' }],
  creator: 'Drishtant Ghosh (Drix10)',
  publisher: 'Drishtant Ghosh',
  applicationName: 'Drix10 Blogs',
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/avatar.png',
    shortcut: '/avatar.png',
    apple: '/avatar.png',
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://blogs.drix10.com',
    siteName: 'Drix10 Blogs — Drishtant Ghosh',
    title: 'Drishtant Ghosh (Drix10) — Technical Research & Engineering Hub',
    description: 'Curated technical research, system architectures, cybersecurity breakdowns, and AI engineering notes by Drishtant Ghosh (Drix10).',
    images: [
      {
        url: '/avatar.png',
        width: 800,
        height: 800,
        alt: 'Drishtant Ghosh (Drix10)',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Drishtant Ghosh (Drix10) — Technical Research & Engineering Hub',
    description: 'Curated technical research, system architectures, and AI engineering notes by Drishtant Ghosh (Drix10).',
    creator: '@drix10',
    images: ['/avatar.png'],
  },
  alternates: {
    canonical: 'https://blogs.drix10.com',
    types: {
      'application/rss+xml': 'https://blogs.drix10.com/rss.xml',
    },
  },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'black-translucent',
    'format-detection': 'telephone=no',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const categories = getAllCategories();
  const rootKnowledgeGraphSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': 'https://drix10.com/#person',
        name: 'Drishtant Ghosh',
        alternateName: ['Drix10', 'drix10', 'Drix'],
        url: 'https://drix10.com',
        image: 'https://blogs.drix10.com/avatar.png',
        jobTitle: 'Founder & AI Engineer',
        description: 'AI Engineer, serial founder, and cybersecurity student. Author and curator of 8,950+ technical engineering breakdowns at Drix10 Blogs.',
        sameAs: [
          'https://github.com/Drix10',
          'https://www.linkedin.com/in/drix10',
          'https://peerlist.io/drix10',
          'https://medium.com/@drix10',
          'https://dev.to/drix10',
          'https://x.com/Drix_10',
        ],
        knowsAbout: [
          'Artificial Intelligence',
          'Large Language Models',
          'Cybersecurity',
          'System Architecture',
          'Autonomous Agent Workflows',
          'Next.js',
          'Full Stack Engineering',
        ],
      },
      {
        '@type': 'WebSite',
        '@id': 'https://blogs.drix10.com/#website',
        url: 'https://blogs.drix10.com',
        name: 'Drix10 Blogs by Drishtant Ghosh',
        description: 'Continuous engineering research, AI system architectures, and cybersecurity breakdowns by Drishtant Ghosh (Drix10).',
        publisher: {
          '@id': 'https://drix10.com/#person',
        },
        author: {
          '@id': 'https://drix10.com/#person',
        },
        potentialAction: {
          '@type': 'SearchAction',
          target: 'https://blogs.drix10.com/?search={search_term_string}',
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };

  return (
    <html lang="en" className="dark scroll-smooth">
      <head>
        <link rel="icon" href="/avatar.png" type="image/png" />
        <link rel="apple-touch-icon" href="/avatar.png" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(rootKnowledgeGraphSchema) }}
        />
      </head>
      <body className={`${inter.variable} font-sans min-h-screen flex flex-col bg-[#09090b] text-zinc-100 antialiased selection:bg-zinc-800 selection:text-zinc-100 overflow-x-hidden`}>
        {/* Global Navigation Header (Matched with Portfolio Design System) */}
        <header className="border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2.5 group">
                <Image
                  src="/avatar.png"
                  alt="Drishtant Ghosh (Drix10)"
                  width={32}
                  height={32}
                  priority
                  className="w-8 h-8 rounded-full object-cover border border-zinc-700 shadow-sm group-hover:border-zinc-400 transition-colors"
                />
                <div className="flex items-center gap-1.5 font-bold tracking-tight text-sm text-zinc-100 group-hover:text-white transition-colors">
                  <span>drix10</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono font-normal">
                    blogs
                  </span>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-zinc-400">
              <a
                href="https://drix10.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-zinc-100 transition-colors flex items-center gap-1 font-semibold text-zinc-300"
              >
                <span>Portfolio</span>
                <span className="text-[10px] text-zinc-500">↗</span>
              </a>
              <Link href="/categories" className="hover:text-zinc-100 transition-colors">
                Categories
              </Link>
              <Link href="/categories/personal" className="text-amber-400/90 hover:text-amber-300 font-mono transition-colors font-medium">
                Founder Notes
              </Link>
            </nav>
            
            <div className="flex items-center gap-2.5">
              <HeaderLiveCounter />
              <a 
                href="https://github.com/Drix10" 
                target="_blank" 
                rel="noreferrer" 
                aria-label="GitHub Profile"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
              >
                GitHub
              </a>
              <a 
                href="https://www.linkedin.com/in/drix10" 
                target="_blank" 
                rel="noreferrer" 
                aria-label="Connect on LinkedIn"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 transition-colors"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12">
          {children}
        </main>

        {/* Global Footer (Matched with Portfolio Layout) */}
        <footer className="border-t border-zinc-800/80 bg-[#09090b] py-10 mt-16 text-xs text-zinc-500">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col gap-6">
            
            {/* Category Directory Block */}
            <div className="pt-2">
              <h4 className="text-xs font-mono uppercase tracking-wider text-zinc-400 font-semibold mb-3">Explore Categories Directory</h4>
              <nav aria-label="Footer Directory" className="flex flex-wrap gap-x-3 gap-y-2">
                {categories.map(c => (
                  <Link key={c.slug} href={`/categories/${c.slug}`} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                    {c.name}
                  </Link>
                ))}
              </nav>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left pt-6 border-t border-zinc-800/60">
              <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
                <span className="font-semibold text-zinc-300">Drishtant Ghosh (Drix10)</span>
                <span className="hidden sm:inline text-zinc-700">•</span>
                <span>Engineering Knowledge Hub & Autonomous Systems</span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 text-zinc-400">
                <a href="https://drix10.com" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                  Author Portfolio
                </a>
                <a href="https://github.com/Drix10/ai-resources" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                  GitHub Repo
                </a>
                <a href="https://www.linkedin.com/in/drix10" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                  LinkedIn
                </a>
                <Link href="/categories" className="hover:text-zinc-100 hover:underline">
                  Categories
                </Link>
                <Link href="/sitemap.xml" className="hover:text-zinc-100 hover:underline">
                  Sitemap
                </Link>
              </div>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
