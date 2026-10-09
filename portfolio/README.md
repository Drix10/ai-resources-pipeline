# drix10.com

Next.js 14 portfolio. Almost everything about projects comes from GitHub, so it stays in sync with the profile.

## What is live and what is written by hand

| Part | Source |
| --- | --- |
| Projects (descriptions, topics, language, stars, forks, last update) | GitHub GraphQL, read on the server |
| Which repos are featured | The six repositories pinned on the GitHub profile |
| Open source (pull requests to other people's repos, with their state) | GitHub GraphQL |
| Activity graph and contribution totals | GitHub GraphQL |
| Latest blog digests | `https://blogs.drix10.com/rss.xml` |
| Roles, hackathons, education, skills, "building now" | `lib/profile.ts` (edit by hand) |

The page is static and revalidates hourly (`revalidate = 3600`). If GitHub cannot be reached while revalidating, the previous version keeps being served; if it cannot be reached at build time, the build fails rather than shipping an empty page.

## Setup

```bash
npm install
cp .env.example .env.local   # then set GITHUB_READ_TOKEN
npm run dev                  # http://localhost:3001
npm test                     # selection and parsing logic, run against a real GitHub response
```

`GITHUB_READ_TOKEN` is a read-only GitHub token (a fine-grained token with read access to public repositories is enough). It is only read on the server (`lib/github.ts` imports `server-only`) and never reaches the browser. Without it the site falls back to GitHub's unauthenticated REST list: repos and stars still load, but pinned repos, pull requests and the activity graph do not.

`GITHUB_READ_TOKEN`, `GITHUB_TOKEN` and `GITHUB_PAT` are all accepted, in that order.

## Which repos are listed

- **Pinned on GitHub**: the pinned repositories, in pin order (forks and archived repos are kept if you pinned them).
- **More recent work**: other original repositories that have a real description and were updated in the last 18 months, or have at least 5 stars. Hide a repo by adding its name to `HIDDEN_REPOS` in `lib/profile.ts`.

## Hero and SEO

- The opening is a pinned, scroll-driven scene (`components/BankaiHero.tsx`): scroll position is the playhead, a sealed blade builds pressure and is released, and the name is cut into the page. The captions are the real timeline (first commit 2019, ReeF acquired 2024, agents now). It is an original illustration made of SVG and CSS transforms: no video, canvas or animation library, nothing runs while idle, and the page script is about 9 kB. It is scroll-linked, so it plays whatever the reduced-motion setting is.
- The mice section after it is the Night-Hunt simulation from [ml-videos](https://github.com/Drix10/ml-videos): mice that run from an owl and are never caught. The owl hunts by itself and ignores the pointer; mice fade out of the way of the text (`data-quiet`) (`components/AgentField.tsx`).
- `NEXT_PUBLIC_SITE_URL` sets the address used for canonicals, the sitemap and structured data (default `https://drix10.com`). Match it to whichever of apex or `www` your host redirects to. Optional: `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`.
- Audit a deployment from the repository root: `npm run seo:audit -- https://drix10.com`.
