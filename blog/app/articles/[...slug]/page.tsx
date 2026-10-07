import { cleanTitle, formatDate, getAllArticles, getArticleBySlug } from '@/lib/markdown';
import { jsonLd } from '@/lib/url';
import ReadingProgress from '@/components/ReadingProgress';
import DigestToc from '@/components/DigestToc';
import CopyLink from '@/components/CopyLink';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const articles = getAllArticles();
  return articles.slice(0, 60).map((article) => ({
    slug: article.slug.split('/'),
  }));
}

export async function generateMetadata({ params }: { params: { slug: string[] } }): Promise<Metadata> {
  const article = getArticleBySlug(params.slug);
  if (!article) return { title: 'Article Not Found' };

  return {
    title: cleanTitle(article.title),
    description: article.description,
    alternates: {
      canonical: article.canonicalUrl,
    },
    openGraph: {
      title: cleanTitle(article.title) + ' | Drishtant Ghosh (Drix10)',
      description: article.description,
      url: article.canonicalUrl,
      type: 'article',
      publishedTime: article.date,
      authors: ['https://drix10.com', 'Drishtant Ghosh (Drix10)'],
      tags: [article.category, 'Drishtant Ghosh', 'Drix10', 'Cybersecurity', 'AI Engineering'],
      images: [
        {
          url: '/og-image.png',
          width: 1200,
          height: 630,
          alt: cleanTitle(article.title),
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: cleanTitle(article.title),
      description: article.description,
      creator: '@DrishtantGhosh',
      images: ['/og-image.png'],
    },
  };
}

export default function ArticlePage({ params }: { params: { slug: string[] } }) {
  const article = getArticleBySlug(params.slug);
  if (!article) notFound();

  const isFolderResource =
    article.category.toLowerCase() !== 'personal' &&
    article.category.toLowerCase() !== 'linkedin insights';

  const githubFileUrl = isFolderResource
    ? `https://github.com/Drix10/ai-resources/blob/main/${encodeURIComponent(article.category)}/${encodeURIComponent(article.filename)}`
    : 'https://github.com/Drix10/ai-resources';

  const techArticleSchema = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: cleanTitle(article.title),
    description: article.description,
    url: article.canonicalUrl,
    datePublished: article.date,
    dateModified: article.date,
    wordCount: article.wordCount,
    about: {
      '@type': 'Thing',
      name: article.category,
    },
    ...(isFolderResource ? { isBasedOn: githubFileUrl } : {}),
    author: {
      '@type': 'Person',
      '@id': 'https://drix10.com/#person',
      name: 'Drishtant Ghosh',
      alternateName: ['Drix10', 'drix10'],
      url: 'https://drix10.com',
      image: 'https://blogs.drix10.com/avatar.png',
      description: 'Technical founder and engineer working across AI systems, developer infrastructure, and cybersecurity.',
      sameAs: [
        'https://github.com/Drix10',
        'https://www.linkedin.com/in/drix10',
        'https://peerlist.io/drix10',
        'https://medium.com/@drix10',
        'https://dev.to/drix10',
        'https://x.com/DrishtantGhosh',
      ],
    },
    publisher: {
      '@type': 'Organization',
      name: 'Drix10 Blogs',
      url: 'https://blogs.drix10.com',
      logo: {
        '@type': 'ImageObject',
        url: 'https://blogs.drix10.com/avatar.png',
      },
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': article.canonicalUrl,
    },
  };

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Home',
        item: 'https://blogs.drix10.com',
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: article.category,
        item: 'https://blogs.drix10.com/categories/' + article.categorySlug,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: cleanTitle(article.title),
        item: article.canonicalUrl,
      },
    ],
  };

  const digestSections = article.sections;
  const isDigest = digestSections.length > 0;
  const hasToc = digestSections.length > 1;
  // The page heading is the digest's lead item, so the page is named for what it leads with.
  const headline = cleanTitle(isDigest ? digestSections[0].title : article.title) || cleanTitle(article.title);
  const siblings = getAllArticles().filter((a) => a.category === article.category && a.slug !== article.slug);
  const related = siblings.slice(0, 4);

  // Single essays carry their own H1 in the markdown; the page header already shows it.
  const essayHtml = article.htmlContent.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>\s*/i, '');

  return (
    <div>
      <ReadingProgress />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(techArticleSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }} />

      <nav aria-label="Breadcrumb" className="text-[0.9375rem] text-faint">
        <ol className="flex flex-wrap items-center gap-x-2">
          <li>
            <Link href="/categories" className="hover:text-ink">
              Topics
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/categories/${article.categorySlug}`} className="hover:text-ink">
              {article.category}
            </Link>
          </li>
        </ol>
      </nav>

      <header className="mt-6 max-w-[48rem]">
        <h1 className="display text-[clamp(2rem,5.4vw,3.4rem)] font-bold leading-[1.08] text-ink">
          {headline}
        </h1>
        <p className="mt-4 text-[0.9375rem] text-faint">
          <time dateTime={article.date}>{formatDate(article.date)}</time>
          {hasToc ? `, ${digestSections.length} items in ${article.category}` : ''}, {article.readingTimeMinutes} min read
        </p>
      </header>

      <div className={`mt-10 grid gap-x-14 gap-y-8 border-t border-rule pt-10 ${hasToc ? 'lg:grid-cols-[16rem_minmax(0,1fr)]' : ''}`}>
        {hasToc && <DigestToc items={digestSections.map((s) => ({ id: s.id, title: s.title }))} />}

        <article className="digest min-w-0">
          {isDigest ? (
            digestSections.map((s, i) => (
              <section key={s.id} id={s.id} className={i === 0 ? '' : 'mt-12 border-t border-rule pt-12'}>
                {/* The first item is already the page heading above, so it gets no heading of its own. */}
                {i > 0 && (
                  <div className="flex items-start justify-between gap-4">
                    <h2 className="display max-w-[36ch] text-[1.75rem] font-semibold leading-tight text-ink sm:text-[2rem]" style={{ margin: 0 }}>
                      {s.title}
                    </h2>
                    <CopyLink id={s.id} label={s.title} />
                  </div>
                )}
                <div className={i > 0 ? 'mt-4' : ''} dangerouslySetInnerHTML={{ __html: s.html }} />
              </section>
            ))
          ) : (
            <div className="mx-auto max-w-[44rem] lg:mx-0" dangerouslySetInnerHTML={{ __html: essayHtml }} />
          )}
        </article>
      </div>

      <div className="mt-16 space-y-12 border-t border-rule pt-10">
        {isFolderResource && (
          <p className="text-[0.9375rem] text-body">
            This digest is also a plain Markdown file in the{' '}
            <a href={githubFileUrl} target="_blank" rel="noopener noreferrer" className="link">
              ai-resources repository on GitHub
            </a>
            .
          </p>
        )}

        {related.length > 0 && (
          <section aria-labelledby="related">
            <h2 id="related" className="mb-2 font-semibold text-ink">
              More from {article.category}
            </h2>
            <ul className="divide-y divide-rule/80 border-y border-rule/80">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link href={`/articles/${r.slug}`} className="group flex items-baseline justify-between gap-6 py-3.5">
                    <span className="text-ink transition-colors group-hover:text-accent">{cleanTitle(r.title)}</span>
                    <time dateTime={r.date} className="shrink-0 text-[0.875rem] tabular-nums text-faint">
                      {formatDate(r.date)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
            <Link href={`/categories/${article.categorySlug}`} className="link mt-4 inline-block text-[0.9375rem]">
              All {siblings.length + 1} in {article.category}
            </Link>
          </section>
        )}

        <aside className="flex items-start gap-4 border-t border-rule pt-8">
          <a href="https://drix10.com" target="_blank" rel="noopener noreferrer" className="shrink-0">
            <Image src="/avatar.png" alt="Drishtant Ghosh" width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
          </a>
          <div className="text-[0.9375rem]">
            <p className="font-semibold text-ink">Drishtant Ghosh</p>
            <p className="mt-0.5 max-w-[52ch] text-body">
              Technical founder and engineer working on AI systems, developer infrastructure and cybersecurity.
            </p>
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <a href="https://drix10.com" target="_blank" rel="noopener noreferrer" className="link">Portfolio</a>
              <a href="https://github.com/Drix10" target="_blank" rel="noopener noreferrer" className="link">GitHub</a>
              <a href="https://x.com/DrishtantGhosh" target="_blank" rel="noopener noreferrer" className="link">X</a>
              <a href="mailto:ggdrishtant@gmail.com" className="link">Email</a>
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
