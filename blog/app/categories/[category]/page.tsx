export const dynamicParams = true;
export const revalidate = 3600;

import Link from 'next/link';
import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { notFound } from 'next/navigation';

export async function generateStaticParams() {
  const categories = getAllCategories();
  return categories.map((c) => ({
    category: c.slug,
  }));
}

export default function CategoryPage({ params }: { params: { category: string } }) {
  const allArticles = getAllArticles();
  const filtered = allArticles.filter((a) => a.categorySlug === params.category || a.category.toLowerCase() === decodeURIComponent(params.category).toLowerCase());

  if (filtered.length === 0) notFound();

  const categoryName = filtered[0].category;

  return (
    <div className="space-y-8">
      <div className="border-b border-zinc-800 pb-4">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block">← Back to Overview</Link>
        <h1 className="text-xl font-bold text-zinc-100">{categoryName}</h1>
        <p className="text-zinc-400 text-xs mt-1">{filtered.length} curated breakdown(s)</p>
      </div>

      <div className="divide-y divide-zinc-800/60">
        {filtered.map((article) => (
          <article key={article.slug} className="py-4 group">
            <div className="flex items-center gap-2 mb-1 text-xs text-zinc-500">
              <time dateTime={article.date}>{article.date}</time>
              <span>•</span>
              <span>{article.readingTimeMinutes} min read</span>
            </div>

            <h2 className="text-base font-semibold text-zinc-100 group-hover:text-zinc-300 transition-colors leading-snug mb-1">
              <Link href={'/articles/' + article.slug} className="hover:underline">
                {article.title}
              </Link>
            </h2>

            <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed mb-2">
              {article.description}
            </p>

            <Link href={'/articles/' + article.slug} className="text-xs text-zinc-300 hover:text-zinc-100 font-medium inline-flex items-center gap-1">
              Read article →
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
