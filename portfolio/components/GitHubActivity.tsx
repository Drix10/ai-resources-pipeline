'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';

interface Day {
  date: string;
  contributionCount: number;
  contributionLevel: string;
}

interface Props {
  total: number;
  weeks: { contributionDays: Day[] }[];
  pullRequests?: number;
  username: string;
}

// Five steps of one hue, so intensity reads as "more" without a second colour.
const shade = (level: string, count: number) => {
  if (count === 0 || level === 'NONE') return 'bg-sunk';
  if (level === 'FIRST_QUARTILE' || count === 1) return 'bg-accent/25';
  if (level === 'SECOND_QUARTILE' || count <= 3) return 'bg-accent/50';
  if (level === 'THIRD_QUARTILE' || count <= 6) return 'bg-accent/75';
  return 'bg-accent';
};

const formatDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function GitHubActivity({ total, weeks, pullRequests, username }: Props) {
  const [hovered, setHovered] = useState<Day | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // On narrow screens the calendar is wider than the viewport: start at the newest weeks.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="font-semibold text-ink">
          {total.toLocaleString('en-US')} contributions in the last year
          {pullRequests ? `, ${pullRequests.toLocaleString('en-US')} of them pull requests` : ''}
        </h3>
        <a href={`https://github.com/${username}`} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-[0.9375rem]">
          github.com/{username}
          <ArrowUpRight className="h-4 w-4" aria-hidden />
        </a>
      </div>

      <div ref={scroller} tabIndex={0} role="region" aria-label="Contribution calendar, scrollable" className="scroll-x-hidden overflow-x-auto pb-2">
        <div className="flex min-w-[680px] gap-[3px]" role="img" aria-label={`GitHub contribution calendar: ${total} contributions in the last year`}>
          {weeks.map((week, w) => (
            <div key={w} className="flex flex-col gap-[3px]">
              {week.contributionDays.map((day) => (
                <div
                  key={day.date}
                  onMouseEnter={() => setHovered(day)}
                  onMouseLeave={() => setHovered(null)}
                  className={`h-[11px] w-[11px] rounded-[2px] ${shade(day.contributionLevel, day.contributionCount)}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <p className="mt-2 min-h-[1.5rem] text-[0.875rem] text-faint">
        {hovered
          ? `${hovered.contributionCount} contribution${hovered.contributionCount === 1 ? '' : 's'} on ${formatDay(hovered.date)}`
          : 'Hover a square to see that day.'}
      </p>
    </div>
  );
}
