import Link from 'next/link';
import { getAllArticles, type ArticleSummary } from '@/lib/markdown';
import { PAGE_SIZE, topicHref } from '@/lib/site';
import DigestRow from './DigestRow';
import Pagination from './Pagination';

export const topicArticles = (slug: string): ArticleSummary[] => getAllArticles().filter((a) => a.categorySlug === slug);
export const topicPageCount = (slug: string) => Math.max(1, Math.ceil(topicArticles(slug).length / PAGE_SIZE));

// One page of a topic hub. Page 1 is /categories/<slug>; later pages are /categories/<slug>/page/<n>.
export default function TopicView({ slug, page }: { slug: string; page: number }) {
  const all = topicArticles(slug);
  const name = all[0].category;
  const pages = topicPageCount(slug);
  const items = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const isFolder = !['personal', 'linkedin insights'].includes(name.toLowerCase());
  const githubFolder = `https://github.com/Drix10/ai-resources/tree/main/${encodeURIComponent(name)}`;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-[0.9375rem] text-faint">
        <Link href="/categories" className="hover:text-ink">
          Topics
        </Link>
      </nav>

      <header className="mt-6 max-w-[48rem]">
        <h1 className="display text-[clamp(2.2rem,6.4vw,4rem)] font-bold leading-[1.04] text-ink">{name}</h1>
        <p className="mt-4 text-[0.9375rem] text-faint">
          {all.length} digest{all.length === 1 ? '' : 's'}, newest first{pages > 1 ? `, page ${page} of ${pages}` : ''}
          {isFolder && (
            <>
              {', '}
              <a href={githubFolder} target="_blank" rel="noopener noreferrer" className="link">
                browse the folder on GitHub
              </a>
            </>
          )}
        </p>
      </header>

      <div className="mt-8 max-w-[52rem] border-t border-rule">
        <h2 className="sr-only">Digests in {name}</h2>
        {items.map((article) => (
          <DigestRow key={article.slug} article={article} showTopic={false} />
        ))}
        <Pagination page={page} totalPages={pages} href={(p) => topicHref(slug, p)} />
      </div>
    </>
  );
}
