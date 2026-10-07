import Link from 'next/link';
import type { Metadata } from 'next';
import { cleanTitle, formatDate, getAllArticles, getAllCategories } from '@/lib/markdown';
import { absolute } from '@/lib/site';
import ArchiveView from '@/components/ArchiveView';

// Static and cached at the edge: the home page is the first page of the archive.
export const revalidate = 3600;

export const metadata: Metadata = {
  alternates: { canonical: absolute('/') },
};

export default function HomePage() {
  const all = getAllArticles();
  const topics = getAllCategories();
  const essays = all.filter((a) => a.category.toLowerCase() === 'personal');

  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="display text-[clamp(2.4rem,7vw,4.5rem)] font-bold leading-[1.02] text-ink">
          Notes on AI, developer tools and security
        </h1>
        <p className="mt-5 max-w-[54ch] font-serif text-[1.25rem] leading-[1.6] text-body">
          Short, sourced digests collected every day, plus essays on building and selling a startup. {all.length.toLocaleString('en-US')} digests across {topics.length} topics, each item linked to its original source.
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

      <ArchiveView page={1} />
    </div>
  );
}
