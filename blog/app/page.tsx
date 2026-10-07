import Link from 'next/link';
import type { Metadata } from 'next';
import { Fragment } from 'react';
import { cleanTitle, formatDate, getAllArticles, getAllCategories } from '@/lib/markdown';
import { searchArticles } from '@/lib/search';
import { homeUrl } from '@/lib/url';
import SearchBar from '@/components/SearchBar';
import DigestRow from '@/components/DigestRow';
import Pagination from '@/components/Pagination';

interface PageProps {
  searchParams: { q?: string; search?: string; topic?: string; sort?: string; page?: string };
}

// Search and topic views are for readers; the canonical home stays one URL.
export function generateMetadata({ searchParams }: PageProps): Metadata {
  const filtered = Boolean(searchParams.q || searchParams.search || searchParams.topic || searchParams.page);
  return filtered ? { robots: { index: false, follow: true }, alternates: { canonical: 'https://blogs.drix10.com' } } : {};
}

export default function HomePage({ searchParams }: PageProps) {
  const q = (searchParams.q || searchParams.search || '').slice(0, 100);
  const topic = searchParams.topic || '';
  const sort = ['newest', 'quick', 'alphabetical'].includes(searchParams.sort || '') ? (searchParams.sort as string) : 'newest';
  const rawPage = parseInt(searchParams.page || '1', 10);

  const topics = getAllCategories();
  const result = searchArticles({ q, category: topic, sort, page: Number.isInteger(rawPage) ? rawPage : 1, limit: 20 });
  const total = getAllArticles().length;
  const activeTopic = topics.find((t) => t.slug === topic);
  const isDefaultView = !q && !topic && sort === 'newest' && result.page === 1;
  const essays = isDefaultView ? getAllArticles().filter((a) => a.category.toLowerCase() === 'personal') : [];

  // Group the newest-first list under date headings; other orders have no natural grouping.
  const groupByDate = sort === 'newest' && !q;
  let lastDate = '';

  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="display text-[clamp(2.4rem,7vw,4.5rem)] font-bold leading-[1.02] text-ink">
          Notes on AI, developer tools and security
        </h1>
        <p className="mt-5 max-w-[54ch] font-serif text-[1.25rem] leading-[1.6] text-body">
          Short, sourced digests collected every day, plus essays on building and selling a startup. {total.toLocaleString()} digests across {topics.length} topics, each item linked to its original source.
        </p>
      </header>

      {essays.length > 0 && (
        <section aria-labelledby="essays" className="mt-12 border-t border-rule pt-8">
          <h2 id="essays" className="mb-2 font-semibold text-ink">
            Founder notes
          </h2>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {essays.map((e) => (
              <li key={e.slug} className="border-b border-rule/80 last:border-b-0 sm:border-b-0">
                <Link href={`/articles/${e.slug}`} className="group block py-4">
                  <span className="display block text-[1.375rem] font-semibold leading-snug text-ink transition-colors group-hover:text-accent">
                    {cleanTitle(e.title)}
                  </span>
                  <span className="mt-1 block text-[0.9375rem] text-faint">
                    {formatDate(e.date)}, {e.readingTimeMinutes} min read
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-12 grid gap-x-12 gap-y-8 border-t border-rule pt-10 lg:grid-cols-[14rem_1fr]">
        <aside className="hidden lg:block">
          <nav aria-label="Topics" className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 text-[0.9375rem]">
            <h2 className="mb-3 font-semibold text-ink">Topics</h2>
            <ul className="space-y-0.5">
              <li>
                <Link
                  href={homeUrl({ q, sort })}
                  className={`flex justify-between gap-3 rounded-md px-2 py-1.5 ${!topic ? 'bg-sunk font-semibold text-ink' : 'text-body hover:bg-sunk hover:text-ink'}`}
                  aria-current={!topic ? 'page' : undefined}
                >
                  <span>All topics</span>
                  <span className="tabular-nums text-faint">{total.toLocaleString()}</span>
                </Link>
              </li>
              {topics.map((t) => (
                <li key={t.slug}>
                  <Link
                    href={homeUrl({ q, topic: t.slug, sort })}
                    className={`flex justify-between gap-3 rounded-md px-2 py-1.5 ${topic === t.slug ? 'bg-sunk font-semibold text-ink' : 'text-body hover:bg-sunk hover:text-ink'}`}
                    aria-current={topic === t.slug ? 'page' : undefined}
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="tabular-nums text-faint">{t.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <section aria-labelledby="results" className="min-w-0">
          <SearchBar q={q} topic={topic} sort={sort} topics={topics} />

          <h2 id="results" className="mt-8 text-[0.9375rem] font-normal text-faint" aria-live="polite">
            {result.totalCount === 0
              ? 'No digests match.'
              : `${result.totalCount.toLocaleString()} digest${result.totalCount === 1 ? '' : 's'}${activeTopic ? ` in ${activeTopic.name}` : ''}${q ? ` matching "${q}"` : ''}`}
            {result.totalPages > 1 ? `, page ${result.page} of ${result.totalPages}` : ''}
          </h2>

          {result.articles.length === 0 ? (
            <div className="mt-6 max-w-md space-y-3">
              <p className="font-serif text-[1.25rem] text-ink">Nothing matches that search.</p>
              <p className="text-body">Try fewer words, or a tool or company name instead of a phrase.</p>
              <Link href="/" className="link inline-block">
                Show all digests
              </Link>
            </div>
          ) : (
            <div className="mt-2">
              {result.articles.map((a) => {
                const showDate = groupByDate && a.date !== lastDate;
                if (groupByDate) lastDate = a.date;
                return (
                  <Fragment key={a.slug}>
                    {showDate && <h3 className="mt-8 border-b border-rule pb-2 text-[0.9375rem] font-semibold text-ink first:mt-0">{formatDate(a.date)}</h3>}
                    <DigestRow article={a} showTopic={!activeTopic} showDate={!groupByDate} />
                  </Fragment>
                );
              })}
            </div>
          )}

          <Pagination page={result.page} totalPages={result.totalPages} href={(p) => homeUrl({ q, topic, sort, page: p })} />
        </section>
      </div>
    </div>
  );
}
