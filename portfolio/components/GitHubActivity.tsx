'use client';

import React, { useEffect, useState } from 'react';
import { ExternalLink, Activity as ActivityIcon } from 'lucide-react';

interface Day {
  date: string;
  contributionCount: number;
  contributionLevel: string;
}

interface Week {
  contributionDays: Day[];
}

export default function GitHubActivity() {
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [hovered, setHovered] = useState<{ date: string; count: number } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch('/api/github')
      .then((res) => res.json())
      .then((data) => {
        if (data?.weeks) {
          setWeeks(data.weeks);
          setTotal(data.totalContributions || 2450);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getColorClass = (level: string, count: number) => {
    if (count === 0 || level === 'NONE') return 'bg-zinc-800/60 hover:ring-1 hover:ring-zinc-600';
    if (level === 'FIRST_QUARTILE' || count === 1) return 'bg-emerald-950/80 border border-emerald-900/60 hover:bg-emerald-900';
    if (level === 'SECOND_QUARTILE' || count <= 3) return 'bg-emerald-800 hover:bg-emerald-700';
    if (level === 'THIRD_QUARTILE' || count <= 6) return 'bg-emerald-600 hover:bg-emerald-500';
    return 'bg-emerald-400 hover:bg-emerald-300 shadow-sm shadow-emerald-400/30';
  };

  return (
    <div className="p-6 sm:p-7 rounded-3xl bg-zinc-900/40 border border-zinc-800 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ActivityIcon className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm text-zinc-100 font-mono">
              Live Open Source & GitHub Activity
            </h3>
          </div>
          <p className="text-xs text-zinc-400">
            Real-time public commit activity, repository maintenance, and autonomous AI systems.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right font-mono">
            <span className="text-sm font-bold text-zinc-100">
              {total > 0 ? total.toLocaleString() : '2,450+'}
            </span>
            <span className="text-[11px] text-zinc-500 block">contributions in last year</span>
          </div>
          <a
            href="https://github.com/Drix10"
            target="_blank"
            rel="noreferrer"
            className="p-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            title="Open GitHub Profile (@Drix10)"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </div>

      {/* Heatmap Matrix Container */}
      <div className="overflow-x-auto pb-2 no-scrollbar">
        <div className="min-w-[680px] space-y-2">
          {loading ? (
            <div className="h-28 flex items-center justify-center font-mono text-xs text-zinc-500 animate-pulse">
              Loading contribution stream from GitHub API...
            </div>
          ) : (
            <div className="flex gap-[3px]">
              {weeks.map((week, wIdx) => (
                <div key={wIdx} className="flex flex-col gap-[3px]">
                  {week.contributionDays.map((day, dIdx) => (
                    <div
                      key={dIdx}
                      onMouseEnter={() => setHovered({ date: day.date, count: day.contributionCount })}
                      onMouseLeave={() => setHovered(null)}
                      className={`w-[10px] h-[10px] rounded-[2px] cursor-pointer transition-all ${getColorClass(
                        day.contributionLevel,
                        day.contributionCount
                      )}`}
                      title={`${day.contributionCount} contributions on ${day.date}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Footer Legend & Tooltip */}
          <div className="flex items-center justify-between pt-2 text-[10px] font-mono text-zinc-500">
            <div>
              {hovered ? (
                <span className="text-zinc-200 font-semibold animate-in fade-in duration-100">
                  {hovered.count} contributions on {hovered.date}
                </span>
              ) : (
                <span>Hover over dates to inspect commits</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span>Less</span>
              <span className="w-2.5 h-2.5 rounded-[2px] bg-zinc-800/80"></span>
              <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-950 border border-emerald-900/60"></span>
              <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-700"></span>
              <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-500"></span>
              <span className="w-2.5 h-2.5 rounded-[2px] bg-emerald-400"></span>
              <span>More</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
