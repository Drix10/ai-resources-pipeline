import HeaderLiveCounter from '@/components/HeaderLiveCounter';
import Link from 'next/link';
import Image from 'next/image';
import { Inter } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
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
        description: 'AI Engineer, serial founder, and cybersecurity researcher. Author and curator of 8,950+ technical engineering breakdowns at Drix10 Blogs.',
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
      <body className={`${inter.variable} font-sans min-h-screen flex flex-col bg-[#09090b] text-[#fafafa] antialiased selection:bg-zinc-800 selection:text-zinc-100 overflow-x-hidden`}>
        {/* Mobile-First Sticky Header */}
        <header className="border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-3.5 sm:px-4 h-14 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <a 
                href="https://drix10.com" 
                target="_blank" 
                rel="noreferrer"
                title="Drishtant Ghosh (Drix10) Portfolio"
                className="flex items-center gap-2 group min-h-[44px]"
              >
                <Image
                  src="/avatar.png"
                  alt="Drishtant Ghosh (Drix10)"
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded-full object-cover border border-zinc-700 shadow-sm group-hover:border-zinc-400 transition-colors"
                />
                <span className="font-semibold text-sm tracking-tight text-zinc-100 group-hover:text-white transition-colors">
                  drix10
                </span>
              </a>
              <span className="text-zinc-600 font-light select-none">/</span>
              <Link 
                href="/" 
                className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors py-2 font-medium"
              >
                blog
              </Link>
              <span className="text-zinc-600 font-light select-none">/</span>
              <Link 
                href="/about" 
                className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors py-2 font-medium"
              >
                about
              </Link>
            </div>
            
            <div className="flex items-center gap-2">
              <HeaderLiveCounter />
              <a 
                href="https://github.com/Drix10" 
                target="_blank" 
                rel="noreferrer"
                aria-label="GitHub Profile"
                className="text-xs font-medium px-2.5 sm:px-3 py-2 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-100 transition-colors min-h-[36px] flex items-center justify-center"
              >
                GitHub
              </a>
              <a 
                href="https://www.linkedin.com/in/drix10" 
                target="_blank" 
                rel="noreferrer"
                aria-label="Connect on LinkedIn"
                className="text-xs font-medium px-2.5 sm:px-3 py-2 rounded-md bg-zinc-100 hover:bg-zinc-200 text-zinc-950 transition-colors min-h-[36px] flex items-center justify-center font-semibold"
              >
                <span className="hidden xs:inline">Connect on </span>LinkedIn
              </a>
            </div>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-3.5 sm:px-4 py-6 sm:py-8">
          {children}
        </main>

        {/* Mobile Responsive High-DR SEO Authority Footer */}
        <footer className="border-t border-zinc-800/80 bg-[#09090b] py-8 sm:py-10 mt-12 sm:mt-16 text-xs text-zinc-500">
          <div className="max-w-5xl mx-auto px-3.5 sm:px-4 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2">
              <span className="font-semibold text-zinc-300">Drishtant Ghosh (Drix10)</span>
              <span className="hidden sm:inline">—</span>
              <span>Autonomous Tech Curation & Engineering Hub</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-zinc-400">
              <Link href="/about" className="hover:text-zinc-100 hover:underline min-h-[32px] flex items-center">
                About Author
              </Link>
              <span className="text-zinc-700">•</span>
              <a href="https://drix10.com" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline min-h-[32px] flex items-center">
                drix10.com
              </a>
              <span className="text-zinc-700">•</span>
              <a href="https://github.com/Drix10/ai-resources" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline min-h-[32px] flex items-center">
                GitHub Repo
              </a>
              <span className="text-zinc-700">•</span>
              <a href="https://www.linkedin.com/in/drix10" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline min-h-[32px] flex items-center">
                LinkedIn
              </a>
              <span className="text-zinc-700">•</span>
              <Link href="/sitemap.xml" className="hover:text-zinc-100 hover:underline min-h-[32px] flex items-center">
                Sitemap
              </Link>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
