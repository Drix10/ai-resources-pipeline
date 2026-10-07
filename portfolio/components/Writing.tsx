import { ArrowUpRight } from 'lucide-react';

const BLOG = 'https://blogs.drix10.com';

// Written by hand, so they are listed by hand and always shown.
const ESSAYS = [
  {
    title: 'How I built, scaled and sold a startup',
    note: 'The story of ReeF, from a Discord bot to an acquisition.',
    href: `${BLOG}/articles/personal/intern-to-competitor`,
  },
  {
    title: 'Building autonomous AI systems',
    note: 'Why the hard part is the state machine around the model, not the tokens.',
    href: `${BLOG}/articles/personal/building-autonomous-ai-systems`,
  },
];

interface Digest {
  title: string;
  href: string;
  date: string;
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// An RSS text node is either plain (entity-encoded) or a CDATA block (literal text).
const textOf = (raw: string | undefined) => {
  if (!raw) return '';
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return (cdata ? cdata[1] : decode(raw)).trim();
};

// Latest digests come straight from the blog's feed, refreshed hourly. If the feed
// is unreachable the section still renders with the essays and a link.
async function latestDigests(): Promise<Digest[]> {
  try {
    const res = await fetch(`${BLOG}/rss.xml`, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const out: Digest[] = [];
    for (const item of xml.split('<item>').slice(1)) {
      const field = (tag: string) => textOf((item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]);
      const category = field('category');
      if (/^(personal|linkedin insights)$/i.test(category)) continue;
      const title = field('title');
      const link = field('link');
      const pub = field('pubDate');
      if (!title || !link.startsWith(BLOG + '/')) continue;
      const when = pub ? new Date(pub) : null;
      out.push({
        title: title.replace(/^[\p{Extended_Pictographic}\uFE0F\u200D\s]+/u, '').trim(),
        href: link,
        date: when && !isNaN(when.getTime()) ? when.toISOString().slice(0, 10) : '',
      });
      if (out.length === 5) break;
    }
    return out;
  } catch {
    return [];
  }
}

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default async function Writing() {
  const digests = await latestDigests();

  return (
    <div className="space-y-12">
      <ul className="divide-y divide-rule border-y border-rule">
        {ESSAYS.map((e) => (
          <li key={e.href}>
            <a href={e.href} target="_blank" rel="noreferrer" className="group flex items-baseline justify-between gap-6 py-5">
              <span>
                <span className="block text-[1.375rem] font-semibold leading-snug tracking-tight text-ink transition-colors group-hover:text-accent sm:text-[1.5rem]" style={{ fontVariationSettings: "'wdth' 92" }}>
                  {e.title}
                </span>
                <span className="mt-1 block font-serif text-[1.0625rem] text-body">{e.note}</span>
              </span>
              <ArrowUpRight className="h-5 w-5 shrink-0 translate-y-1 text-faint transition-colors group-hover:text-accent" aria-hidden />
            </a>
          </li>
        ))}
      </ul>

      <div>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h3 className="font-semibold text-ink">Latest on the blog</h3>
          <a href={BLOG} target="_blank" rel="noreferrer" className="link inline-flex items-center gap-1 text-[0.9375rem]">
            Browse the whole archive
            <ArrowUpRight className="h-4 w-4" aria-hidden />
          </a>
        </div>
        {digests.length > 0 ? (
          <ul className="space-y-2.5">
            {digests.map((d) => (
              <li key={d.href} className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
                <time dateTime={d.date} className="w-[6.5rem] shrink-0 text-[0.875rem] tabular-nums text-faint">{d.date ? formatDate(d.date) : ''}</time>
                <a href={d.href} target="_blank" rel="noreferrer" className="text-ink underline decoration-rule decoration-[1.5px] underline-offset-[5px] transition-colors hover:text-accent hover:decoration-accent">
                  {d.title}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-serif text-[1.0625rem] text-body">
            The blog collects short, sourced digests on AI, developer tools and security. Open it to see what is new.
          </p>
        )}
      </div>
    </div>
  );
}
