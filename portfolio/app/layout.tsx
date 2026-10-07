import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import { Bricolage_Grotesque, Newsreader } from 'next/font/google';
import CommandPalette from '@/components/CommandPalette';
import ThemeToggle from '@/components/ThemeToggle';
import LocalTimeBadge from '@/components/LocalTimeBadge';
import { BLOG_URL, DESCRIPTION, PERSON_ID, SITE_URL, TITLE, jsonLd } from '@/lib/site';
import './globals.css';

// Display and interface: a variable grotesque whose width axis lets the name set tight.
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  axes: ['wdth', 'opsz'],
});

// Reading text: a serif drawn for screens, used for every paragraph.
const text = Newsreader({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-text',
  style: ['normal', 'italic'],
  axes: ['opsz'],
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f1f3f0' },
    { media: '(prefers-color-scheme: dark)', color: '#0c1320' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

// Runs before first paint so a saved theme never flashes the wrong palette.
const themeScript = `try{var q=new URLSearchParams(location.search).get('theme');var t=(q==='light'||q==='dark')?q:localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

const NAV = [
  { href: '/#work', label: 'Work' },
  { href: '/#experience', label: 'Experience' },
  { href: '/#writing', label: 'Writing' },
  { href: '/#contact', label: 'Contact' },
];

const ELSEWHERE = [
  { href: 'https://github.com/Drix10', label: 'GitHub' },
  { href: 'https://www.linkedin.com/in/drix10', label: 'LinkedIn' },
  { href: 'https://x.com/DrishtantGhosh', label: 'X' },
  { href: 'https://peerlist.io/drix10', label: 'Peerlist' },
  { href: BLOG_URL, label: 'Blog' },
];

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s | Drishtant Ghosh (Drix10)',
  },
  description: DESCRIPTION,
  keywords: [
    'Drishtant Ghosh',
    'Drix10',
    'Drishtant Ghosh AI Engineer',
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
    'Agent infrastructure'
  ],
  authors: [{ name: 'Drishtant Ghosh (Drix10)', url: SITE_URL }],
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
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
    other: process.env.BING_SITE_VERIFICATION ? { 'msvalidate.01': process.env.BING_SITE_VERIFICATION } : undefined,
  },
  icons: {
    icon: '/avatar.png',
    shortcut: '/avatar.png',
    apple: '/avatar.png',
  },
  openGraph: {
    type: 'profile',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Drishtant Ghosh (Drix10)',
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Drix10 — AI Systems Engineer & 1x Acquired Founder',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    creator: '@DrishtantGhosh',
    images: ['/og-image.png'],
  },
  alternates: {
    canonical: SITE_URL,
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
        '@id': PERSON_ID,
        mainEntityOfPage: { '@id': `${SITE_URL}/#profile` },
        name: 'Drishtant Ghosh',
        alternateName: ['Drix10', 'drix10', 'Drix'],
        url: SITE_URL,
        image: `${SITE_URL}/avatar.png`,
        homeLocation: { '@type': 'Place', name: 'Bengaluru, Karnataka, India' },
        jobTitle: 'AI Systems Engineer & 1x Acquired Founder',
        email: 'ggdrishtant@gmail.com',
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
        award: ['Backdrop Build v4 Finalist', 'Backdrop Build v6 Finalist', 'NYC Code Quest 3rd place'],
        description:
          'Drishtant Ghosh (known online as Drix10) is an AI Systems Engineer, 1x Acquired Serial Founder (ReeF), and a B.Sc. Cybersecurity student at Dayananda Sagar University. Creator of CosLynx and author of technical breakdowns at Drix10 Blogs.',
        sameAs: [
          'https://github.com/Drix10',
          'https://www.linkedin.com/in/drix10',
          'https://peerlist.io/drix10',
          'https://medium.com/@drix10',
          'https://dev.to/drix10',
          'https://x.com/DrishtantGhosh',
          BLOG_URL,
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
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        inLanguage: 'en',
        name: 'Drishtant Ghosh (Drix10) Portfolio',
        description: 'Official portfolio and engineering showcase of Drishtant Ghosh (Drix10).',
        publisher: {
          '@id': PERSON_ID,
        },
      },
      {
        '@type': 'ProfilePage',
        '@id': `${SITE_URL}/#profile`,
        url: SITE_URL,
        name: TITLE,
        inLanguage: 'en',
        isPartOf: { '@id': `${SITE_URL}/#website` },
        mainEntity: { '@id': PERSON_ID },
      },
    ],
  };

  return (
    <html lang="en" className={`${display.variable} ${text.variable} scroll-smooth`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(profileSchema) }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:text-paper"
        >
          Skip to content
        </a>

        <header className="sticky top-0 z-40 border-b border-rule/70 bg-paper/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between gap-6 px-5 sm:px-8">
            <Link href="/" className="text-[1.0625rem] font-semibold tracking-tight text-ink" style={{ fontVariationSettings: "'wdth' 92" }}>
              Drishtant Ghosh
            </Link>

            <nav aria-label="Primary" className="hidden items-center gap-7 text-[0.9375rem] md:flex">
              {NAV.map((item) => (
                <Link key={item.href} href={item.href} className="text-body transition-colors hover:text-ink">
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="flex items-center gap-1.5">
              <CommandPalette />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        <footer className="border-t border-rule/70">
          <div className="mx-auto flex max-w-[1100px] flex-col gap-6 px-5 py-10 text-[0.9375rem] sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="space-y-1">
              <p className="font-medium text-ink">Drishtant Ghosh</p>
              <LocalTimeBadge />
            </div>
            <ul className="flex flex-wrap gap-x-6 gap-y-2">
              {ELSEWHERE.map((item) => (
                <li key={item.href}>
                  <a href={item.href} target="_blank" rel="me noreferrer" className="text-body transition-colors hover:text-ink">
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </body>
    </html>
  );
}
