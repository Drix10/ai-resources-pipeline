# ⚡ Drix10 Technical Knowledge Hub (Next.js 14)

Live Hub: [blogs.drix10.com](https://blogs.drix10.com)

High-performance, statically generated technical research and architecture teardown hub built on **Next.js 14 App Router**, **Tailwind CSS**, and **Lucide Icons**.

---

## 🏛️ Architecture & Highlights

- **8,940+ Technical Guides**: Deep-dives across 42 specialized computing, AI, systems, and security domains.
- **Sub-60ms In-Memory Search**: Pre-tokenized inverted search index stored in `lib/articles-index.json` with instant client-side filtering.
- **Automated Companion Slides**: Visual dark-mode architecture slides rendered by the agentic pipeline are automatically served from `public/slides/` and embedded in posts.
- **Incremental Static Regeneration (ISR)**: Pre-renders high-priority pages statically and revalidates dynamically on push.
- **Automated Vercel Sync**: Root cron cycles automatically rebuild the index and push verified builds to `origin main` to trigger instant live deployment.

---

## 📂 Content Organization

- `content/`: Markdown knowledge base organized by technical domains (AI Developer Tools, Systems Architecture, Cybersecurity, etc.).
- `content/LinkedIn Insights/`: Automated LinkedIn breakdowns and technical teardowns synchronized directly by `post-gen.js` and the cron engine.
- `content/Personal/`: Essays and announcements written directly by Drishtant Ghosh (pinned with highest priority).
- `lib/`: Core markdown parsing, frontmatter extraction, and tokenized search index utilities.
- `public/slides/`: Dark-mode architecture PNG cards generated for each post.

---

## 🚀 Local Development

```bash
# 1. Install dependencies
npm install

# 2. Rebuild the search index (if new markdown guides were added)
node ../src/utils/rebuildIndex.js

# 3. Start the Next.js dev server (http://localhost:3000)
npm run dev

# 4. Build for production
npm run build
```

---

## 📄 License
MIT License © 2026 [Drishtant Ghosh](https://drix10.com)
