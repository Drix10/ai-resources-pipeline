import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { searchArticles } from '@/lib/search';

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rate = checkRateLimit(`search:${clientIp}`, 180, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const rawPage = parseInt(searchParams.get('page') || '1', 10);
  const rawLimit = parseInt(searchParams.get('limit') || '25', 10);

  const result = searchArticles({
    q: searchParams.get('search') || searchParams.get('q') || '',
    category: (searchParams.get('category') || '').trim().slice(0, 80),
    sort: searchParams.get('sort') || 'newest',
    page: Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1,
    limit: rawLimit,
  });

  return NextResponse.json({
    articles: result.articles,
    items: result.articles,
    totalCount: result.totalCount,
    total: result.totalCount,
    page: result.page,
    limit: result.limit,
    totalPages: result.totalPages,
  });
}
