import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { formatDate, getAllCategories } from '@/lib/markdown';
import { SITE_URL, PERSON_ID, absolute, topicHref } from '@/lib/site';
import { jsonLd, safeDecode } from '@/lib/url';
import TopicView, { topicArticles } from '@/components/TopicView';

export const dynamicParams = true;
export const revalidate = 3600;

export function generateStaticParams() {
  return getAllCategories().map((c) => ({ category: c.slug }));
}

// "/categories/AI%20Education" and "/categories/ai-education" are one topic: send the first to the second.
function resolve(param: string) {
  const decoded = safeDecode(param).toLowerCase();
  const topic = getAllCategories().find((c) => c.slug === param || c.slug === decoded || c.name.toLowerCase() === decoded);
  return topic ?? null;
}

export function generateMetadata({ params }: { params: { category: string } }): Metadata {
  const topic = resolve(params.category);
  if (!topic) return { title: 'Topic not found', robots: { index: false } };
  const items = topicArticles(topic.slug);
  const latest = items[0] ? formatDate(items[0].date) : '';
  const description = `${items.length} sourced digest${items.length === 1 ? '' : 's'} on ${topic.name}: short, linked summaries of what shipped and what was announced${latest ? `, newest ${latest}` : ''}. By Drishtant Ghosh (Drix10).`;
  return {
    title: `${topic.name}: sourced digests`,
    description,
    alternates: { canonical: absolute(topicHref(topic.slug)) },
    openGraph: { title: `${topic.name}: sourced digests | Drix10 Blog`, description, url: absolute(topicHref(topic.slug)), type: 'website' },
    twitter: { card: 'summary_large_image', title: `${topic.name}: sourced digests`, description },
  };
}

export default function TopicPage({ params }: { params: { category: string } }) {
  const topic = resolve(params.category);
  if (!topic) notFound();
  if (params.category !== topic.slug) permanentRedirect(topicHref(topic.slug));

  const items = topicArticles(topic.slug);
  const url = absolute(topicHref(topic.slug));
  const hubSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': `${url}#collection`,
    name: `${topic.name}: sourced digests`,
    url,
    inLanguage: 'en',
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: { '@type': 'Thing', name: topic.name },
    author: { '@id': PERSON_ID },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.slice(0, 20).map((a, i) => ({ '@type': 'ListItem', position: i + 1, url: a.canonicalUrl, name: a.title.replace(/^[^\p{L}\p{N}]+/u, '') })),
    },
  };
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Topics', item: absolute('/categories') },
      { '@type': 'ListItem', position: 3, name: topic.name, item: url },
    ],
  };

  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(hubSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }} />
      <TopicView slug={topic.slug} page={1} />
    </div>
  );
}
