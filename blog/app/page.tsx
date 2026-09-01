import { getAllArticles, getAllCategories } from '@/lib/markdown';
import SearchableArticles from '@/components/SearchableArticles';

export default function HomePage() {
  const allArticles = getAllArticles();
  const initialArticles = allArticles.slice(0, 25);
  const categories = getAllCategories();

  return (
    <div className="space-y-10 sm:space-y-12">
      {/* Hero Header Section matching Portfolio Aesthetic */}
      <div className="space-y-3 pb-6 border-b border-zinc-800/80">
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-wider font-bold text-zinc-400">
            01. Research Archive & Engineering Notes
          </span>
          <span className="px-2.5 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-800/80 text-[11px] font-mono text-emerald-400 font-medium">
            Live Knowledge Base
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-zinc-100">
          Technical Notes & Architectural Breakdowns
        </h1>
        <p className="text-xs sm:text-sm text-zinc-300 max-w-3xl leading-relaxed">
          Curated continuous engineering research, multi-agent system architectures, cybersecurity notes, and developer toolkits by{' '}
          <strong className="text-zinc-100 font-semibold">Drishtant Ghosh (Drix10)</strong>.
        </p>
      </div>

      <SearchableArticles
        initialArticles={initialArticles}
        initialTotalCount={allArticles.length}
        categories={categories}
      />
    </div>
  );
}
