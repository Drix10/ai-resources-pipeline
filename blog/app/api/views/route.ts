import { getGlobalViewsStats, getArticleViews, recordView } from '@/lib/views-manager';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const slug = searchParams.get('slug');

  if (slug) {
    const stats = getArticleViews(slug);
    return NextResponse.json({ slug, ...stats });
  }

  const globalStats = getGlobalViewsStats();
  return NextResponse.json(globalStats);
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slug = body?.slug;
    if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400 });

    const userAgent = request.headers.get('user-agent') || '';
    const result = recordView(slug, userAgent);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 });
  }
}