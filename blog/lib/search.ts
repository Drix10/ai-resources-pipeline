import { getAllArticles, type ArticleSummary } from './markdown';

export type SortOption = 'newest' | 'quick' | 'alphabetical';

export interface SearchParams {
  q?: string;
  category?: string; // category name or slug
  sort?: SortOption | string;
  page?: number;
  limit?: number;
}

export interface SearchResult {
  articles: ArticleSummary[];
  totalCount: number;
  totalPages: number;
  page: number;
  limit: number;
}

const all = getAllArticles();

// One implementation behind both the home page (server-rendered) and /api/articles,
// so a shared URL and the API always agree.
export function searchArticles({ q = '', category = '', sort = 'newest', page = 1, limit = 20 }: SearchParams): SearchResult {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(100, Math.max(5, limit)) : 20;
  // The index text is stripped to letters and digits, so the query gets the same treatment.
  const terms = q.toLowerCase().slice(0, 100).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean).slice(0, 8);

  let list = all;
  if (category) list = list.filter((a) => a.category === category || a.categorySlug === category);
  if (terms.length) {
    list = list.filter((a) => {
      const hay = (a.searchKeywords || `${a.title} ${a.category} ${a.description}`).toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  if (sort === 'quick' || sort === 'quickest') list = [...list].sort((a, b) => a.readingTimeMinutes - b.readingTimeMinutes);
  else if (sort === 'alphabetical') list = [...list].sort((a, b) => a.title.localeCompare(b.title));

  const totalCount = list.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safeLimit));
  const safePage = Number.isInteger(page) && page > 0 ? Math.min(page, totalPages) : 1;
  const start = (safePage - 1) * safeLimit;

  return { articles: list.slice(start, start + safeLimit), totalCount, totalPages, page: safePage, limit: safeLimit };
}
