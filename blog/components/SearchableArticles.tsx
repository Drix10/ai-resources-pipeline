'use client';

import React, { useState, useEffect, useTransition, useRef, useCallback } from 'react';
import Link from 'next/link';
import type { ArticleSummary } from '@/lib/markdown';

interface Props {
  initialArticles: ArticleSummary[];
  initialTotalCount: number;
  categories: { name: string; slug: string; count: number }[];
}

type SortOption = 'newest' | 'quick' | 'alphabetical';

export default function SearchableArticles({ initialArticles, initialTotalCount, categories }: Props) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [articles, setArticles] = useState<ArticleSummary[]>(initialArticles);
  const [totalCount, setTotalCount] = useState(initialTotalCount);
  const [totalPages, setTotalPages] = useState(Math.ceil(initialTotalCount / 25));
  const [isPending, startTransition] = useTransition();
  const isInitialMount = useRef(true);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K keyboard shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    // Skip the initial fetch — SSR props already have the right data
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        page: String(currentPage),
        limit: String(pageSize),
        sort: sortBy,
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
        ...(selectedCategory ? { category: selectedCategory } : {})
      });

      fetch('/api/articles?' + params.toString(), { signal: controller.signal })
        .then(res => res.json())
        .then(data => {
          startTransition(() => {
            setArticles(data.articles || []);
            setTotalCount(data.totalCount || 0);
            setTotalPages(data.totalPages || 1);
          });
        })
        .catch(err => {
          if (err.name !== 'AbortError') console.error('Fetch error:', err);
        });
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchQuery, selectedCategory, sortBy, currentPage, pageSize]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    setCurrentPage(1);
  };

  const handleCategorySelect = (catSlug: string | null) => {
    setSelectedCategory(catSlug);
    setCurrentPage(1);
  };

  const startIndex = (currentPage - 1) * pageSize;

  return (
    <div className="space-y-6">
      {/* Search Input Bar matching Portfolio Style */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-zinc-500">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          ref={searchInputRef}
          type="search"
          inputMode="search"
          autoCapitalize="none"
          enterKeyHint="search"
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search architectures, code, tools, security..."
          className="w-full pl-11 pr-20 py-3.5 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600 focus:ring-1 focus:ring-zinc-600 transition-all font-sans shadow-sm"
        />
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-1.5">
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setCurrentPage(1); }}
              className="text-xs text-zinc-400 hover:text-zinc-200 px-2.5 py-1 rounded-lg bg-zinc-800 transition-colors min-h-[28px] flex items-center"
            >
              Clear
            </button>
          )}
          <span className="hidden sm:inline-block text-[10px] font-mono text-zinc-400 bg-zinc-800/90 px-1.5 py-0.5 rounded border border-zinc-700/60">
            ⌘K
          </span>
        </div>
      </div>

      {/* Controls Bar: Sort, Page Size, Topic Filters */}
      <div className="flex flex-col xs:flex-row items-stretch xs:items-center justify-between gap-3 p-3 sm:p-4 rounded-2xl bg-zinc-900/40 border border-zinc-800/80 text-xs">
        <div className="flex items-center justify-between xs:justify-start gap-2 w-full xs:w-auto">
          <span className="text-zinc-500 font-semibold uppercase tracking-wider text-[11px] font-mono">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => { setSortBy(e.target.value as SortOption); setCurrentPage(1); }}
            className="bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-zinc-600 flex-1 xs:flex-initial min-h-[36px] font-medium"
          >
            <option value="newest">🕒 Newest Releases (Default)</option>
            <option value="quick">⚡ Quick Reads (&lt; 2m)</option>
            <option value="alphabetical">🔤 Title (A → Z)</option>
          </select>
        </div>

        <div className="flex items-center justify-between xs:justify-end gap-2 w-full xs:w-auto">
          <span className="text-zinc-500 text-[11px] font-mono">Per Page:</span>
          <div className="flex items-center gap-1">
            {[25, 50, 100].map((size) => (
              <button
                key={size}
                onClick={() => { setPageSize(size); setCurrentPage(1); }}
                className={'px-2.5 py-1 rounded-lg text-xs font-mono transition-colors min-h-[32px] flex items-center justify-center ' + (pageSize === size ? 'bg-zinc-100 text-zinc-950 font-bold shadow-sm' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800')}
              >
                {size}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Topic Filters Carousel */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-500 font-mono">
          <span>Topics ({categories.length})</span>
          {selectedCategory && (
            <button
              onClick={() => handleCategorySelect(null)}
              className="text-emerald-400 hover:text-emerald-300 normal-case font-normal text-xs py-1 transition-colors min-h-[32px]"
            >
              Reset Topic Filter
            </button>
          )}
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-2 pt-1 no-scrollbar touch-pan-x">
          <button
            onClick={() => handleCategorySelect(null)}
            className={'flex-shrink-0 px-3.5 py-2 rounded-xl text-xs font-medium transition-all min-h-[36px] flex items-center ' + (selectedCategory === null ? 'bg-zinc-100 text-zinc-950 font-bold shadow-sm' : 'bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200')}
          >
            All ({initialTotalCount.toLocaleString()})
          </button>

          {categories.map((cat) => (
            <button
              key={cat.name}
              onClick={() => handleCategorySelect(selectedCategory === cat.slug ? null : cat.slug)}
              className={'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium transition-all min-h-[36px] ' + (selectedCategory === cat.slug ? 'bg-zinc-100 text-zinc-950 font-bold shadow-sm' : 'bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200')}
            >
              <span>{cat.name}</span>
              <span className={'text-[11px] font-mono ' + (selectedCategory === cat.slug ? 'text-zinc-700 font-bold' : 'text-zinc-500')}>
                ({cat.count})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Articles Feed */}
      <div className="space-y-3 pt-3 border-t border-zinc-800/80">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="font-semibold uppercase tracking-wider text-[11px] font-mono">
            {totalCount > 0 ? Math.min(totalCount, startIndex + 1) : 0}–{Math.min(startIndex + pageSize, totalCount)} of {totalCount.toLocaleString()} Guides
          </span>
          {isPending && <span className="text-zinc-400 text-xs animate-pulse">Searching...</span>}
          {searchQuery && !isPending && <span className="text-zinc-400 text-xs truncate max-w-[150px]">"{searchQuery}"</span>}
        </div>

        {articles.length === 0 ? (
          <div className="text-center py-14 border border-dashed border-zinc-800 rounded-3xl space-y-3 bg-zinc-950/40 px-4">
            <div className="text-zinc-300 text-sm font-medium">No technical breakdowns found.</div>
            <p className="text-zinc-500 text-xs max-w-sm mx-auto">Try broader keywords or reset your topic filter.</p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedCategory(null); setCurrentPage(1); }}
              className="text-xs px-4 py-2 rounded-xl bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors min-h-[40px] font-medium"
            >
              Reset Search & Filters
            </button>
          </div>
        ) : (
          <div className="grid gap-3">
            {articles.map((article) => (
              <Link
                key={article.slug}
                href={'/articles/' + article.slug}
                className="block p-4 sm:p-5 rounded-2xl bg-zinc-900/40 hover:bg-zinc-900/80 border border-zinc-800/80 hover:border-zinc-700 transition-all duration-150 group active:scale-[0.99] shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2 mb-2 text-xs text-zinc-500">
                  {article.category === 'Personal' || (article as any).isPersonal ? (
                    <span className="px-2.5 py-0.5 rounded-md bg-amber-950/80 border border-amber-800/80 font-mono text-[11px] text-amber-300 font-semibold flex items-center gap-1">
                      <span>✍️</span>
                      <span>Founder Essay</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md bg-zinc-800/70 border border-zinc-700/50 font-mono text-[11px] text-zinc-300 truncate max-w-[200px]">
                      {article.category}
                    </span>
                  )}
                  <span>•</span>
                  <time dateTime={article.date} className="font-mono">{article.date}</time>
                  <span>•</span>
                  <span className="font-mono">{article.readingTimeMinutes}m read</span>
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
        )}

        {/* Mobile-First Pagination Bar */}
        {totalPages > 1 && (
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 sm:pt-6 border-t border-zinc-800/60">
            <div className="text-xs text-zinc-500 font-mono text-center sm:text-left">
              Page {currentPage} of {totalPages}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-1">
              <button
                onClick={() => { setCurrentPage(1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800 transition-colors min-h-[36px] flex items-center"
              >
                « First
              </button>
              <button
                onClick={() => { setCurrentPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800 transition-colors min-h-[36px] flex items-center"
              >
                ‹ Prev
              </button>

              <div className="flex items-center gap-1 mx-0.5">
                {(() => {
                  const maxVisible = 5;
                  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2));
                  let end = start + maxVisible - 1;
                  if (end > totalPages) {
                    end = totalPages;
                    start = Math.max(1, end - maxVisible + 1);
                  }
                  const visiblePages: number[] = [];
                  for (let p = start; p <= end; p++) {
                    visiblePages.push(p);
                  }

                  return visiblePages.map((pageNum) => (
                    <button
                      key={pageNum}
                      onClick={() => { setCurrentPage(pageNum); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      className={'w-8 h-8 rounded-lg text-xs font-mono transition-colors flex items-center justify-center ' + (currentPage === pageNum ? 'bg-zinc-100 text-zinc-950 font-bold shadow-sm' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200')}
                    >
                      {pageNum}
                    </button>
                  ));
                })()}
              </div>

              <button
                onClick={() => { setCurrentPage((p) => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800 transition-colors min-h-[36px] flex items-center"
              >
                Next ›
              </button>
              <button
                onClick={() => { setCurrentPage(totalPages); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                disabled={currentPage === totalPages}
                className="px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-zinc-800 transition-colors min-h-[36px] flex items-center"
              >
                Last »
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}