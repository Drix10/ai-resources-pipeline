import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllCategories } from '@/lib/markdown';

export const metadata: Metadata = {
  title: 'Topics',
  description: 'Every topic in the Drix10 blog: AI tools, models, companies, security, founder notes and more, by Drishtant Ghosh.',
  alternates: {
    canonical: 'https://blogs.drix10.com/categories',
  },
};

export const revalidate = 86400;

export default function CategoriesIndexPage() {
  const categories = getAllCategories();
  const founder = categories.find((c) => c.slug === 'personal');
  const rest = [...categories].filter((c) => c.slug !== 'personal').sort((a, b) => a.name.localeCompare(b.name));
  const total = categories.reduce((n, c) => n + c.count, 0);

  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="display text-[clamp(2.4rem,7vw,4.5rem)] font-bold leading-[1.02] text-ink">Topics</h1>
        <p className="mt-5 max-w-[54ch] font-serif text-[1.25rem] leading-[1.6] text-body">
          {total.toLocaleString()} digests sorted into {categories.length} topics. Pick one to see everything in it, newest first.
        </p>
      </header>

      {founder && (
        <section className="mt-12 border-t border-rule pt-8">
          <Link href={`/categories/${founder.slug}`} className="group block max-w-[44rem]">
            <h2 className="display text-[1.75rem] font-semibold leading-tight text-ink transition-colors group-hover:text-accent">
              {founder.name}: essays by the author
            </h2>
            <p className="mt-2 font-serif text-[1.1875rem] leading-[1.6] text-body">
              Building and selling a startup, and what it takes to make AI systems reliable. Written by hand, not collected.
            </p>
          </Link>
        </section>
      )}

      <section aria-labelledby="all-topics" className="mt-12 border-t border-rule pt-8">
        <h2 id="all-topics" className="mb-4 font-semibold text-ink">
          All topics, A to Z
        </h2>
        <ul className="columns-1 gap-12 sm:columns-2 lg:columns-3">
          {rest.map((c) => (
            <li key={c.slug} className="break-inside-avoid border-b border-rule/80">
              <Link href={`/categories/${c.slug}`} className="group flex items-baseline justify-between gap-4 py-3">
                <span className="text-ink transition-colors group-hover:text-accent">{c.name}</span>
                <span className="text-[0.9375rem] tabular-nums text-faint">{c.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
