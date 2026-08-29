import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const search = searchParams.get('search')?.toLowerCase().trim() || '';
  const category = searchParams.get('category') || '';
  const sortBy = searchParams.get('sort') || 'newest';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(10, parseInt(searchParams.get('limit') || '30', 10)));

  const all = getAllArticles();
  let filtered = all;

  if (category) {
    filtered = filtered.filter(a => a.categorySlug === category || a.category.toLowerCase() === category.toLowerCase());
  }

  if (search) {
    const terms = search.split(/\s+/);
    filtered = filtered.filter(a => {
      const title = a.title.toLowerCase();
      const desc = a.description.toLowerCase();
      const cat = a.category.toLowerCase();
      const kw = a.searchKeywords || '';
      return terms.every(t => title.includes(t) || desc.includes(t) || cat.includes(t) || kw.includes(t));
    });
  }

  if (sortBy === 'quick') {
    filtered = [...filtered].sort((a, b) => a.wordCount - b.wordCount);
  } else if (sortBy === 'alphabetical') {
    filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title));
  } else {
    // Default: 'newest' (exact ISO timestamp descending, then by collection order)
    filtered = [...filtered].sort((a: any, b: any) => {
      const timeDiff = new Date(b.isoTimestamp || b.date).getTime() - new Date(a.isoTimestamp || a.date).getTime();
      if (timeDiff !== 0) return timeDiff;
      return (b.sortOrder || 0) - (a.sortOrder || 0);
    });
  }

  const totalCount = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  const startIndex = (page - 1) * limit;
  const paginated = filtered.slice(startIndex, startIndex + limit);

  return NextResponse.json({
    articles: paginated,
    totalCount,
    totalPages,
    currentPage: page,
    limit,
    categories: getAllCategories()
  });
}