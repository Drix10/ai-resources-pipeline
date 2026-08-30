'use client';

import React, { useEffect, useState } from 'react';

interface Props {
  slug: string;
  initialViews: number;
  initialAiViews: number;
}

export default function ArticleViewTracker({ slug, initialViews, initialAiViews }: Props) {
  const [views, setViews] = useState(initialViews);
  const [aiViews, setAiViews] = useState(initialAiViews);

  useEffect(() => {
    let isMounted = true;
    const sessionKey = `viewed:${slug}`;

    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem(sessionKey)) {
        return; // Already recorded this session
      }
    } catch (e) {}

    fetch('/api/views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data?.stats) {
          setViews(data.stats.views);
          setAiViews(data.stats.aiViews);
        }
        if (data?.totalViews && typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(sessionKey, '1');
          } catch (e) {}
          window.dispatchEvent(new CustomEvent('viewRecorded', { detail: data }));
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [slug]);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300 shadow-sm">
        <span className="text-zinc-400">👁️</span>
        <span className="font-bold text-zinc-100">{views.toLocaleString()}</span>
        <span className="text-zinc-500 text-[11px]">reads (human + AI)</span>
      </span>
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-zinc-900/60 border border-zinc-800/80 text-zinc-400 text-[11px]">
        <span>🤖</span>
        <span className="font-semibold text-zinc-300">{aiViews.toLocaleString()}</span>
        <span className="text-zinc-500">AI ingestions</span>
      </span>
    </div>
  );
}
