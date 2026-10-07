import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ArchiveView, { archivePageCount } from '@/components/ArchiveView';
import { absolute } from '@/lib/site';

export const revalidate = 3600;
export const dynamicParams = false;

// Pages 2..N of the newest-first archive; page 1 is the home page.
export function generateStaticParams() {
  return Array.from({ length: archivePageCount() - 1 }, (_, i) => ({ page: String(i + 2) }));
}

const parse = (raw: string) => {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 2 && n <= archivePageCount() ? n : null;
};

export function generateMetadata({ params }: { params: { page: string } }): Metadata {
  const n = parse(params.page);
  if (!n) return { title: 'Not found' };
  return {
    title: `All digests, page ${n}`,
    description: `Page ${n} of the Drix10 blog archive: short, sourced digests on AI, developer tools and security, newest first.`,
    alternates: { canonical: absolute(`/archive/${n}`) },
  };
}

export default function ArchivePage({ params }: { params: { page: string } }) {
  const n = parse(params.page);
  if (!n) notFound();
  return (
    <div>
      <header className="max-w-[44rem]">
        <h1 className="display text-[clamp(2.2rem,6vw,3.75rem)] font-bold leading-[1.04] text-ink">All digests, page {n}</h1>
      </header>
      <ArchiveView page={n} />
    </div>
  );
}
