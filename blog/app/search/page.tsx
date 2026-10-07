import Link from 'next/link';
import type { Metadata } from 'next';
import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { searchArticles } from '@/lib/search';
import { searchUrl } from '@/lib/url';
import { absolute } from '@/lib/site';
import SearchBar from '@/components/SearchBar';
import DigestList from '@/components/DigestList';
import Pagination from '@/components/Pagination';

interface PageProps {
  searchParams: { q?: string; search?: string; topic?: string; sort?: string; page?: string };
}

// Search results are for readers, not for the index: every query is a new URL with thin content.
export const metadata: Metadata = {
  title: 'Search the archive',
  robots: { index: false, follow: true },
  alternates: { canonical: absolute('/') },
};

export default function SearchPage({ searchParams }: PageProps) {
  const q = (searchParams.q || searchParams.search || '').slice(0, 100);
  const topic = searchParams.topic || '';
  const sort = ['newest', 'quick', 'alphabetical'].includes(searchParams.sort || '') ? (searchParams.sort as string) : 'newest';
  const rawPage = parseInt(searchParams.page || '1', 10);

  const topics = getAllCategories();
  const result = searchArticles({ q, category: topic, sort, page: Number.isInteger(rawPage) ? rawPage : 1, limit: 20 });
  const activeTopic = topics.find((t) => t.slug === topic);
  const total = getAllArticles().length;
  const groupByDate = sort === 'newest' && !q;

  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="display text-[clamp(2.2rem,6vw,3.75rem)] font-bold leading-[1.04] text-ink">Search the archive</h1>
        <p className="mt-4 text-faint">{total.toLocaleString('en-US')} digests. Search covers every item title and each digest&rsquo;s opening text.</p>
      </header>

      <section aria-labelledby="results" className="mt-8 max-w-[52rem]">
        <SearchBar q={q} topic={topic} sort={sort} topics={topics} />

        <h2 id="results" className="mt-8 text-[0.9375rem] font-normal text-faint" aria-live="polite">
          {result.totalCount === 0
            ? 'No digests match.'
            : `${result.totalCount.toLocaleString('en-US')} digest${result.totalCount === 1 ? '' : 's'}${activeTopic ? ` in ${activeTopic.name}` : ''}${q ? ` matching "${q}"` : ''}`}
          {result.totalPages > 1 ? `, page ${result.page} of ${result.totalPages}` : ''}
        </h2>

        {result.articles.length === 0 ? (
          <div className="mt-6 max-w-md space-y-3">
            <p className="font-serif text-[1.25rem] text-ink">Nothing matches that search.</p>
            <p className="text-body">Try fewer words, or a tool or company name instead of a phrase.</p>
            <Link href="/" className="link inline-block">
              Browse the newest digests
            </Link>
          </div>
        ) : (
          <DigestList articles={result.articles} groupByDate={groupByDate} showTopic={!activeTopic} />
        )}

        <Pagination page={result.page} totalPages={result.totalPages} href={(p) => searchUrl({ q, topic, sort, page: p })} />
      </section>
    </div>
  );
}
