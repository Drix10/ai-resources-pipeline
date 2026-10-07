// Pure selection logic (no runtime imports) so it can be unit-tested without Next.
// Everything the site shows about projects comes from GitHub; this decides which
// repos are worth showing and shapes them for the page.

export interface Repo {
  fullName: string; // "Drix10/agent-flow"
  name: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  pushedAt: string;
  language: string | null;
  topics: string[];
  homepage: string | null;
  isFork: boolean;
  isArchived: boolean;
  pinnedRank: number | null; // 0-based position on the profile, null when not pinned
}

export interface PullRequest {
  title: string;
  url: string;
  state: 'MERGED' | 'OPEN' | 'CLOSED';
}

export interface ContribRepo {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  prCount: number;
  prs: PullRequest[];
}

export interface Selection {
  featured: Repo[];
  more: Repo[];
}

const DAY = 86400000;

export interface SelectOptions {
  login: string;
  now?: number;
  hide?: string[]; // repo names to leave out (lowercase)
  maxMore?: number;
  recentDays?: number;
  minStars?: number;
}

// Featured = the repos pinned on the GitHub profile, in pin order. "More" = other original
// work that has a description and is either recent or has earned stars, so abandoned
// experiments and empty repos never reach the page.
export function selectProjects(repos: Repo[], opts: SelectOptions): Selection {
  const { login, now = Date.now(), hide = [], maxMore = 10, recentDays = 540, minStars = 5 } = opts;
  const hidden = new Set(hide.map((h) => h.toLowerCase()));
  const seen = new Set<string>();
  const unique = repos.filter((r) => {
    const key = r.fullName.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const featured = unique
    .filter((r) => r.pinnedRank !== null && !hidden.has(r.name.toLowerCase()))
    .sort((a, b) => (a.pinnedRank as number) - (b.pinnedRank as number));

  const recent = (r: Repo) => {
    const t = Date.parse(r.pushedAt);
    return Number.isFinite(t) && now - t <= recentDays * DAY;
  };

  const more = unique
    .filter(
      (r) =>
        r.pinnedRank === null &&
        !r.isFork &&
        !r.isArchived &&
        !hidden.has(r.name.toLowerCase()) &&
        r.name.toLowerCase() !== login.toLowerCase() && // the profile README repo
        Boolean(r.description && r.description.trim().length >= 12) &&
        (recent(r) || r.stars >= minStars),
    )
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt))
    .slice(0, maxMore);

  return { featured, more };
}

// Without a token only the REST list is available, so nothing is pinned: promote the
// strongest originals instead (stars first, then recency).
export function promoteWhenNoPins(sel: Selection, repos: Repo[], opts: SelectOptions, count = 6): Selection {
  if (sel.featured.length > 0) return sel;
  const pool = [...sel.more, ...repos.filter((r) => !sel.more.includes(r))]
    .filter((r) => !r.isFork && !r.isArchived && r.description && r.name.toLowerCase() !== opts.login.toLowerCase())
    .sort((a, b) => b.stars - a.stars || Date.parse(b.pushedAt) - Date.parse(a.pushedAt));
  const featured = pool.slice(0, count);
  return { featured, more: sel.more.filter((r) => !featured.includes(r)) };
}

// Languages that actually appear in the visible repos, most common first, for the filter tabs.
export function languageFilters(repos: Repo[], max = 5): string[] {
  const counts = new Map<string, number>();
  for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([l]) => l);
}

// Pull requests to repos owned by someone else. Private repos never appear.
export function externalContributions(
  raw: {
    repository: { nameWithOwner: string; url: string; description: string | null; stargazerCount: number; isPrivate: boolean; owner: { login: string } };
    contributions: { totalCount: number; nodes: ({ pullRequest: { title: string; url: string; state: string } | null } | null)[] };
  }[],
  login: string,
): ContribRepo[] {
  return raw
    .filter((x) => x && x.repository && !x.repository.isPrivate && x.repository.owner.login.toLowerCase() !== login.toLowerCase())
    .map((x) => ({
      fullName: x.repository.nameWithOwner,
      url: x.repository.url,
      description: x.repository.description,
      stars: x.repository.stargazerCount,
      prCount: x.contributions.totalCount,
      prs: x.contributions.nodes
        .map((n) => n && n.pullRequest)
        .filter((p): p is NonNullable<typeof p> => Boolean(p))
        .map((p) => ({ title: p.title, url: p.url, state: (['MERGED', 'OPEN', 'CLOSED'].includes(p.state) ? p.state : 'CLOSED') as PullRequest['state'] })),
    }))
    .sort((a, b) => b.stars - a.stars);
}

// ---- GitHub GraphQL response -> page data (pure, so it is tested on a real response) ----

export interface CalendarDay {
  date: string;
  contributionCount: number;
  contributionLevel: string;
}

export interface GitHubProfile {
  selection: Selection;
  openSource: ContribRepo[];
  calendar: { total: number; weeks: { contributionDays: CalendarDay[] }[] } | null;
  totals: { commits: number; pullRequests: number } | null;
  source: 'graphql' | 'rest';
}

interface GqlRepo {
  name: string;
  nameWithOwner: string;
  url: string;
  description: string | null;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string;
  homepageUrl: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  primaryLanguage: { name: string } | null;
  repositoryTopics?: { nodes: { topic: { name: string } }[] };
}

const fromGql = (r: GqlRepo, pinnedRank: number | null): Repo => ({
  fullName: r.nameWithOwner,
  name: r.name,
  url: r.url,
  description: r.description,
  stars: r.stargazerCount,
  forks: r.forkCount,
  pushedAt: r.pushedAt,
  language: r.primaryLanguage ? r.primaryLanguage.name : null,
  topics: ((r.repositoryTopics && r.repositoryTopics.nodes) || []).map((n) => n.topic.name),
  homepage: r.homepageUrl || null,
  isFork: r.isFork,
  isArchived: r.isArchived,
  pinnedRank,
});

// Returns null for an error response or a missing user, so callers can fall back.
export function parseGraphqlProfile(json: any, opts: SelectOptions): GitHubProfile | null {
  const user = json && json.data && json.data.user;
  if (!user) return null; // partial errors (one repo hidden by permissions) still leave usable data

  const pinned: GqlRepo[] = ((user.pinnedItems && user.pinnedItems.nodes) || []).filter((r: GqlRepo | null) => r && !r.isPrivate);
  const own: GqlRepo[] = ((user.repositories && user.repositories.nodes) || []).filter((r: GqlRepo | null) => r && !r.isPrivate);
  const repos: Repo[] = [...pinned.map((r, i) => fromGql(r, i)), ...own.map((r) => fromGql(r, null))];

  const cc = user.contributionsCollection;
  const cal = cc && cc.contributionCalendar;
  return {
    selection: selectProjects(repos, opts),
    openSource: externalContributions((cc && cc.pullRequestContributionsByRepository) || [], opts.login),
    calendar: cal ? { total: cal.totalContributions, weeks: cal.weeks } : null,
    totals: cc ? { commits: cc.totalCommitContributions, pullRequests: cc.totalPullRequestContributions } : null,
    source: 'graphql',
  };
}

// A repo's "homepage" field is often a social profile; only real project sites are worth a link.
const NOT_A_SITE = /(^|\.)(x\.com|twitter\.com|instagram\.com|facebook\.com|linkedin\.com|lnkd\.in|youtube\.com|youtu\.be|t\.me|discord\.gg|discord\.com|tiktok\.com|github\.com)$/i;
export function siteUrl(homepage: string | null | undefined): string | null {
  if (!homepage) return null;
  const raw = homepage.trim();
  // A bare "example.com" gets https; any other explicit scheme (ftp:, javascript:) is refused.
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(u.protocol) || NOT_A_SITE.test(u.hostname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}
