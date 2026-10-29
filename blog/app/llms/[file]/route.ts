import { getAllArticles, getAllCategories } from '@/lib/markdown';
import { absolute } from '@/lib/site';
import { API_HEADERS, LICENSE_NOTE, toApiItem } from '@/lib/api';

// /llms/<category-slug>.txt: the latest briefings of one category in llms.txt form. Built once per deploy.
export const dynamicParams = false;
export const revalidate = false;

const LATEST = 50;

export function generateStaticParams() {
  return getAllCategories().map((c) => ({ file: `${c.slug}.txt` }));
}

export function GET(_req: Request, { params }: { params: { file: string } }) {
  const slug = params.file.replace(/\.txt$/, '');
  const cat = getAllCategories().find((c) => c.slug === slug);
  if (!cat) return new Response('Not found', { status: 404 });

  const items = getAllArticles().filter((a) => a.categorySlug === slug).slice(0, LATEST).map((a) => toApiItem(a));
  let text = `# ${cat.name}: latest AI briefings
> The ${items.length} newest of ${cat.count} briefings in "${cat.name}" from the AI Resources knowledge base, newest first.
> JSON: ${absolute(`/api/articles?category=${slug}`)} | All categories: ${absolute('/llms.txt')}
> ${LICENSE_NOTE}

## Briefings
`;
  for (const a of items) {
    text += `\n### [${a.title}](${a.url}) (${a.date})\n${a.description}\n`;
    for (const h of a.headlines.slice(1)) text += `- ${h}\n`;
    const src = a.sources.slice(0, 3).map((s) => `<${s.url}>`).join(' ');
    if (src) text += `Sources: ${src}\n`;
  }

  return new Response(text, { headers: { ...API_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
}
