'use client';

import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';

// Copies a link straight to one item of a digest.
export default function CopyLink({ id, label }: { id: string; label: string }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      window.location.hash = id;
    }
  };

  return (
    <>
    <button
      type="button"
      onClick={copy}
      aria-label={done ? 'Link copied' : `Copy link to ${label}`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-faint transition-colors hover:bg-sunk hover:text-ink"
    >
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
    </button>
    <span role="status" className="sr-only">
      {done ? 'Link copied' : ''}
    </span>
    </>
  );
}
