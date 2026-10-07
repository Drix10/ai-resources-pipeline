'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, CornerDownLeft, Search, X } from 'lucide-react';

interface Action {
  label: string;
  group: string;
  href: string;
  external?: boolean;
}

const ACTIONS: Action[] = [
  { label: 'Work', group: 'Go to', href: '/#work' },
  { label: 'Open source', group: 'Go to', href: '/#open-source' },
  { label: 'Experience', group: 'Go to', href: '/#experience' },
  { label: 'Writing', group: 'Go to', href: '/#writing' },
  { label: 'Contact', group: 'Go to', href: '/#contact' },
  { label: 'Read the blog', group: 'Elsewhere', href: 'https://blogs.drix10.com', external: true },
  { label: 'GitHub', group: 'Elsewhere', href: 'https://github.com/Drix10', external: true },
  { label: 'LinkedIn', group: 'Elsewhere', href: 'https://www.linkedin.com/in/drix10', external: true },
  { label: 'X', group: 'Elsewhere', href: 'https://x.com/DrishtantGhosh', external: true },
  { label: 'Agent Flow source', group: 'Projects', href: 'https://github.com/Drix10/agent-flow', external: true },
  { label: 'MiroHedge source (hypothesis-arena)', group: 'Projects', href: 'https://github.com/Drix10/hypothesis-arena', external: true },
  { label: 'Send an email', group: 'Contact', href: 'mailto:ggdrishtant@gmail.com' },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const q = query.trim().toLowerCase();
  const results = ACTIONS.filter((a) => !q || `${a.label} ${a.group}`.toLowerCase().includes(q));

  // Closing always hands focus back to the button that opened the palette.
  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    triggerRef.current?.focus();
  }, []);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => {
          if (v) {
            setQuery('');
            triggerRef.current?.focus();
          }
          return !v;
        });
      } else if (e.key === 'Escape') {
        setOpen((v) => {
          if (v) {
            setQuery('');
            triggerRef.current?.focus();
          }
          return false;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => setActive(0), [query, open]);

  // Lock page scroll while open, without the layout jumping when the scrollbar disappears.
  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const prev = { overflow: body.style.overflow, padding: body.style.paddingRight };
    const gap = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (gap > 0) body.style.paddingRight = `${gap}px`;
    return () => {
      body.style.overflow = prev.overflow;
      body.style.paddingRight = prev.padding;
    };
  }, [open]);

  const move = (delta: number) => {
    if (!results.length) return;
    const next = (active + delta + results.length) % results.length;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      (listRef.current?.children[active]?.querySelector('a') as HTMLAnchorElement | null)?.click();
    } else if (e.key === 'Tab') {
      // Keep Tab inside the dialog: it only has the input and the close button.
      const stops = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('input, button') ?? []);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const dialog = open && (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 pt-[12vh] backdrop-blur-[2px] animate-in fade-in duration-150"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu and search"
        onKeyDown={onKeyDown}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-rule bg-paper shadow-2xl animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <Search className="h-[18px] w-[18px] shrink-0 text-faint" aria-hidden />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to a section or link"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="palette-list"
            aria-activedescendant={results.length ? `palette-item-${active}` : undefined}
            className="h-14 flex-1 bg-transparent text-base text-ink placeholder:text-faint focus:outline-none"
          />
          <button type="button" onClick={close} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-faint hover:bg-sunk hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <ul ref={listRef} id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-8 text-center text-faint">Nothing matches &ldquo;{query}&rdquo;. Try a section name like Work.</li>}
          {results.map((a, i) => (
            <li key={a.label} role="presentation">
              <a
                id={`palette-item-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                href={a.href}
                target={a.external ? '_blank' : undefined}
                rel={a.external ? 'noreferrer' : undefined}
                onClick={() => {
                  setOpen(false);
                  setQuery('');
                }}
                onMouseMove={() => setActive(i)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${i === active ? 'bg-sunk text-ink' : 'text-body'}`}
              >
                <span className="font-medium">{a.label}</span>
                <span className="flex items-center gap-2 text-sm text-faint">
                  {a.group}
                  {a.external && <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />}
                </span>
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between border-t border-rule px-4 py-2 text-sm text-faint">
          <span className="flex items-center gap-1.5">
            <CornerDownLeft className="h-3.5 w-3.5" aria-hidden /> to open
          </span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 items-center gap-2 rounded-md px-2.5 text-[0.9375rem] text-body transition-colors hover:bg-sunk hover:text-ink"
        aria-label="Open menu and search"
        aria-haspopup="dialog"
      >
        <Search className="h-[18px] w-[18px]" aria-hidden />
        <span className="sm:hidden">Menu</span>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-rule px-1.5 font-sans text-[0.75rem] text-faint sm:inline">Ctrl K</kbd>
      </button>

      {/* Rendered on <body>: the sticky header has backdrop-filter, which would otherwise make it
          the containing block for this fixed overlay and shrink the backdrop to the header strip. */}
      {mounted && dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}
