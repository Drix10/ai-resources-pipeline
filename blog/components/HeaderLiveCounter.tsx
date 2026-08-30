'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import initialViewsData from '@/lib/views-data.json';

const SEED_TOTAL_VIEWS = typeof (initialViewsData as any)?.totalViews === 'number' 
  ? (initialViewsData as any).totalViews 
  : 8950;

export default function HeaderLiveCounter() {
  const [totalViews, setTotalViews] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('drix10_total_views');
      if (cached && !isNaN(Number(cached))) {
        return Math.max(SEED_TOTAL_VIEWS, Number(cached));
      }
    }
    return SEED_TOTAL_VIEWS;
  });

  const pathname = usePathname();

  const fetchViews = () => {
    fetch('/api/views')
      .then((res) => {
        if (!res.ok) throw new Error('Network error');
        return res.json();
      })
      .then((data) => {
        if (data?.totalViews) {
          const val = Math.max(SEED_TOTAL_VIEWS, data.totalViews);
          setTotalViews(val);
          if (typeof window !== 'undefined') {
            localStorage.setItem('drix10_total_views', String(val));
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchViews();

    const handleViewRecorded = (e: any) => {
      if (e?.detail?.totalViews) {
        const val = Math.max(SEED_TOTAL_VIEWS, e.detail.totalViews);
        setTotalViews(val);
        if (typeof window !== 'undefined') {
          localStorage.setItem('drix10_total_views', String(val));
        }
      }
    };

    window.addEventListener('viewRecorded', handleViewRecorded);
    return () => {
      window.removeEventListener('viewRecorded', handleViewRecorded);
    };
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
        {totalViews.toLocaleString()}
      </span>
      <span className="hidden md:inline text-zinc-500 text-[11px]">reads</span>
    </div>
  );
}
