'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

const EMAIL = 'ggdrishtant@gmail.com';

// The address itself is the call to action: click to write, or copy it.
export default function ContactEmail() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      setState('copied');
    } catch {
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2500);
  };

  return (
    <div>
      <a
        href={`mailto:${EMAIL}`}
        className="block break-all text-[clamp(1.6rem,6.2vw,4.25rem)] font-semibold leading-[1.05] tracking-tight text-ink underline decoration-rule decoration-2 underline-offset-[10px] transition-colors hover:text-accent hover:decoration-accent"
        style={{ fontVariationSettings: "'wdth' 88" }}
      >
        {EMAIL}
      </a>
      <div className="mt-5 flex items-center gap-4 text-[0.9375rem]">
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-2 rounded-md border border-rule px-3 py-2 text-ink transition-colors hover:bg-sunk"
        >
          {state === 'copied' ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
          {state === 'copied' ? 'Copied' : 'Copy address'}
        </button>
        <span role="status" className="text-faint">
          {state === 'failed' ? 'Could not copy. Select the address above instead.' : state === 'copied' ? 'Address copied to clipboard.' : ''}
        </span>
      </div>
    </div>
  );
}
