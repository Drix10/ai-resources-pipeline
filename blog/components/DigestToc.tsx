'use client';

import { useEffect, useState } from 'react';

interface Props {
  items: { id: string; title: string }[];
}

// The index of a digest. On wide screens it sticks beside the text and follows the
// section you are reading; on narrow screens it folds into a disclosure at the top.
export default function DigestToc({ items }: Props) {
  const [active, setActive] = useState(items[0]?.id ?? '');

  useEffect(() => {
    const targets = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length) return;
    const visible = new Set<string>();
    const pick = () => {
      // The first item (in reading order) that is inside the band is the one being read; at the very
      // bottom of the page the last item wins, since short final sections never reach the band.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) return setActive(items[items.length - 1].id);
      const first = items.find((i) => visible.has(i.id));
      if (first) setActive(first.id);
    };
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        pick();
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    );
    window.addEventListener('scroll', pick, { passive: true });
    targets.forEach((t) => observer.observe(t));
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', pick);
    };
  }, [items]);

  const list = (
    <ol className="space-y-1" onClick={(e) => {
      // Picking an item in the folded mobile list closes it.
      const details = (e.target as HTMLElement).closest('details');
      if (details) details.open = false;
    }}>
      {items.map((item, i) => (
        <li key={item.id}>
          <a
            href={`#${item.id}`}
            aria-current={active === item.id ? 'location' : undefined}
            className={`flex gap-3 rounded-md px-2 py-1.5 text-[0.9375rem] leading-snug transition-colors ${
              active === item.id ? 'bg-sunk font-semibold text-ink' : 'text-body hover:bg-sunk hover:text-ink'
            }`}
          >
            <span className="w-5 shrink-0 text-right tabular-nums text-faint">{i + 1}</span>
            <span>{item.title}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <>
      <nav aria-label="Items in this digest" className="hidden lg:block">
        <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
          <h2 className="mb-3 font-semibold text-ink">In this digest</h2>
          {list}
        </div>
      </nav>

      <details className="rounded-lg border border-rule lg:hidden">
        <summary className="cursor-pointer list-none px-4 py-3 font-semibold text-ink [&::-webkit-details-marker]:hidden">
          In this digest ({items.length} items)
        </summary>
        <div className="border-t border-rule p-2">{list}</div>
      </details>
    </>
  );
}
