import Link from 'next/link';
import { getAllArticles, getAllCategories, type ArticleSummary } from '@/lib/markdown';
import { PAGE_SIZE, archiveHref } from '@/lib/site';
import SearchBar from './SearchBar';
import DigestList from './DigestList';
import Pagination from './Pagination';
import TopicRail from './TopicRail';

export const archivePageCount = () => Math.max(1, Math.ceil(getAllArticles().length / PAGE_SIZE));

export const archiveSlice = (page: number): ArticleSummary[] => getAllArticles().slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

// The newest-first archive: the home page is page 1, then /archive/2, /archive/3, ...
// All of it is static, so it is cached at the edge and every page is a crawlable URL.
export default function ArchiveView({ page, intro }: { page: number; intro?: React.ReactNode }) {
  const topics = getAllCategories();
  const total = getAllArticles().length;
  const pages = archivePageCount();

  return (
    <div className="mt-12 grid gap-x-12 gap-y-8 border-t border-rule pt-10 lg:grid-cols-[14rem_1fr]">
      <TopicRail topics={topics} total={total} />
      <section aria-labelledby="results" className="min-w-0">
        <SearchBar entry />
        <h2 id="results" className="mt-8 text-[0.9375rem] font-normal text-faint">
          {intro ?? `${total.toLocaleString('en-US')} digests, newest first${pages > 1 ? `, page ${page} of ${pages}` : ''}`}
        </h2>
        <p className="mt-1 text-[0.9375rem] text-faint lg:hidden">
          <Link href="/categories" className="link">
            Browse by topic
          </Link>
        </p>
        <DigestList articles={archiveSlice(page)} />
        <Pagination page={page} totalPages={pages} href={archiveHref} />
      </section>
    </div>
  );
}
