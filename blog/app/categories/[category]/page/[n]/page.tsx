import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getAllCategories } from '@/lib/markdown';
import { SITE_URL, absolute, topicHref } from '@/lib/site';
import { jsonLd } from '@/lib/url';
import TopicView, { topicArticles, topicPageCount } from '@/components/TopicView';

export const revalidate = 3600;
export const dynamicParams = false;

// Pages 2.. of every topic that has them.
export function generateStaticParams() {
  return getAllCategories().flatMap((c) =>
    Array.from({ length: topicPageCount(c.slug) - 1 }, (_, i) => ({ category: c.slug, n: String(i + 2) })),
  );
}

const parse = (slug: string, raw: string) => {
  const n = Number(raw);
  const items = topicArticles(slug);
  return items.length > 0 && Number.isInteger(n) && n >= 2 && n <= topicPageCount(slug) ? { n, name: items[0].category } : null;
};

export function generateMetadata({ params }: { params: { category: string; n: string } }): Metadata {
  const page = parse(params.category, params.n);
  if (!page) return { title: 'Not found', robots: { index: false } };
  return {
    title: `${page.name}: sourced digests, page ${page.n}`,
    description: `Page ${page.n} of the ${page.name} digests: short, sourced summaries by Drishtant Ghosh (Drix10), newest first.`,
    alternates: { canonical: absolute(topicHref(params.category, page.n)) },
  };
}

export default function TopicPageN({ params }: { params: { category: string; n: string } }) {
  const page = parse(params.category, params.n);
  if (!page) notFound();
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Topics', item: absolute('/categories') },
      { '@type': 'ListItem', position: 3, name: page.name, item: absolute(topicHref(params.category)) },
      { '@type': 'ListItem', position: 4, name: `Page ${page.n}`, item: absolute(topicHref(params.category, page.n)) },
    ],
  };
  return (
    <div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(breadcrumbSchema) }} />
      <TopicView slug={params.category} page={page.n} />
    </div>
  );
}
