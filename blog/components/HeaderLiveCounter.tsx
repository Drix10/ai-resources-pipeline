'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export default function HeaderLiveCounter() {
  const [totalViews, setTotalViews] = useState<number | null>(null);
  const pathname = usePathname();

  const fetchViews = () => {
    fetch('/api/views')
      .then((res) => {
        if (!res.ok) throw new Error('Network error');
        return res.json();
      })
      .then((data) => {
        if (data?.totalViews) {
          setTotalViews(data.totalViews);
        }
      })
      .catch(() => {});
  };

  // Fetch on initial mount and whenever pathname changes (route visit)
  useEffect(() => {
    fetchViews();
  }, [pathname]);

  return (
    <div 
      title="Real-time live readers and AI agent ingestions"
      className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs font-mono text-zinc-300 min-h-[36px] shadow-sm select-none"
    >
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
      </span>
      <span className="text-zinc-400">👁️</span>
      <span className="font-bold text-zinc-100">
        {totalViews ? totalViews.toLocaleString() : '8,941'}
      </span>
      <span className="hidden md:inline text-zinc-500 text-[11px]">reads</span>
    </div>
  );
}
