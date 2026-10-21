# AI Resources Blog

The public site of the AI resources pipeline: [blogs.drix10.com](https://blogs.drix10.com). A statically generated Next.js 14 (App Router) site with Tailwind CSS, serving the guides the pipeline writes: about 2,000 articles across 43 domains.

## How it works

- **Content** lives in `content/<domain>/*.md` (plain Markdown). `content/LinkedIn Insights/` holds long-form posts and `content/Personal/` the author's own essays, pinned first.
- **Search index.** `lib/articles-index.json` is a pre-tokenized index of every article that the site loads for instant client-side search. The pipeline rebuilds it after each run (`rebuildBlogIndex` in `src/utils/helpers.js` at the repository root) and commits it with the new content.
- **Slides.** Each post's companion card is served from `public/slides/`.
- **Deploys.** The pipeline builds the site and pushes only when the build passes, at most once a day: a deploy starts the page cache over, so later runs that day leave their new articles for the next day's push. Vercel builds only a push that changes `blog/` (`ignoreCommand` in `vercel.json` compares it with the last deployed commit), and pages never revalidate, since content only changes with a deploy. Node 24 (`engines`).
- **Settings** (Vercel environment variables): `CANONICAL_BASE_URL`, the site's public address for canonicals and the sitemap (default `https://blogs.drix10.com`; the pipeline's `.env` uses the same name); `NEXT_PUBLIC_PORTFOLIO_URL`, the portfolio it links to (default `https://drix10.com`); optional `GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION`.

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (the pipeline runs this before every push)
npm test           # unit tests for the content and index helpers
```

To rebuild the index by hand after editing content, run this from the repository root:

```bash
node -e "require('./src/utils/helpers').rebuildBlogIndex()"
```

## License

MIT (see the repository's [LICENSE](../LICENSE)).
