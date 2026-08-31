import type { Metadata, Viewport } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Inter } from 'next/font/google';
import CommandPalette from '@/components/CommandPalette';
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
};

export const metadata: Metadata = {
  metadataBase: new URL('https://drix10.com'),
  title: {
    default: 'Drishtant Ghosh (Drix10) — Co-Founder @ PartPilot | AI Systems Engineer & 1x Acq Founder',
    template: '%s | Drishtant Ghosh (Drix10)',
  },
  description:
    'Drishtant Ghosh (Drix10) is a Co-Founder @ PartPilot, 1x Acquired Serial Founder (ReeF), Canopy @ Founders, Inc., and Cybersecurity Researcher at Dayananda Sagar University. Building autonomous LLM architectures and high-performance full-stack products.',
  keywords: [
    'Drishtant Ghosh',
    'Drix10',
    'PartPilot',
    'Drix10 Portfolio',
    'Drishtant Ghosh AI',
    'Drishtant Ghosh Founder',
    'CosLynx',
    'ReeF Discord Game',
    'Canopy Founders Inc',
    'AI Systems Engineer',
    'Dayananda Sagar University Cybersecurity',
    'IBM AI Engineering Professional Certificate',
    'Bengaluru AI Engineer',
    'Autonomous Multi-Agent Systems',
    'Next.js 14 Specialist'
  ],
  authors: [{ name: 'Drishtant Ghosh (Drix10)', url: 'https://drix10.com' }],
  creator: 'Drishtant Ghosh (Drix10)',
  publisher: 'Drishtant Ghosh',
  applicationName: 'Drix10 Portfolio',
  robots: {
    index: true,
    follow: true,
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
    type: 'profile',
    locale: 'en_US',
    url: 'https://drix10.com',
    siteName: 'Drishtant Ghosh (Drix10)',
    title: 'Drishtant Ghosh (Drix10) — Co-Founder @ PartPilot | AI Systems Engineer',
    description:
      'Co-Founder @ PartPilot, 1x Acquired Founder (ReeF), Canopy @ Founders, Inc., and Cybersecurity Researcher. Author of technical breakdowns at Drix10 Blogs.',
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
    title: 'Drishtant Ghosh (Drix10) — Co-Founder @ PartPilot | AI Systems Engineer',
    description:
      'Co-Founder @ PartPilot, 1x Acquired Founder (ReeF), Canopy @ Founders, Inc., and Cybersecurity Researcher at DSU.',
    creator: '@DrishtantGhosh',
    images: ['/avatar.png'],
  },
  alternates: {
    canonical: 'https://drix10.com',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profileSchema = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Person',
        '@id': 'https://drix10.com/#person',
        name: 'Drishtant Ghosh',
        alternateName: ['Drix10', 'drix10', 'Drix'],
        url: 'https://drix10.com',
        image: 'https://drix10.com/avatar.png',
        jobTitle: 'Co-Founder @ PartPilot & AI Systems Engineer',
        email: 'ggdrishtant@gmail.com',
        worksFor: {
          '@type': 'Organization',
          name: 'PartPilot',
        },
        alumniOf: [
          {
            '@type': 'EducationalOrganization',
            name: 'Dayananda Sagar University',
          },
          {
            '@type': 'EducationalOrganization',
            name: "St. Xavier's High School",
          },
        ],
        hasCredential: {
          '@type': 'EducationalOccupationalCredential',
          name: 'IBM AI Engineering Professional Certificate',
          credentialCategory: 'Professional Certificate',
          recognizedBy: {
            '@type': 'Organization',
            name: 'IBM',
          },
        },
        award: '2x International Hackathon Winner',
        description:
          'Drishtant Ghosh (known online as Drix10) is a Co-Founder @ PartPilot, 1x Acquired Serial Founder (ReeF), and Cybersecurity Researcher at Dayananda Sagar University. Creator of CosLynx and author of technical breakdowns at Drix10 Blogs.',
        sameAs: [
          'https://github.com/Drix10',
          'https://www.linkedin.com/in/drix10',
          'https://peerlist.io/drix10',
          'https://medium.com/@drix10',
          'https://dev.to/drix10',
          'https://x.com/DrishtantGhosh',
          'https://blogs.drix10.com',
        ],
        knowsAbout: [
          'Artificial Intelligence',
          'Large Language Models',
          'Autonomous Agent Workflows',
          'Cybersecurity',
          'Distributed Systems',
          'Full Stack Web Development',
          'Next.js & React',
          'TypeScript & Python',
          'Prisma & Turso DB',
          'WebSockets',
        ],
        hasOccupation: {
          '@type': 'Occupation',
          name: 'AI Software Engineer & Systems Architect',
          occupationalCategory: '15-1252.00',
        },
      },
      {
        '@type': 'WebSite',
        '@id': 'https://drix10.com/#website',
        url: 'https://drix10.com',
        name: 'Drishtant Ghosh (Drix10) Portfolio',
        description: 'Official portfolio and engineering showcase of Drishtant Ghosh (Drix10).',
        publisher: {
          '@id': 'https://drix10.com/#person',
        },
      },
    ],
  };

  return (
    <html lang="en" className="dark scroll-smooth">
      <head>
        <link rel="icon" href="/avatar.png" />
      </head>
      <body className={`${inter.variable} font-sans min-h-screen flex flex-col bg-[#09090b] text-zinc-100 selection:bg-zinc-800 selection:text-zinc-100`}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(profileSchema) }}
        />

        {/* Global Navigation Header */}
        <header className="border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/" className="flex items-center gap-2.5 group">
                <Image
                  src="/avatar.png"
                  alt="Drishtant Ghosh"
                  width={32}
                  height={32}
                  priority
                  className="w-8 h-8 rounded-full object-cover border border-zinc-700 shadow-sm group-hover:border-zinc-400 transition-colors"
                />
                <div className="flex items-center gap-1.5 font-bold tracking-tight text-sm text-zinc-100 group-hover:text-white transition-colors">
                  <span>drix10</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono font-normal">
                    portfolio
                  </span>
                </div>
              </Link>
            </div>

            {/* Desktop Navigation Links */}
            <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-zinc-400">
              <a href="#about" className="hover:text-zinc-100 transition-colors">About</a>
              <a href="#experience" className="hover:text-zinc-100 transition-colors">Experience</a>
              <a href="#projects" className="hover:text-zinc-100 transition-colors">Projects</a>
              <a href="#education" className="hover:text-zinc-100 transition-colors">Education</a>
              <a href="#skills" className="hover:text-zinc-100 transition-colors">Skills</a>
              <a
                href="https://blogs.drix10.com"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1 transition-colors font-semibold"
              >
                <span>Blogs</span>
                <span>↗</span>
              </a>
            </nav>

            <div className="flex items-center gap-2.5">
              <CommandPalette />
              <a
                href="https://github.com/Drix10"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors"
              >
                GitHub
              </a>
              <a
                href="https://www.linkedin.com/in/drix10"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-950 transition-colors"
              >
                LinkedIn
              </a>
            </div>
          </div>
        </header>

        {/* Main Body */}
        <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-16 sm:space-y-20">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-800/80 bg-[#09090b] py-10 mt-16 text-xs text-zinc-500">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row items-center gap-2">
              <span className="font-semibold text-zinc-300">Drishtant Ghosh (Drix10)</span>
              <span className="hidden sm:inline text-zinc-700">•</span>
              <span>Co-Founder @ PartPilot | 1x Acq Founder | AI Systems Engineer</span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 text-zinc-400">
              <a href="https://blogs.drix10.com" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                Drix10 Blogs
              </a>
              <a href="https://github.com/Drix10" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                GitHub
              </a>
              <a href="https://www.linkedin.com/in/drix10" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                LinkedIn
              </a>
              <a href="https://peerlist.io/drix10" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                Peerlist
              </a>
              <a href="https://x.com/DrishtantGhosh" target="_blank" rel="noreferrer" className="hover:text-zinc-100 hover:underline">
                X / Twitter
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
