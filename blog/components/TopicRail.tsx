import Link from 'next/link';
import { topicHref } from '@/lib/site';

// The topic list beside the archive. Every entry is a plain link to a static, indexable topic page.
export default function TopicRail({
  topics,
  total,
  active,
}: {
  topics: { name: string; slug: string; count: number }[];
  total: number;
  active?: string;
}) {
  const row = (current: boolean) =>
    `flex justify-between gap-3 rounded-md px-2 py-1.5 ${current ? 'bg-sunk font-semibold text-ink' : 'text-body hover:bg-sunk hover:text-ink'}`;
  return (
    <aside className="hidden lg:block">
      <nav aria-label="Topics" className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2 text-[0.9375rem]">
        <h2 className="mb-3 font-semibold text-ink">Topics</h2>
        <ul className="space-y-0.5">
          <li>
            <Link href="/" className={row(!active)} aria-current={!active ? 'page' : undefined}>
              <span>All topics</span>
              <span className="tabular-nums text-faint">{total.toLocaleString('en-US')}</span>
            </Link>
          </li>
          {topics.map((t) => (
            <li key={t.slug}>
              <Link href={topicHref(t.slug)} className={row(active === t.slug)} aria-current={active === t.slug ? 'page' : undefined}>
                <span className="truncate">{t.name}</span>
                <span className="tabular-nums text-faint">{t.count}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
