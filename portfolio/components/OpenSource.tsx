import { ArrowUpRight } from 'lucide-react';
import type { ContribRepo } from '@/lib/merge';

const STATE_LABEL = { MERGED: 'merged', OPEN: 'open', CLOSED: 'closed' } as const;

// Pull requests to other people's repositories, straight from GitHub. The state is
// shown exactly as GitHub reports it: "merged" only when the PR was merged.
export default function OpenSource({ repos }: { repos: ContribRepo[] }) {
  if (repos.length === 0) return null;
  return (
    <ul className="border-t border-rule">
      {repos.map((r) => (
        <li key={r.fullName} className="border-b border-rule py-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3>
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-baseline gap-1.5 break-all text-[1.375rem] font-semibold leading-tight tracking-tight text-ink transition-colors hover:text-accent"
                style={{ fontVariationSettings: "'wdth' 92" }}
              >
                {r.fullName}
                <ArrowUpRight className="h-4 w-4 shrink-0 self-center text-faint" aria-hidden />
              </a>
            </h3>
            <p className="text-[0.9375rem] text-faint">
              {r.stars > 0 ? `${r.stars.toLocaleString('en-US')} star${r.stars === 1 ? '' : 's'}, ` : ''}
              {r.prCount} pull request{r.prCount === 1 ? '' : 's'} from me
            </p>
          </div>
          <ul className="mt-3 space-y-1.5">
            {r.prs.map((p) => (
              <li key={p.url} className="flex items-baseline gap-3">
                <span className={`w-14 shrink-0 text-[0.875rem] ${p.state === 'MERGED' ? 'font-semibold text-accent' : 'text-faint'}`}>{STATE_LABEL[p.state]}</span>
                <a href={p.url} target="_blank" rel="noreferrer" className="link">
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}
