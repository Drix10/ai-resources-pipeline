import { NextResponse } from 'next/server';
import { getAllCategories } from '@/lib/markdown';
import { absolute } from '@/lib/site';
import { API_HEADERS, LICENSE_NOTE } from '@/lib/api';

// Every category with its briefing count and per-category llms.txt.
export function GET() {
  const items = getAllCategories().map((c) => ({
    name: c.name,
    slug: c.slug,
    count: c.count,
    url: absolute(`/categories/${c.slug}`),
    llms: absolute(`/llms/${c.slug}.txt`),
  }));
  return NextResponse.json({ items, total: items.length, license: LICENSE_NOTE }, { headers: API_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: API_HEADERS });
}
