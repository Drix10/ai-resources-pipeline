import Link from 'next/link';
import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

export const dynamicParams = true;
export const revalidate = 3600;

export async function generateStaticParams() {
  const categories = getAllCategories();
  return categories.map((c) => ({
    category: c.slug,
  }));
}

export async function generateMetadata({ params }: { params: { category: string } }): Promise<Metadata> {
  const allArticles = getAllArticles();
  const filtered = allArticles.filter(
    (a) =>
      a.categorySlug === params.category ||
      a.category.toLowerCase() === decodeURIComponent(params.category).toLowerCase()
  );

  if (filtered.length === 0) {
    return {
      title: 'Category Not Found - Drix10 Blogs',
    };
  }

  const categoryName = filtered[0].category;
  const canonicalUrl = `https://blogs.drix10.com/categories/${params.category}`;

  return {
    title: `${categoryName} - Technical Research & Guides | Drix10 Blogs`,
    description: `Curated technical research, system designs, and architecture breakdowns on ${categoryName} by Drishtant Ghosh (Drix10).`,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title: `${categoryName} - Drix10 Blogs`,
      description: `Curated technical research and architecture breakdowns on ${categoryName}.`,
      url: canonicalUrl,
      type: 'website',
    },
  };
}

export default function CategoryPage({ params }: { params: { category: string } }) {
  const allArticles = getAllArticles();
  const filtered = allArticles.filter((a) => a.categorySlug === params.category || a.category.toLowerCase() === decodeURIComponent(params.category).toLowerCase());

  if (filtered.length === 0) notFound();

  const categoryName = filtered[0].category;

  return (
    <div className="space-y-10 sm:space-y-12 max-w-5xl mx-auto">
      {/* Header */}
      <div className="space-y-3 pb-6 border-b border-zinc-800/80">
        <div className="flex items-center justify-between">
          <Link href="/categories" className="text-xs font-mono text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5 transition-colors">
            <span>←</span> Back to Categories Directory
          </Link>
          <span className="px-2.5 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 font-medium">
            Topic Hub
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-100">
          {categoryName}
        </h1>
        <p className="text-xs sm:text-sm text-zinc-300 max-w-2xl leading-relaxed">
          {filtered.length} technical breakdown{filtered.length !== 1 ? 's' : ''} and architectural notes curated in this domain.
        </p>
      </div>

      <div className="grid gap-3.5">
        {filtered.map((article) => (
          <Link
            key={article.slug}
            href={'/articles/' + article.slug}
            className="block p-5 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-all duration-150 group shadow-sm active:scale-[0.99]"
          >
            <div className="flex items-center gap-2 mb-2 text-xs text-zinc-500 font-mono">
              <time dateTime={article.date}>{article.date}</time>
              <span>•</span>
              <span>{article.readingTimeMinutes}m read</span>
            </div>

            <h2 className="text-base sm:text-lg font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors leading-snug mb-1.5">
              {article.title}
            </h2>

            <p className="text-xs sm:text-sm text-zinc-400 line-clamp-2 leading-relaxed">
              {article.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
