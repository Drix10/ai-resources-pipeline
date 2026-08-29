import { getAllArticles, getAllCategories } from '@/lib/markdown';
import SearchableArticles from '@/components/SearchableArticles';

export default function HomePage() {
  const allArticles = getAllArticles();
  const initialArticles = allArticles.slice(0, 30);
  const categories = getAllCategories();

  return (
    <div className="space-y-8">
      <div className="border-b border-zinc-800/80 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100 mb-1">
          Technical Notes & Architectural Breakdowns
        </h1>
        <p className="text-zinc-400 text-sm">
          Curated continuous engineering research, system designs, cybersecurity notes, and developer toolkits.
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
