'use client';

import React, { useEffect, useState, useRef } from 'react';
import initialViewsData from '@/lib/views-data.json';

const SEED_TOTAL_VIEWS = typeof (initialViewsData as any)?.totalViews === 'number' 
  ? (initialViewsData as any).totalViews 
  : 8950;

export default function HeaderLiveCounter() {
  const [totalViews, setTotalViews] = useState<number>(SEED_TOTAL_VIEWS);
  const highWaterMark = useRef<number>(SEED_TOTAL_VIEWS);

  // Helper: only accept values >= current high-water mark, storage-safe
  const updateViews = (newVal: number) => {
    if (!newVal || isNaN(newVal)) return;
    const safe = Math.max(SEED_TOTAL_VIEWS, newVal, highWaterMark.current);
    highWaterMark.current = safe;
    setTotalViews(safe);
    try {
      if (typeof window !== 'undefined') {
        localStorage.setItem('drix10_total_views', String(safe));
      }
    } catch (e) {}
  };

  useEffect(() => {
    // 1. Check local storage safely on client mount
    try {
      const cached = localStorage.getItem('drix10_total_views');
      if (cached && !isNaN(Number(cached))) {
        updateViews(Number(cached));
      }
    } catch (e) {}

    // 2. Fetch server view count once on mount
    let isMounted = true;
    fetch('/api/views')
      .then((res) => {
        if (!res.ok) throw new Error('Network error');
        return res.json();
      })
      .then((data) => {
        if (isMounted && data?.totalViews) {
          updateViews(data.totalViews);
        }
      })
      .catch(() => {});

    // 3. Listen for real-time article view events
    const handleViewRecorded = (e: any) => {
      if (e?.detail?.totalViews) {
        updateViews(e.detail.totalViews);
      }
    };

    window.addEventListener('viewRecorded', handleViewRecorded);
    return () => {
      isMounted = false;
      window.removeEventListener('viewRecorded', handleViewRecorded);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {totalViews.toLocaleString()}
      </span>
      <span className="hidden md:inline text-zinc-500 text-[11px]">reads</span>
    </div>
  );
}
