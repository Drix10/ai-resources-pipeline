import Link from 'next/link';
import { Bricolage_Grotesque, JetBrains_Mono, Newsreader } from 'next/font/google';
import type { Metadata, Viewport } from 'next';
import { getAllCategories } from '@/lib/markdown';
import { Analytics } from '@vercel/analytics/next';
import ThemeToggle from '@/components/ThemeToggle';
import { jsonLd } from '@/lib/url';
import './globals.css';

// Same faces as drix10.com: a variable grotesque for interface and headings,
// a screen-drawn serif for everything you read, a monospace only for code.
const display = Bricolage_Grotesque({ subsets: ['latin'], display: 'swap', variable: '--font-display', axes: ['wdth', 'opsz'] });
const text = Newsreader({ subsets: ['latin'], display: 'swap', variable: '--font-text', style: ['normal', 'italic'], axes: ['opsz'] });
const code = JetBrains_Mono({ subsets: ['latin'], display: 'swap', variable: '--font-code' });

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f3f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1320' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
};

// Runs before first paint so a saved theme never flashes the wrong palette.
const themeScript = `try{var q=new URLSearchParams(location.search).get('theme');var t=q||localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

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
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Drix10 Blogs — Technical Research & Engineering Hub',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Drishtant Ghosh (Drix10) — Technical Research & Engineering Hub',
    description: 'Curated technical research, system architectures, and AI engineering notes by Drishtant Ghosh (Drix10).',
    creator: '@DrishtantGhosh',
    images: ['/og-image.png'],
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
        jobTitle: 'Technical Founder & Engineer',
        description: 'Technical founder and engineer working across AI systems, developer infrastructure, and cybersecurity. Author and curator at Drix10 Blogs.',
        sameAs: [
          'https://github.com/Drix10',
          'https://www.linkedin.com/in/drix10',
          'https://peerlist.io/drix10',
          'https://medium.com/@drix10',
          'https://dev.to/drix10',
          'https://x.com/DrishtantGhosh',
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
    <html lang="en" className={`${display.variable} ${text.variable} ${code.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="icon" href="/avatar.png" type="image/png" />
        <link rel="apple-touch-icon" href="/avatar.png" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(rootKnowledgeGraphSchema) }} />
      </head>
      <body className="flex min-h-screen flex-col overflow-x-hidden">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-40 border-b border-rule/70 bg-paper/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-6 px-5 sm:px-8">
            <Link href="/" className="display text-[1.0625rem] font-semibold text-ink">
              Drix10 Blog
            </Link>

            <nav aria-label="Primary" className="flex items-center gap-5 text-[0.9375rem] sm:gap-7">
              <Link href="/categories" className="text-body transition-colors hover:text-ink">
                Topics
              </Link>
              <Link href="/categories/personal" className="hidden text-body transition-colors hover:text-ink sm:inline">
                Founder notes
              </Link>
              <a href="https://drix10.com" target="_blank" rel="noopener noreferrer" className="hidden text-body transition-colors hover:text-ink sm:inline">
                Portfolio
              </a>
              <ThemeToggle />
            </nav>
          </div>
        </header>

        <main id="main" className="mx-auto w-full max-w-[1100px] flex-1 px-5 py-10 sm:px-8 sm:py-14">
          {children}
        </main>

        <footer className="border-t border-rule/70">
          <div className="mx-auto max-w-[1100px] space-y-8 px-5 py-10 text-[0.9375rem] sm:px-8">
            <div>
              <h2 className="mb-3 font-semibold text-ink">Popular topics</h2>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                {categories.slice(0, 14).map((c) => (
                  <li key={c.slug}>
                    <Link href={`/categories/${c.slug}`} className="text-body transition-colors hover:text-ink">
                      {c.name}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link href="/categories" className="link">
                    All {categories.length} topics
                  </Link>
                </li>
              </ul>
            </div>

            <div className="flex flex-col gap-4 border-t border-rule/70 pt-6 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-md text-faint">
                By Drishtant Ghosh. Short, sourced digests on AI, developer tools and security, collected daily.
              </p>
              <ul className="flex flex-wrap gap-x-5 gap-y-2">
                <li><a href="https://drix10.com" target="_blank" rel="noopener noreferrer" className="text-body hover:text-ink">Portfolio</a></li>
                <li><a href="https://github.com/Drix10" target="_blank" rel="noopener noreferrer" className="text-body hover:text-ink">GitHub</a></li>
                <li><a href="https://www.linkedin.com/in/drix10" target="_blank" rel="noopener noreferrer" className="text-body hover:text-ink">LinkedIn</a></li>
                <li><a href="https://x.com/DrishtantGhosh" target="_blank" rel="noopener noreferrer" className="text-body hover:text-ink">X</a></li>
                <li><a href="mailto:ggdrishtant@gmail.com" className="text-body hover:text-ink">Email</a></li>
                <li><Link href="/rss.xml" className="text-body hover:text-ink">RSS</Link></li>
                <li><Link href="/llms.txt" className="text-body hover:text-ink">llms.txt</Link></li>
                <li><Link href="/sitemap.xml" className="text-body hover:text-ink">Sitemap</Link></li>
              </ul>
            </div>
          </div>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
