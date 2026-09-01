import type { Metadata } from 'next';
import Link from 'next/link';
import { getAllCategories } from '@/lib/markdown';

export const metadata: Metadata = {
  title: 'Categories & Technical Topics - Drix10 Blogs',
  description: 'Explore technical breakdowns, system design guides, and engineering notes across all curated categories by Drishtant Ghosh (Drix10).',
  alternates: {
    canonical: 'https://blogs.drix10.com/categories',
  },
};

export const revalidate = 86400;

export default function CategoriesIndexPage() {
  const categories = getAllCategories();

  return (
    <div className="space-y-10 sm:space-y-12 max-w-5xl mx-auto">
      {/* Header matching portfolio section header */}
      <div className="space-y-3 pb-6 border-b border-zinc-800/80">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-xs font-mono text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5 transition-colors">
            <span>←</span> Back to All Breakdowns
          </Link>
          <span className="px-2.5 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[11px] font-mono text-zinc-400 font-medium">
            Directory
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-100">
          Categories & Topic Hubs
        </h1>
        <p className="text-xs sm:text-sm text-zinc-300 max-w-2xl leading-relaxed">
          Browse through curated engineering research, system architectures, cybersecurity analyses, and founder notes organized by topic.
        </p>
      </div>

      {/* Special Highlight: Personal Category */}
      <div className="p-6 sm:p-7 rounded-3xl bg-gradient-to-br from-amber-950/30 via-zinc-900 to-zinc-900/60 border border-amber-800/50 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="px-2.5 py-1 rounded-md bg-amber-900/60 border border-amber-700/60 text-amber-300 font-mono text-xs font-semibold flex items-center gap-1.5">
            <span>✍️</span>
            <span>Featured Founder Notes</span>
          </span>
          <Link
            href="/categories/personal"
            className="text-xs font-mono font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
          >
            View Category →
          </Link>
        </div>
        <h2 className="text-lg sm:text-xl font-bold text-zinc-100">
          Personal Founder Essays & Architecture Postmortems
        </h2>
        <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-2xl">
          First-hand founder journeys, building autonomous AI systems, startup exits, and engineering lessons learned going from intern to acquisition.
        </p>
      </div>

      {/* Grid of All Categories */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            02. All Topic Hubs ({categories.length})
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3.5">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/categories/${cat.slug}`}
              className="p-5 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-all duration-150 group flex flex-col justify-between gap-4 active:scale-[0.99] shadow-sm"
            >
              <div className="space-y-1.5">
                <h3 className="text-sm sm:text-base font-bold text-zinc-100 group-hover:text-emerald-400 transition-colors leading-snug">
                  {cat.name}
                </h3>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-500 pt-2.5 border-t border-zinc-800/60 font-mono">
                <span className="text-zinc-400">{cat.count} guide{cat.count !== 1 ? 's' : ''}</span>
                <span className="text-zinc-500 group-hover:text-zinc-200 transition-colors font-medium">Explore Hub →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
