import type { Metadata, Viewport } from 'next';
import './globals.css';

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
    default: 'Drix10 Blogs — Engineering Breakdowns & AI Knowledge Base',
    template: '%s | Drix10 Blogs',
  },
  description: 'Curated technical research, system architectures, cybersecurity breakdowns, and AI engineering notes by Drix10.',
  keywords: [
    'AI Engineering',
    'Cybersecurity',
    'System Architecture',
    'Software Development',
    'Drix10',
    'Technical Breakdowns',
    'LLM Engineering',
    'Agent Workflows'
  ],
  authors: [{ name: 'Drix10', url: 'https://drix10.com' }],
  creator: 'Drix10',
  publisher: 'Drix10',
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
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://blogs.drix10.com',
    siteName: 'Drix10 Blogs',
    title: 'Drix10 Blogs — Engineering Breakdowns & AI Knowledge Base',
    description: 'Curated technical research, system architectures, cybersecurity breakdowns, and AI engineering notes.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Drix10 Blogs — Engineering Breakdowns & AI Knowledge Base',
    description: 'Curated technical research, system architectures, and AI engineering notes.',
    creator: '@drix10',
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
  const searchSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    url: 'https://blogs.drix10.com',
    name: 'Drix10 Blogs',
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://blogs.drix10.com/?search={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang="en" className="dark scroll-smooth">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(searchSchema) }}
        />
      </head>
      <body className="min-h-screen flex flex-col bg-[#09090b] text-[#fafafa] antialiased selection:bg-zinc-800 selection:text-zinc-100 font-sans overflow-x-hidden">
        {/* Mobile-First Sticky Header */}
        <header className="border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-3.5 sm:px-4 h-14 flex items-center justify-between gap-2">
            <a href="/" className="flex items-center gap-2 group min-h-[44px]">
              <span className="w-7 h-7 rounded-md bg-zinc-100 text-zinc-950 flex items-center justify-center font-bold text-xs shadow-sm">
                D
              </span>
              <span className="font-semibold text-sm tracking-tight text-zinc-100 group-hover:text-zinc-300 transition-colors">
                drix10 <span className="text-zinc-500 font-normal">/ blog</span>
              </span>
            </a>
            
            <div className="flex items-center gap-2">
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
              <span className="font-semibold text-zinc-300">Drix10</span>
              <span className="hidden sm:inline">—</span>
              <span>Autonomous Tech Curation & Engineering Hub</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-zinc-400">
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
              <a href="/sitemap.xml" className="hover:text-zinc-100 hover:underline min-h-[32px] flex items-center">
                Sitemap
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
