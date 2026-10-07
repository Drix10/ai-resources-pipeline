'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { searchUrl } from '@/lib/url';

interface Props {
  q?: string;
  topic?: string;
  sort?: string;
  topics?: { name: string; slug: string; count: number }[];
  // Entry mode (home, archive): just the box. Typing opens the search page, which holds the results.
  entry?: boolean;
}

const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'quick', label: 'Shortest first' },
  { value: 'alphabetical', label: 'A to Z' },
];

export default function SearchBar({ q = '', topic = '', sort = 'newest', topics = [], entry = false }: Props) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const composing = useRef(false);
  const lastSent = useRef(q);

  // Keep the box in step when navigation changes the query (back button, topic link).
  // Only adopt a query that did not come from this box (back button, topic link); otherwise a slow
  // server round trip would put an older value back over what the reader has typed since.
  useEffect(() => {
    if (q !== lastSent.current) {
      lastSent.current = q;
      setValue(q);
    }
  }, [q]);

  const go = (next: { q?: string; topic?: string; sort?: string }) => {
    if (next.q !== undefined) lastSent.current = next.q.trim();
    const href = searchUrl({ q, topic, sort, ...next, page: 1 });
    // From the archive the first query is a real navigation (back returns to the archive); on the
    // search page later keystrokes replace the entry so Back is not a stack of half-typed words.
    startTransition(() => (entry ? router.push(href) : router.replace(href, { scroll: false })));
  };

  const onChange = (v: string) => {
    setValue(v);
    clearTimeout(timer.current);
    if (composing.current) return; // wait for the IME to finish before searching
    timer.current = setTimeout(() => go({ q: v }), 250);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = /^(input|textarea|select)$/i.test((e.target as HTMLElement)?.tagName || '');
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer.current);
    };
  }, []);

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        go({ q: value });
      }}
      className="space-y-4"
    >
      <div className="relative">
        <label htmlFor="search" className="sr-only">
          Search digests
        </label>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" aria-hidden />
        <input
          id="search"
          ref={input}
          type="search"
          name="q"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={(e) => {
            composing.current = false;
            onChange((e.target as HTMLInputElement).value);
          }}
          placeholder="Search tools, models, companies, techniques"
          autoComplete="off"
          autoFocus={!entry && Boolean(q)}
          enterKeyHint="search"
          className="h-14 w-full rounded-lg border border-rule bg-paper pl-12 pr-24 text-[1.0625rem] text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {value && (
            <button
              type="button"
              onClick={() => {
                setValue('');
                go({ q: '' });
                input.current?.focus();
              }}
              aria-label="Clear search"
              className="grid h-8 w-8 place-items-center rounded-md text-faint hover:bg-sunk hover:text-ink"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <kbd className="hidden rounded border border-rule px-1.5 font-sans text-[0.75rem] text-faint sm:inline">/</kbd>
        </div>
      </div>

      {!entry && (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[0.9375rem]">
        <label className="flex items-center gap-2 text-faint lg:hidden">
          Topic
          <select
            value={topic}
            onChange={(e) => go({ topic: e.target.value })}
            className="max-w-[12rem] rounded-md border border-rule bg-paper px-2 py-1.5 text-ink focus:border-accent focus:outline-none"
          >
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.slug} value={t.slug}>
                {t.name} ({t.count})
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-faint">
          Order
          <select
            value={sort}
            onChange={(e) => go({ sort: e.target.value })}
            className="rounded-md border border-rule bg-paper px-2 py-1.5 text-ink focus:border-accent focus:outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <span role="status" aria-live="polite" className="text-faint">
          {pending ? 'Searching' : ''}
        </span>
      </div>
      )}
    </form>
  );
}
