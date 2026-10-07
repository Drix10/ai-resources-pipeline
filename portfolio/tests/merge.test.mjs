import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { externalContributions, languageFilters, parseGraphqlProfile, promoteWhenNoPins, selectProjects, siteUrl } from '../lib/merge.ts';

// A real response from GitHub's GraphQL API for the Drix10 account (public data only).
const real = JSON.parse(readFileSync(new URL('./fixtures/github-profile.json', import.meta.url), 'utf8'));
const OPTS = { login: 'Drix10', hide: ['video-storage', 'certificates'], now: Date.parse('2026-10-07T00:00:00Z') };

const repo = (over = {}) => ({
  fullName: 'Drix10/x', name: 'x', url: 'https://github.com/Drix10/x', description: 'A useful description here',
  stars: 0, forks: 0, pushedAt: '2026-09-01T00:00:00Z', language: 'TypeScript', topics: [], homepage: null,
  isFork: false, isArchived: false, pinnedRank: null, ...over,
});

test('real response: pinned repos are featured, in pin order, forks included', () => {
  const p = parseGraphqlProfile(real, OPTS);
  assert.deepEqual(p.selection.featured.map((r) => r.name), ['ai-resources', 'hypothesis-arena', 'ai-resources-pipeline', 'coslynx', 'keystroke-llm', 'agent-flow']);
  assert.equal(p.selection.featured.find((r) => r.name === 'ai-resources-pipeline').isFork, true);
  assert.ok(p.selection.featured.every((r) => r.description && r.url.startsWith('https://github.com/')));
});

test('real response: the "more" list is recent, original, described and not pinned', () => {
  const { featured, more } = parseGraphqlProfile(real, OPTS).selection;
  const pinned = new Set(featured.map((r) => r.fullName));
  assert.ok(more.length > 0 && more.length <= 10);
  for (const r of more) {
    assert.ok(!pinned.has(r.fullName), `${r.name} is pinned`);
    assert.equal(r.isFork, false, `${r.name} is a fork`);
    assert.equal(r.isArchived, false);
    assert.ok(r.description.trim().length >= 12, `${r.name} has no real description`);
    assert.notEqual(r.name.toLowerCase(), 'drix10', 'profile README repo leaked in');
    assert.ok(!['video-storage', 'certificates'].includes(r.name.toLowerCase()), 'hidden repo leaked in');
  }
  const times = more.map((r) => Date.parse(r.pushedAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');
  const names = more.map((r) => r.name);
  for (const expected of ['payscope', 'intent-canvas', 'sentinal']) assert.ok(names.includes(expected), `${expected} should be listed`);
  for (const toy of ['Flashlight-app', 'Game-1', 'GAME-2', 'Calculator-app']) assert.ok(!names.includes(toy), `${toy} should not be listed`);
});

test('real response: open-source work excludes my own repos and keeps real PR states', () => {
  const { openSource } = parseGraphqlProfile(real, OPTS);
  const names = openSource.map((r) => r.fullName);
  assert.ok(names.includes('google-gemini/gemini-cli') && names.includes('skillsynchq/txcript') && names.includes('partpilot-in/partpilot'));
  assert.ok(names.every((n) => !n.toLowerCase().startsWith('drix10/')), 'own repos are not "open source contributions"');
  const stars = openSource.map((r) => r.stars);
  assert.deepEqual(stars, [...stars].sort((a, b) => b - a), 'most-starred first');
  for (const r of openSource) {
    assert.ok(r.prCount >= 1);
    for (const pr of r.prs) {
      assert.ok(['MERGED', 'OPEN', 'CLOSED'].includes(pr.state));
      assert.match(pr.url, /^https:\/\/github\.com\/.+\/pull\/\d+$/);
    }
  }
});

test('real response: calendar and totals come straight from GitHub', () => {
  const p = parseGraphqlProfile(real, OPTS);
  assert.equal(p.calendar.total, real.data.user.contributionsCollection.contributionCalendar.totalContributions);
  assert.ok(p.calendar.weeks.length >= 52);
  assert.ok(p.totals.pullRequests > 0 && p.totals.commits > 0);
  assert.equal(p.source, 'graphql');
});

test('error responses and missing users return null so callers can fall back', () => {
  assert.equal(parseGraphqlProfile({ errors: [{ message: 'Bad credentials' }] }, OPTS), null);
  assert.equal(parseGraphqlProfile({ data: { user: null } }, OPTS), null);
  // A partial error (say, one repo hidden by permissions) still leaves usable data.
  assert.notEqual(parseGraphqlProfile({ data: { user: real.data.user }, errors: [{ message: 'partial' }] }, OPTS), null);
  assert.equal(parseGraphqlProfile(null, OPTS), null);
  assert.equal(parseGraphqlProfile({}, OPTS), null);
});

test('a response with no calendar or contributions still yields projects', () => {
  const trimmed = { data: { user: { pinnedItems: real.data.user.pinnedItems, repositories: real.data.user.repositories, contributionsCollection: null } } };
  const p = parseGraphqlProfile(trimmed, OPTS);
  assert.equal(p.calendar, null);
  assert.equal(p.totals, null);
  assert.deepEqual(p.openSource, []);
  assert.equal(p.selection.featured.length, 6);
});

test('private repos never appear, even when pinned', () => {
  const priv = { ...real.data.user.pinnedItems.nodes[0], isPrivate: true, name: 'secret', nameWithOwner: 'Drix10/secret' };
  const data = { data: { user: { ...real.data.user, pinnedItems: { nodes: [priv, ...real.data.user.pinnedItems.nodes.slice(1)] } } } };
  const p = parseGraphqlProfile(data, OPTS);
  assert.ok(!p.selection.featured.some((r) => r.name === 'secret'));
  assert.ok(![...p.selection.featured, ...p.selection.more].some((r) => r.name === 'secret'));
});

test('selectProjects: dedupes, hides case-insensitively, caps and orders', () => {
  const repos = [
    repo({ fullName: 'a/one', name: 'one', pinnedRank: 1 }),
    repo({ fullName: 'a/two', name: 'two', pinnedRank: 0 }),
    repo({ fullName: 'A/TWO', name: 'two', pinnedRank: 0 }), // duplicate
    repo({ fullName: 'a/hid', name: 'HideMe', pinnedRank: 2 }),
    ...Array.from({ length: 15 }, (_, i) => repo({ fullName: `a/r${i}`, name: `r${i}`, pushedAt: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z` })),
  ];
  const sel = selectProjects(repos, { login: 'a', hide: ['hideme'], now: Date.parse('2026-10-01T00:00:00Z'), maxMore: 10 });
  assert.deepEqual(sel.featured.map((r) => r.name), ['two', 'one']);
  assert.equal(sel.more.length, 10);
  assert.equal(sel.more[0].name, 'r14');
});

test('selectProjects: description, staleness, forks, archives and star rescue', () => {
  const now = Date.parse('2026-10-01T00:00:00Z');
  const old = '2020-01-01T00:00:00Z';
  const repos = [
    repo({ fullName: 'a/nodesc', name: 'nodesc', description: null }),
    repo({ fullName: 'a/short', name: 'short', description: 'hi' }),
    repo({ fullName: 'a/blank', name: 'blank', description: '           ' }),
    repo({ fullName: 'a/stale', name: 'stale', pushedAt: old }),
    repo({ fullName: 'a/starry', name: 'starry', pushedAt: old, stars: 9 }),
    repo({ fullName: 'a/fork', name: 'fork', isFork: true }),
    repo({ fullName: 'a/arch', name: 'arch', isArchived: true }),
    repo({ fullName: 'a/baddate', name: 'baddate', pushedAt: 'not-a-date', stars: 5 }),
    repo({ fullName: 'a/baddate2', name: 'baddate2', pushedAt: 'not-a-date', stars: 1 }),
    repo({ fullName: 'a/a', name: 'a' }), // the profile repo, named after the user
  ];
  const names = selectProjects(repos, { login: 'a', now }).more.map((r) => r.name).sort();
  assert.deepEqual(names, ['baddate', 'starry']);
});

test('selectProjects: a pinned fork or archived repo is still featured (the owner chose it)', () => {
  const sel = selectProjects([repo({ name: 'f', fullName: 'a/f', isFork: true, pinnedRank: 0 }), repo({ name: 'g', fullName: 'a/g', isArchived: true, pinnedRank: 1 })], { login: 'a' });
  assert.equal(sel.featured.length, 2);
});

test('selectProjects: empty input is fine', () => {
  assert.deepEqual(selectProjects([], { login: 'a' }), { featured: [], more: [] });
});

test('promoteWhenNoPins: only without pins, strongest repos first', () => {
  const repos = [repo({ fullName: 'a/lo', name: 'lo', stars: 1 }), repo({ fullName: 'a/hi', name: 'hi', stars: 50 }), repo({ fullName: 'a/mid', name: 'mid', stars: 9 })];
  const opts = { login: 'a', now: Date.parse('2026-10-01T00:00:00Z') };
  const sel = promoteWhenNoPins(selectProjects(repos, opts), repos, opts, 2);
  assert.deepEqual(sel.featured.map((r) => r.name), ['hi', 'mid']);
  assert.deepEqual(sel.more.map((r) => r.name), ['lo']);
  const pinned = selectProjects([repo({ fullName: 'a/p', name: 'p', pinnedRank: 0 })], opts);
  assert.equal(promoteWhenNoPins(pinned, repos, opts), pinned, 'untouched when pins exist');
});

test('languageFilters: most common first, ties alphabetical, capped, nulls ignored', () => {
  const repos = [...['Python', 'Python', 'C', 'Go', 'Go', 'Rust'].map((language) => repo({ language })), repo({ language: null })];
  assert.deepEqual(languageFilters(repos, 3), ['Go', 'Python', 'C']);
  assert.deepEqual(languageFilters([]), []);
});

test('externalContributions: drops own and private repos, tolerates null nodes, normalises state', () => {
  const mk = (owner, name, priv, nodes, total = 1) => ({
    repository: { nameWithOwner: `${owner}/${name}`, url: `https://github.com/${owner}/${name}`, description: null, stargazerCount: name.length, isPrivate: priv, owner: { login: owner } },
    contributions: { totalCount: total, nodes },
  });
  const pr = (state) => ({ pullRequest: { title: 't', url: 'https://github.com/o/r/pull/1', state } });
  const out = externalContributions(
    [mk('drix10', 'mine', false, [pr('MERGED')]), mk('org', 'secret', true, [pr('MERGED')]), mk('org', 'public', false, [null, { pullRequest: null }, pr('weird'), pr('MERGED')], 4), null],
    'Drix10',
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].fullName, 'org/public');
  assert.equal(out[0].prCount, 4);
  assert.deepEqual(out[0].prs.map((p) => p.state), ['CLOSED', 'MERGED']);
});

test('siteUrl keeps real project sites and drops social profiles and junk', () => {
  assert.equal(siteUrl('https://coslynx.com'), 'https://coslynx.com/');
  assert.equal(siteUrl('blogs.drix10.com'), 'https://blogs.drix10.com/');
  assert.equal(siteUrl('https://www.npmjs.com/package/@drix10/agent-flow'), 'https://www.npmjs.com/package/@drix10/agent-flow');
  for (const social of ['https://x.com/ai_scrapper', 'https://twitter.com/x', 'https://www.instagram.com/drix_10_', 'https://lnkd.in/p/gipWJfmn', 'https://www.linkedin.com/in/drix10', 'https://github.com/Drix10/x', 'https://youtu.be/abc']) {
    assert.equal(siteUrl(social), null, social);
  }
  for (const bad of ['', '   ', null, undefined, 'javascript:alert(1)', 'ftp://example.com', 'http://']) assert.equal(siteUrl(bad), null, String(bad));
});

test('the real response never yields a social profile as a project site', () => {
  const { featured, more } = parseGraphqlProfile(real, OPTS).selection;
  const hosts = [...featured, ...more].map((r) => siteUrl(r.homepage)).filter(Boolean).map((u) => new URL(u).hostname);
  for (const h of hosts) assert.ok(!/^(www\.)?(x\.com|twitter\.com|instagram\.com|lnkd\.in|linkedin\.com)$/.test(h), h);
  assert.ok(hosts.some((h) => /coslynx|drix10|npmjs/.test(h)), 'real project sites survive');
});
