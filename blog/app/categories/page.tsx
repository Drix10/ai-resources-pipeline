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
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="border-b border-zinc-800/80 pb-6">
        <Link href="/" className="text-xs text-zinc-500 hover:text-zinc-300 mb-3 inline-flex items-center gap-1.5 transition-colors">
          <span>←</span> Back to All Breakdowns
        </Link>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-zinc-100 mb-2">
          Categories & Topic Hubs
        </h1>
        <p className="text-zinc-400 text-sm max-w-2xl leading-relaxed">
          Browse through curated engineering research, system architectures, cybersecurity analyses, and founder notes organized by topic.
        </p>
      </div>

      {/* Special Highlight: Personal Category */}
      <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-950/30 via-zinc-900 to-zinc-900/60 border border-amber-800/50 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <span className="px-2.5 py-1 rounded-md bg-amber-900/60 border border-amber-700/60 text-amber-300 font-mono text-xs font-semibold flex items-center gap-1.5">
            <span>✍️</span>
            <span>Featured Author Notes</span>
          </span>
          <Link
            href="/categories/personal"
            className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors flex items-center gap-1"
          >
            View Category →
          </Link>
        </div>
        <h2 className="text-lg font-bold text-zinc-100">
          Personal Founder Essays & Lessons
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed">
          First-hand founder journeys, building autonomous AI systems, startup exits, and lessons learned going from intern to acquisition.
        </p>
      </div>

      {/* Grid of All Categories */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 font-mono">
          All Topic Hubs ({categories.length})
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {categories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/categories/${cat.slug}`}
              className="p-4 rounded-xl bg-zinc-900/40 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700 transition-all duration-150 group flex flex-col justify-between gap-3 active:scale-[0.99]"
            >
              <div className="space-y-1.5">
                <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-white transition-colors leading-snug">
                  {cat.name}
                </h3>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-500 pt-2 border-t border-zinc-800/40 font-mono">
                <span className="text-zinc-400">{cat.count} guide{cat.count !== 1 ? 's' : ''}</span>
                <span className="text-zinc-600 group-hover:text-zinc-300 transition-colors">Explore →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
