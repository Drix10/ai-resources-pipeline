import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { searchArticles } from '@/lib/search';
import { findSummary } from '@/lib/markdown';
import { API_HEADERS, LICENSE_NOTE, toApiItem } from '@/lib/api';

// Public JSON API (documented in the repository README, "Use it from your agent"):
//   ?q=        words that must all appear (title, headlines, opening text)
//   ?category= category name or slug (see /api/categories)
//   ?since=    YYYY-MM-DD, only briefings published on or after that day
//   ?limit=    1-100 (default 20); ?latest=N is the same as ?limit=N
//   ?page=     page number; ?sort= newest (default) | quick | alphabetical
//   ?slug= or ?url=  one briefing, with its full Markdown in `content`
// Response: { items: ApiItem[], total, page, limit, totalPages, license }
export async function GET(request: NextRequest) {
  const rate = checkRateLimit(`search:${getClientIp(request)}`, 180, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429, headers: { ...API_HEADERS, 'Cache-Control': 'no-store', 'Retry-After': '60' } });
  }

  const p = request.nextUrl.searchParams;
  const one = (p.get('slug') || p.get('url') || '').trim().slice(0, 300);
  if (one) {
    const path = one.replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?(articles\/)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
    const summary = findSummary(path.split('/').filter(Boolean));
    if (!summary) return NextResponse.json({ error: 'Briefing not found', items: [] }, { status: 404, headers: API_HEADERS });
    return NextResponse.json({ items: [toApiItem(summary, true)], total: 1, page: 1, limit: 1, totalPages: 1, license: LICENSE_NOTE }, { headers: API_HEADERS });
  }

  const rawPage = parseInt(p.get('page') || '1', 10);
  const result = searchArticles({
    q: p.get('q') || p.get('search') || '',
    category: (p.get('category') || '').trim().slice(0, 80),
    sort: p.get('sort') || 'newest',
    since: (p.get('since') || '').trim().slice(0, 10),
    page: Number.isInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 10000) : 1,
    limit: parseInt(p.get('limit') || p.get('latest') || '20', 10),
  });

  return NextResponse.json(
    {
      items: result.articles.map((a) => toApiItem(a)),
      total: result.totalCount,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
      license: LICENSE_NOTE,
    },
    { headers: API_HEADERS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: API_HEADERS });
}
