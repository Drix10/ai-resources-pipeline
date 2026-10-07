import 'server-only';
import { PROFILE_QUERY } from './github-query';
import { parseGraphqlProfile, promoteWhenNoPins, selectProjects, type GitHubProfile, type Repo } from './merge';
import { HIDDEN_REPOS } from './profile';

export const USERNAME = process.env.GITHUB_USERNAME || 'Drix10';
const REVALIDATE_SECONDS = 3600;

// The same server-side token the old activity graph used. It is read here, on the server
// only, and never reaches the browser.
const githubToken = () => process.env.GITHUB_READ_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || '';

export type { CalendarDay, GitHubProfile } from './merge';

async function viaGraphql(token: string): Promise<GitHubProfile | null> {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'Drix10-Portfolio' },
    body: JSON.stringify({ query: PROFILE_QUERY, variables: { login: USERNAME } }),
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  return parseGraphqlProfile(await res.json(), { login: USERNAME, hide: HIDDEN_REPOS });
}

interface RestRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  pushed_at: string;
  language: string | null;
  topics?: string[];
  homepage: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
}

// Without a token the REST API still lists public repos (60 requests an hour). Pins,
// pull requests and the calendar need GraphQL, so those parts are simply absent.
async function viaRest(token: string): Promise<GitHubProfile | null> {
  const res = await fetch(`https://api.github.com/users/${USERNAME}/repos?per_page=100&sort=pushed&type=owner`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Drix10-Portfolio', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    next: { revalidate: REVALIDATE_SECONDS },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const list = (await res.json()) as RestRepo[];
  if (!Array.isArray(list)) return null;
  const repos: Repo[] = list
    .filter((r) => !r.private)
    .map((r) => ({
      fullName: r.full_name,
      name: r.name,
      url: r.html_url,
      description: r.description,
      stars: r.stargazers_count,
      forks: r.forks_count,
      pushedAt: r.pushed_at,
      language: r.language,
      topics: r.topics ?? [],
      homepage: r.homepage || null,
      isFork: r.fork,
      isArchived: r.archived,
      pinnedRank: null,
    }));
  const opts = { login: USERNAME, hide: HIDDEN_REPOS };
  return {
    selection: promoteWhenNoPins(selectProjects(repos, opts), repos, opts),
    openSource: [],
    calendar: null,
    totals: null,
    source: 'rest',
  };
}

// The last successful result, kept for the life of the server process so a GitHub outage
// during revalidation does not blank the page.
let lastGood: GitHubProfile | null = null;

export async function getGitHubProfile(): Promise<GitHubProfile | null> {
  const token = githubToken();
  try {
    if (token) {
      // With a token, GraphQL is the source of truth. If it fails (revoked token, outage) keep the
      // last good copy rather than quietly swapping in the smaller public list.
      const live = await viaGraphql(token);
      if (live) lastGood = live;
      return live ?? lastGood;
    }
    const live = await viaRest('');
    if (live) lastGood = live;
    return live ?? lastGood;
  } catch {
    return lastGood;
  }
}
