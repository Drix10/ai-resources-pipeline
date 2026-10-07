import Link from 'next/link';

interface Props {
  page: number;
  totalPages: number;
  href: (page: number) => string;
}

// Plain links, so every page is crawlable and works without JavaScript.
export default function Pagination({ page, totalPages, href }: Props) {
  if (totalPages <= 1) return null;

  const reach = 2;
  const pages: (number | 'gap')[] = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= reach) pages.push(p);
    else if (pages[pages.length - 1] !== 'gap') pages.push('gap');
  }

  const item = 'grid h-10 min-w-10 place-items-center rounded-md px-3 text-[0.9375rem] tabular-nums';

  return (
    <nav aria-label="Pages" className="mt-10 flex flex-wrap items-center gap-1">
      {page > 1 ? (
        <Link href={href(page - 1)} rel="prev" className={`${item} text-ink hover:bg-sunk`}>
          Previous
        </Link>
      ) : (
        <span className={`${item} text-faint/60`} aria-disabled="true">
          Previous
        </span>
      )}
      {pages.map((p, i) =>
        p === 'gap' ? (
          <span key={`gap-${i}`} className="px-1 text-faint" aria-hidden>
            &hellip;
          </span>
        ) : p === page ? (
          <span key={p} aria-current="page" className={`${item} bg-ink font-semibold text-paper`}>
            {p}
          </span>
        ) : (
          <Link key={p} href={href(p)} className={`${item} text-body hover:bg-sunk hover:text-ink`}>
            {p}
          </Link>
        ),
      )}
      {page < totalPages ? (
        <Link href={href(page + 1)} rel="next" className={`${item} text-ink hover:bg-sunk`}>
          Next
        </Link>
      ) : (
        <span className={`${item} text-faint/60`} aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
