'use client';

import React, { useEffect, useState } from 'react';

export default function LocalTimeBadge() {
  const [time, setTime] = useState('');

  useEffect(() => {
    const updateTime = () => {
      try {
        const now = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(new Date());
        setTime(now);
      } catch (e) {}
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  if (!time) return null;

  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/90 border border-zinc-800 text-[11px] font-mono text-zinc-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
      <span>India (IST)</span>
      <span className="text-zinc-600">•</span>
      <span className="text-zinc-200 font-semibold">{time}</span>
    </div>
  );
}
