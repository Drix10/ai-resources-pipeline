import { ImageResponse } from 'next/og';
import { cleanTitle, findSummary, formatDate } from '@/lib/markdown';

// A share card per digest (what it is about, where it sits, when) instead of one site-wide picture.
// Lives under /og/<slug> because file-based image routes cannot sit beneath a catch-all segment.
export const revalidate = 86400;

const SIZE = { width: 1200, height: 630 };

export async function GET(request: Request, { params }: { params: { slug: string[] } }) {
  const summary = findSummary(params.slug);
  const title = cleanTitle(summary?.items?.[0] || summary?.title || 'Drix10 Blog');
  const category = summary?.category || 'Notes';
  const meta = summary ? `${formatDate(summary.date)}${summary.itemCount && summary.itemCount > 1 ? `  |  ${summary.itemCount} items` : ''}` : '';
  const fontSize = title.length > 90 ? 52 : title.length > 55 ? 64 : 78;

  try {
    const image = new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#0c1320',
          color: '#e9eef5',
          padding: '64px 72px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 30, color: '#8c99ab' }}>
          <div style={{ display: 'flex', color: '#7c93ff', fontWeight: 700 }}>{category}</div>
          <div style={{ display: 'flex' }}>{meta}</div>
        </div>
        <div style={{ display: 'flex', fontSize, fontWeight: 800, lineHeight: 1.08, letterSpacing: -2, maxWidth: 1040 }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 30 }}>
          <div style={{ display: 'flex', fontWeight: 700 }}>Drix10 Blog</div>
          <div style={{ display: 'flex', color: '#8c99ab' }}>by Drishtant Ghosh</div>
        </div>
      </div>
    ),
    SIZE,
    );
    // Render now, so a renderer failure is caught here instead of while the response streams.
    const body = await image.arrayBuffer();
    return new Response(body, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' },
    });
  } catch {
    // Never leave a share link with a broken image: fall back to the site-wide card.
    return Response.redirect(new URL('/og-image.png', request.url), 302);
  }
}
