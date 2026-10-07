import { cleanTitle, formatDate, getAllArticles, getArticleBySlug } from '@/lib/markdown';
import { jsonLd } from '@/lib/url';
import { PERSON_ID, PORTFOLIO_URL, SITE_NAME, SITE_URL, absolute, topicHref } from '@/lib/site';
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

const shorten = (text: string, max: number) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.replace(/\s+\S*$/, '') + '…';
};

export async function generateMetadata({ params }: { params: { slug: string[] } }): Promise<Metadata> {
  const article = getArticleBySlug(params.slug);
  if (!article) return { title: 'Article not found', robots: { index: false, follow: false } };

  const fullTitle = cleanTitle(article.title);
  // The <title> is capped so title + site name stays within what search results show; the page
  // heading and structured data keep the full title.
  const title = shorten(fullTitle, 56);
  const base = article.description.trim();
  const n = article.itemCount && article.itemCount > 1 ? ` with ${article.itemCount} sourced items` : '';
  const description = shorten(base.length >= 90 ? base : `${base} A ${article.category} digest${n}, ${formatDate(article.date)}, by Drishtant Ghosh.`.trim(), 158);
  return {
    title,
    description,
    alternates: { canonical: article.canonicalUrl },
    // The share image is generated per digest by /og/<slug> (title, topic and date on a card).
    openGraph: {
      title: `${fullTitle} | ${SITE_NAME}`,
      description,
      url: article.canonicalUrl,
      type: 'article',
      publishedTime: article.date,
      modifiedTime: article.date,
      authors: [PORTFOLIO_URL],
      section: article.category,
      tags: [article.category, ...(article.items || []).slice(0, 6).map(cleanTitle)],
      images: [{ url: absolute(`/og/${article.slug}`), width: 1200, height: 630, alt: fullTitle }],
    },
    twitter: { card: 'summary_large_image', title: fullTitle, description, creator: '@DrishtantGhosh', images: [absolute(`/og/${article.slug}`)] },
  };
}

// Outbound sources cited by a digest, taken from its rendered "Sources" lists.
function citedSources(sections: { html: string }[], limit = 25): string[] {
  const urls = new Set<string>();
  for (const s of sections) {
    for (const block of s.html.split('<h3 class="label sources">').slice(1)) {
      const list = block.split('<h3')[0];
      for (const m of list.matchAll(/<a href="(https?:\/\/[^"]+)"/g)) {
        const url = m[1].replace(/&amp;/g, '&');
        if (!url.startsWith(SITE_URL)) urls.add(url);
        if (urls.size >= limit) return [...urls];
      }
    }
  }
  return [...urls];
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

  const isEssay = article.category.toLowerCase() === 'personal';
  const headlineText = cleanTitle(article.title);
  const sources = citedSources(article.sections);

  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': isEssay ? 'BlogPosting' : 'TechArticle',
    '@id': `${article.canonicalUrl}#article`,
    headline: shorten(headlineText, 110),
    description: article.description,
    url: article.canonicalUrl,
    mainEntityOfPage: { '@type': 'WebPage', '@id': article.canonicalUrl },
    image: [absolute(`/og/${article.slug}`)],
    datePublished: article.date,
    dateModified: article.date,
    inLanguage: 'en',
    articleSection: article.category,
    keywords: [article.category, ...(article.items || []).slice(0, 8).map(cleanTitle)].join(', '),
    wordCount: article.wordCount,
    timeRequired: `PT${article.readingTimeMinutes}M`,
    isAccessibleForFree: true,
    about: { '@type': 'Thing', name: article.category },
    isPartOf: { '@id': `${SITE_URL}/#website` },
    ...(isFolderResource ? { isBasedOn: githubFileUrl } : {}),
    ...(sources.length ? { citation: sources.map((url) => ({ '@type': 'CreativeWork', url })) } : {}),
    ...(article.sections.length > 1
      ? { hasPart: article.sections.slice(0, 30).map((s) => ({ '@type': 'WebPageElement', name: s.title, url: `${article.canonicalUrl}#${s.id}` })) }
      : {}),
    author: { '@type': 'Person', '@id': PERSON_ID, name: 'Drishtant Ghosh', url: PORTFOLIO_URL },
    publisher: { '@type': 'Organization', '@id': `${SITE_URL}/#org`, name: SITE_NAME, url: SITE_URL, logo: { '@type': 'ImageObject', url: `${SITE_URL}/avatar.png` } },
  };
  const techArticleSchema = articleSchema;

  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: article.category, item: absolute(topicHref(article.categorySlug)) },
      { '@type': 'ListItem', position: 3, name: headlineText, item: article.canonicalUrl },
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
          <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" className="shrink-0">
            <Image src="/avatar.png" alt="Drishtant Ghosh" width={48} height={48} className="h-12 w-12 rounded-full object-cover" />
          </a>
          <div className="text-[0.9375rem]">
            <p className="font-semibold text-ink">Drishtant Ghosh</p>
            <p className="mt-0.5 max-w-[52ch] text-body">
              Technical founder and engineer working on AI systems, developer infrastructure and cybersecurity.
            </p>
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
              <a href={PORTFOLIO_URL} target="_blank" rel="noopener noreferrer" className="link">Portfolio</a>
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
