'use client';

import React, { useState } from 'react';

export default function ContactCard() {
  const [copied, setCopied] = useState(false);
  const email = 'drix10.official@gmail.com';

  const copyEmail = () => {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-b from-zinc-900/80 to-zinc-950 border border-zinc-800 space-y-6">
      <div className="space-y-2">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-xs font-mono">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span>Open to Founding & High-Impact AI Engineering Roles</span>
        </div>
        <h2 className="text-xl sm:text-2xl font-bold text-zinc-100 tracking-tight">
          Let’s build the future together.
        </h2>
        <p className="text-xs sm:text-sm text-zinc-400 max-w-xl leading-relaxed">
          Whether you are exploring autonomous multi-agent pipelines, cybersecurity architectures, or founding a new venture, feel free to reach out directly.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button
          onClick={copyEmail}
          className="px-4 py-2.5 rounded-xl bg-zinc-100 hover:bg-zinc-200 text-zinc-950 font-semibold text-xs font-mono transition-colors shadow flex items-center gap-2"
        >
          <span>{copied ? '✓ Email Copied!' : '✉ Copy Email'}</span>
          <span className="text-zinc-600">({email})</span>
        </button>

        <a
          href="https://www.linkedin.com/in/drix10"
          target="_blank"
          rel="noreferrer"
          className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors"
        >
          LinkedIn Message ↗
        </a>

        <a
          href="https://x.com/Drix_10"
          target="_blank"
          rel="noreferrer"
          className="px-4 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-colors"
        >
          X / Twitter DM ↗
        </a>
      </div>
    </div>
  );
}
