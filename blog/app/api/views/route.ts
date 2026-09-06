import { getGlobalViewsStats, getArticleViews, recordView } from '@/lib/views-manager';
import { checkRateLimit, getClientIp } from '@/lib/rate-limiter';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import indexData from '@/lib/articles-index.json';

let cachedSlugMap = new Map<string, string>();
let lastCacheRefresh = 0;

function getSlugMapping(forceRefresh = false): Map<string, string> {
  const now = Date.now();
  if (cachedSlugMap.size > 0 && !forceRefresh) return cachedSlugMap;
  if (forceRefresh && now - lastCacheRefresh < 30000) return cachedSlugMap;

  lastCacheRefresh = now;
  const map = new Map<string, string>();

  const populate = (articles: any[]) => {
    for (const a of articles) {
      if (!a.slug) continue;
      const canonical = String(a.slug).toLowerCase();
      map.set(canonical, canonical);

      const parts = canonical.split('/');
      if (parts.length > 1) {
        map.set(parts[parts.length - 1], canonical);
      }

      if (a.legacySlug) {
        map.set(String(a.legacySlug).toLowerCase(), canonical);
      }

      if (a.filename) {
        const fb = a.filename.replace(/\.md$/i, '').toLowerCase();
        map.set(fb, canonical);
        if (a.categorySlug) {
          map.set(`${a.categorySlug.toLowerCase()}/${fb}`, canonical);
        }
      }
    }
  };

  try {
    const indexPath = path.join(process.cwd(), 'lib', 'articles-index.json');
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.articles)) {
        populate(parsed.articles);
        cachedSlugMap = map;
        return cachedSlugMap;
      }
    }
  } catch (e) {}

  if (Array.isArray(indexData?.articles)) {
    populate(indexData.articles);
  }
  cachedSlugMap = map;
  return cachedSlugMap;
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
    let cleanSlug = String(slug).toLowerCase().trim().slice(0, 180);
    try {
      cleanSlug = decodeURIComponent(cleanSlug).toLowerCase().trim();
    } catch (e) {}
    cleanSlug = cleanSlug.replace(/^\/+|\/+$/g, '');

    const mapping = getSlugMapping();
    const canonical = mapping.get(cleanSlug) || cleanSlug;
    const stats = getArticleViews(canonical);
    return NextResponse.json({ slug: canonical, ...stats });
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

    let cleanSlug = rawSlug.toLowerCase().trim().slice(0, 180);
    try {
      cleanSlug = decodeURIComponent(cleanSlug).toLowerCase().trim();
    } catch (e) {}
    cleanSlug = cleanSlug.replace(/^\/+|\/+$/g, '');

    const mapping = getSlugMapping();
    let canonical = mapping.get(cleanSlug);
    // Security Gate: Reject unindexed / arbitrary slugs to prevent storage corruption
    if (!canonical) {
      // Re-read with throttle guard in case the file was just added
      const freshMapping = getSlugMapping(true);
      canonical = freshMapping.get(cleanSlug);
      if (!canonical) {
        return NextResponse.json({ error: 'Invalid article slug' }, { status: 404 });
      }
    }

    const userAgent = request.headers.get('user-agent') || '';
    const result = recordView(canonical, userAgent);

    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
}
