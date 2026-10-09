'use client';

import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { languageFilters, siteUrl, type Repo } from '@/lib/merge';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};

function Row({ repo }: { repo: Repo }) {
  const site = siteUrl(repo.homepage);
  const meta = [
    repo.language,
    repo.stars > 0 ? `${repo.stars.toLocaleString('en-US')} star${repo.stars === 1 ? '' : 's'}` : '',
    repo.forks > 0 ? `${repo.forks.toLocaleString('en-US')} fork${repo.forks === 1 ? '' : 's'}` : '',
    repo.isFork ? 'fork' : '',
    repo.pushedAt ? `updated ${formatDate(repo.pushedAt)}` : '',
  ].filter(Boolean);

  return (
    <li className="row-slash grid gap-x-12 gap-y-2 border-b border-rule py-8 sm:grid-cols-[minmax(0,22rem)_1fr]">
      <div className="min-w-0">
        <h4>
          <a
            href={repo.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-baseline gap-2 break-words text-[clamp(1.75rem,3.4vw,2.6rem)] font-bold leading-[1.02] tracking-tight text-ink transition-colors hover:text-accent"
            style={{ fontVariationSettings: "'wdth' 78" }}
          >
            {repo.name}
            <ArrowUpRight className="h-4 w-4 shrink-0 self-center text-faint" aria-hidden />
          </a>
        </h4>
        <p className="mt-1.5 text-[0.9375rem] leading-snug text-faint">{meta.join(', ')}</p>
      </div>
      <div className="min-w-0">
        <p className="prose-text">{repo.description}</p>
        {(repo.topics.length > 0 || site) && (
          <p className="mt-2 text-[0.9375rem] text-faint">
            {repo.topics.slice(0, 6).join(', ')}
            {repo.topics.length > 0 && site ? ', ' : ''}
            {site && (
              <a href={site} target="_blank" rel="noreferrer" className="link">
                {site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}
              </a>
            )}
          </p>
        )}
      </div>
    </li>
  );
}

export default function Work({ featured, more, pinned = true }: { featured: Repo[]; more: Repo[]; pinned?: boolean }) {
  const [language, setLanguage] = useState<string>('All');
  const all = [...featured, ...more];
  const languages = languageFilters(all);
  const match = (r: Repo) => language === 'All' || r.language === language;
  const shownFeatured = featured.filter(match);
  const shownMore = more.filter(match);

  return (
    <div>
      {languages.length > 1 && (
        <div role="group" aria-label="Filter projects by language" className="mb-6 flex flex-wrap gap-x-6 gap-y-1">
          {['All', ...languages].map((l) => {
            const selected = language === l;
            return (
              <button
                key={l}
                aria-pressed={selected}
                onClick={() => setLanguage(l)}
                className={`relative py-2 text-[0.9375rem] transition-colors ${selected ? 'font-semibold text-ink' : 'text-faint hover:text-ink'}`}
              >
                {l}
                {selected && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}

      {shownFeatured.length > 0 && (
        <section aria-labelledby="pinned">
          <h3 id="pinned" className="mb-1 font-semibold text-ink">
            {pinned ? 'Pinned on GitHub' : 'Top projects on GitHub'}
          </h3>
          <ul className="border-t border-rule">
            {shownFeatured.map((r) => (
              <Row key={r.fullName} repo={r} />
            ))}
          </ul>
        </section>
      )}

      {shownMore.length > 0 && (
        <section aria-labelledby="more" className="mt-12">
          <h3 id="more" className="mb-1 font-semibold text-ink">
            More recent work
          </h3>
          <ul className="border-t border-rule">
            {shownMore.map((r) => (
              <Row key={r.fullName} repo={r} />
            ))}
          </ul>
        </section>
      )}

      {shownFeatured.length === 0 && shownMore.length === 0 && (
        <p className="prose-text">No {language} projects right now.</p>
      )}
    </div>
  );
}
