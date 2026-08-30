import { getGlobalViewsStats, getArticleViews, recordView } from '@/lib/views-manager';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { NextRequest, NextResponse } from 'next/server';
import indexData from '@/lib/articles-index.json';

const validSlugsSet = new Set<string>();
for (const a of indexData.articles) {
  validSlugsSet.add(a.slug.toLowerCase());
}

export async function GET(request: NextRequest) {
  const clientIp = getClientIp(request);
  const rate = checkRateLimit(`views-get:${clientIp}`, 120, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const searchParams = request.nextUrl.searchParams;
  const slug = searchParams.get('slug');

  if (slug) {
    const cleanSlug = String(slug).toLowerCase().trim().slice(0, 180);
    const stats = getArticleViews(cleanSlug);
    return NextResponse.json({ slug: cleanSlug, ...stats });
  }

  const globalStats = getGlobalViewsStats();
  return NextResponse.json(globalStats);
}

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  // Max 60 view increments per minute per IP to prevent spam inflation / DDoS
  const rate = checkRateLimit(`views-post:${clientIp}`, 60, 60000);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  try {
    const contentLength = Number(request.headers.get('content-length') || '0');
    if (contentLength > 2048) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }

    const body = await request.json();
    const rawSlug = body?.slug;
    if (!rawSlug || typeof rawSlug !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid slug' }, { status: 400 });
    }

    let cleanSlug = rawSlug.toLowerCase().trim();
    try {
      cleanSlug = decodeURIComponent(cleanSlug).toLowerCase().trim();
    } catch (e) {}

    // Security Gate: Reject unindexed / arbitrary slugs to prevent json store corruption
    if (!validSlugsSet.has(cleanSlug)) {
      return NextResponse.json({ error: 'Invalid article slug' }, { status: 404 });
    }

    const userAgent = request.headers.get('user-agent') || '';
    const result = recordView(cleanSlug, userAgent);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
