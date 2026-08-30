import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import indexData from '@/lib/articles-index.json';

const articles = indexData.articles;

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rate = checkRateLimit(`search:${clientIp}`, 180, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const q = (searchParams.get('q') || '').trim().slice(0, 100).toLowerCase();
  const category = (searchParams.get('category') || '').trim().slice(0, 80);
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(60, Math.max(10, parseInt(searchParams.get('limit') || '30', 10)));
  const sort = searchParams.get('sort') || 'newest';

  let filtered = articles;

  if (category) {
    filtered = filtered.filter((a) => a.category === category || a.categorySlug === category);
  }

  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    filtered = filtered.filter((a) => {
      const kw = a.searchKeywords;
      return terms.every((t) => kw.includes(t));
    });
  }

  if (sort === 'quickest') {
    filtered = [...filtered].sort((a, b) => a.readingTimeMinutes - b.readingTimeMinutes);
  }

  const total = filtered.length;
  const totalPages = Math.ceil(total / limit);
  const offset = (page - 1) * limit;
  const items = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages,
  });
}
