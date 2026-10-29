# Reddit comments: where to comment, and how not to get banned

Research for the planned Reddit comment stage of the growth pipeline (same idea as the LinkedIn/X comments: specific, value-first replies, no link drops). Researched 2026-10-29. Nothing was posted, no account was used.

## Read this first: the method had limits

- **Reddit itself could not be read.** `reddit.com/r/<name>/about.json` and the rules pages were blocked for both WebFetch and a plain curl with an honest User-Agent. I did not try to get around that (no spoofed browser UA, no Reddit mirrors).
- **Member counts** come from GummySearch's public subreddit pages (`gummysearch.com/r/<name>/`). Each one shows its own "last updated" date, mostly 2026-10-26 to 2026-10-28. Each count is cited in the table.
- **Activity:** none of the sources I could reach published posts or comments per day. Where saascity.io gives Reddit's "weekly visitors" figure, I use it. Everywhere else, activity is marked **not measured**. Before go-live, the pipeline should read `about.json` through an approved OAuth app (see section 4) and fill these in.
- **Rules** come from third-party guides and search-result excerpts of sidebar and mod posts. They are **secondary sources**. The pipeline must re-read each subreddit's `/about/rules` through the API before its first comment there, and again every week.

## 0. Goal (owner, 2026-10-29): connect, learn pain points, help, earn karma

This is not marketing. We comment to connect with users, understand their pain points and help where we can, and we rarely mention our own products. Karma is a side effect of being useful. What follows from that:

- **Promo rules mostly stop mattering.** With no plugs, even the strict subs in section 2 are safe to comment in. The risks that remain are AI-content bans and Reddit's rules on automation (section 4). Comments that never mention a product are still "automated comments" if a bot posts them.
- **Best subs for karma and pain points.** These have lots of question posts, small enough threads that an early, specific answer gets seen, and our users' pain written down:
  - **r/SaaS**, **r/indiehackers**, **r/microsaas**, **r/indianstartups**, **r/Startup_Ideas**, **r/roastmystartup**: founders asking for help.
  - **r/smallbusiness**, **r/InstagramMarketing**, **r/socialmedia**, **r/content_marketing**, **r/NewTubers**: the pain of making content, which is Factory's buyer research.
  - **r/algotrading**, **r/fintech**: backtesting pain, which is MiroHedge's audience.
  - **r/ClaudeCode**, **r/LLMDevs**, **r/AI_Agents**, **r/LocalLLaMA**: AI builders, where Drishtant's expertise earns karma fastest.
- **What wins karma.** Answer the question in the first lines. Give one concrete detail from your own experience (a number, an error, a fix) and stop. Ask one follow-up question about their situation, which also surfaces the pain point. Be early: a comment in the first hour of a rising thread beats a better one five hours late.
- **Pain-point log.** Every thread the pipeline reads gets its pain written to a file (sub, quote, product it touches, link). That log is the main output, not the comment count. It feeds Factory onboarding, MiroHedge positioning and reel topics.
- **When a mention is fine.** Only if someone asks for a tool, the product truly solves their exact problem, the sub allows it, and you disclose ("I built X, so I'm biased"). Aim for under 1 in 20 comments.
- **Big hostile subs are now fine for helping.** r/Entrepreneur and r/marketing are only off-limits for promo and AI-written text. Plain human help is fine there. r/opensource stays off the list only for posting our repos.

## 1. The products and who uses them

| Product | What it is (from its live site or repo) | Users | Where they are on Reddit |
|---|---|---|---|
| **CosLynx Content Factory** (coslynx.com) | Software that makes short-form reels. It researches, writes, fact-checks, voices and builds each film frame by frame, runs locally with Claude, and uses no AI image or video generation. $270 one-time, Vault Pro $129/yr (coslynx.com, fetched 2026-10-29). | Brand and content managers, small-business owners, solo creators | Founder subs, r/smallbusiness, social and marketing subs, creator subs |
| **MiroHedge** (mirohedge.com, repo Drix10/hypothesis-arena, 10 stars) | "Investing that doesn't need a fortune." Language models write hypotheses, deterministic C++17 gates decide, with pre-registered backtests and deflated-Sharpe gates. **Paper trading only** (repo description). | Retail investors now; quant and algo people judge the method | r/algotrading, r/quant, r/fintech, Indian investing subs |
| **ai-resources** (122 stars) + **ai-resources-pipeline** (4 stars), blogs.drix10.com | 100,000+ fact-checked AI briefings, CC BY 4.0, plus the open-source pipeline that writes them and rejects any number or name not found in the source | AI builders, LLM developers | r/LLMDevs, r/LocalLLaMA, r/ClaudeAI |
| **agent-flow** (12 stars, npm @drix10/agent-flow) | Guardrails for unattended Claude Code, Codex and Cursor: review and QA agents, a protected-path guard, an audit log | Claude Code and agent users | r/ClaudeCode, r/ClaudeAI, r/AI_Agents |
| Tracekit, Sentinel CLI, PayScope | Agent tracing and policy gates; an AI security CLI; Razorpay payment-ops agent | Early, under 2 stars each | Use as background expertise only, not things to promote |

Star counts are from api.github.com/users/Drix10/repos, fetched 2026-10-29.

## 2. Ranked shortlist (29)

Risk means the chance of a ban or removal for a disclosed founder posting helpful, linkless comments. **All rows assume no links and no product names unless someone asks.**

### A. Startup and founder communities (first priority)

| # | Subreddit | Members (source) | Activity | Fits | Rules that matter | Best comment angle | Risk |
|---|---|---|---|---|---|---|---|
| 1 | r/SaaS | 836k, +92%/yr (GummySearch, updated 2026-10-28) | 260k weekly visitors (saascity.io, 2026-09-23) | All; founder ops | **One self-promo per 60 days, and comment plugs count** (search excerpt of the r/SaaS rule). "No vendor spam" (saascity). Promo thread named "Feedback Friday" or "SaaSFeedback Saturday", depending on the source. | Tactical answers with real numbers: payments (Dodo/Razorpay), pricing a $270 one-time product against a subscription, setting up licence-key delivery | Med |
| 2 | r/startups | 2.1M, +11.5%/yr (GummySearch, 2026-10-28) | not measured | All | No promotion anywhere except the stickied **"Share Your Startup"** thread (search excerpt). Mods decide what counts as promo. Reported minimum: 30-day account age and comment karma (secondary sources, unverified). | Hard-won operator answers: cofounder issues, acquisition experience ("1x acquired founder"), costs of building with AI | Med-High |
| 3 | r/indiehackers | 199k, +65%/yr (GummySearch) | ~10.5k weekly visitors (saascity) | All | Journey posts with numbers are welcome. New rules came in 2026 (details not found). | Building-in-public numbers and lessons from solo shipping | Low-Med |
| 4 | r/SideProject | 884k, +70%/yr (GummySearch) | 330k weekly visitors (saascity) | Repos, Factory | High tolerance for promo. Bare landing-page drops get removed and context is required (redship.io). | Specific feedback on other people's launches (stack, onboarding, positioning) | Low |
| 5 | r/EntrepreneurRideAlong | 737k, +18.7%/yr (GummySearch) | not measured | Factory, MiroHedge story | "Not a place to promote your business". Talking about your business is fine if it adds a lot of value. Mods are cracking down (search excerpt of the rules-update post). | Honest stories of in-progress struggles; replies that add a lesson | Med |
| 6 | r/microsaas | 223k, +79.5%/yr (GummySearch) | not measured | Factory | Rules not found; treat as the 10% rule | Payments, distribution, small-tool pricing | Low-Med |
| 7 | r/buildinpublic | 127k, +307%/yr (GummySearch) | not measured | All | Made for sharing your journey | Reply with your own comparable metric or failure | Low |
| 8 | r/ycombinator | 208k, +38.8%/yr (GummySearch) | not measured | Founder expertise | Rules not found | Answers on applications, cofounders and technical depth from an acquired founder | Med |
| 9 | r/indianstartups | 137k, +65%/yr (GummySearch, 2026-10-15) | not measured | All; Bengaluru angle | Self-promotion is a top theme there (GummySearch) | India-specific advice: Razorpay, payment gateways, hiring, the Bengaluru market | Low-Med |
| 10 | r/Startup_Ideas | 350k, +80%/yr (GummySearch) | not measured | Founder expertise | Rules not found | Pressure-test other people's ideas: who pays, distribution, technical feasibility | Low |
| 11 | r/roastmystartup | 36k, +77%/yr (GummySearch) | not measured | Founder expertise | Built for candid critique | Sharp, kind roasts of landing pages and positioning | Low |
| 12 | r/smallbusiness | 2.6M, +13.7%/yr (GummySearch, 2026-10-27) | 320k weekly visitors (saascity) | **Factory buyers** | **No promotion in posts.** A weekly **"Promote your business"** thread is the only promo place (search excerpts of the thread). Success-story and how-to posts are banned too. | Answer "how do I do social or video marketing cheaply" with method only, no tool names | Med |

### B. CosLynx Content Factory: brand, creator, marketing

| # | Subreddit | Members (source) | Activity | Rules that matter | Best comment angle | Risk |
|---|---|---|---|---|---|---|
| 13 | r/socialmedia | 2.1M, +2.8%/yr (GummySearch, 2026-10-27) | not measured | Exact rules not found; tool talk is common (search excerpt) | Diagnose why a brand's reels stall: hook in the first second, one idea per reel, retention | Med |
| 14 | r/InstagramMarketing | 392k, +39.7%/yr (GummySearch) | not measured | Rules not found; posts are mostly reels performance and follower growth (GummySearch) | Specific reels craft: hook, pacing, captions as key words rather than a transcript, posting cadence | Med |
| 15 | r/content_marketing | 206k, +28.7%/yr (GummySearch) | not measured | Rules against spam; peer feedback is preferred over promo (GummySearch) | "Is AI killing content?" threads: argue for researched, sourced content over slop, from experience | Med |
| 16 | r/DigitalMarketing | 475k, +53%/yr (GummySearch) | not measured | Self-promotion is a top theme there, and the rules were not found. Sister sub r/digital_marketing bans solicitation and AI-tool promo (search excerpt). | Short-form strategy for small brands; cost of making video in-house vs an agency | Med-High |
| 17 | r/NewTubers | 736k, +24.6%/yr (GummySearch) | not measured | **No self-promotion or content links.** Feedback threads require reviewing 2 videos before posting your own; posting without giving feedback leads to removal or a ban (search excerpts). | Detailed Shorts feedback in feedback threads: pacing, hook, audio, thumbnail | Med-High |
| 18 | r/youtubers | 349k, +13.7%/yr (GummySearch) | not measured | Rules not found | Shorts and faceless-channel craft answers | Med |

### C. MiroHedge: investing, quant, fintech

| # | Subreddit | Members (source) | Activity | Rules that matter | Best comment angle | Risk |
|---|---|---|---|---|---|---|
| 19 | r/algotrading | 1.9M, +4.7%/yr (GummySearch, 2026-10-28) | not measured | **For-profit products: "Don't."** Strict, with bans. Open-source and non-profit projects may post: text post, one GitHub link, overview plus tutorial, no project-page links in post or comments. Weekly Discussion Thread. (Search excerpt of the r/algotrading wiki.) | Backtest hygiene: pre-registration, deflated Sharpe, realistic costs, overfitting. hypothesis-arena qualifies as open source **only if it stays non-commercial in the post.** | Med-High |
| 20 | r/quant | 209k, +29.6%/yr (GummySearch, 2026-10-19) | not measured | Rules not found; mostly professionals (jobs, interviews) | Methodology only: multiple-testing correction, slow news diffusion between linked firms with citations. Never retail-AI hype. | High |
| 21 | r/fintech | 98k, +92.7%/yr (GummySearch, 2026-10-25) | not measured | Restricted; must be relevant to the conversation (redship.io) | Payments ops (PayScope and Razorpay experience), AI in regulated finance | Med |
| 22 | r/IndiaInvestments | 961k, +5.3%/yr (GummySearch, 2026-10-22) | not measured | **"No self promotion", strictly enforced.** Your own tools are allowed only as a top-level comment in recurring promo threads, with a summary, and you must answer questions (search excerpt). | Plain-language answers on risk and backtesting claims. Never product mentions outside the promo thread. | High |

### D. AI, LLM, devtools (ai-resources, pipeline, agent-flow)

| # | Subreddit | Members (source) | Activity | Rules that matter | Best comment angle | Risk |
|---|---|---|---|---|---|---|
| 23 | r/ClaudeAI | 1.2M, +246%/yr (GummySearch, 2026-10-28) | 1.67M weekly visitors (saascity) | Showcases must follow Rule 7. **A showcase post on the main feed needs total karma of 50 or more**; below that you go to the "Built with Claude" megathread (mod comment, Apr 2026, via search excerpt). | Real Claude Code workflow details: long agent runs, judges, effort settings, cost control | Low-Med |
| 24 | r/ClaudeCode | 471k, +1099%/yr (GummySearch, 2026-10-20) | not measured | Rules not found; self-promotion of Claude projects is a top theme (GummySearch) | Unattended-agent guardrails (agent-flow's area): protected paths, review and QA loops | Low-Med |
| 25 | r/AI_Agents | 472k, +110%/yr (GummySearch) | not measured | Projects go in the **"Weekly Thread: Project Display"**, which feeds monthly demo days (search excerpts, luma.com) | Production lessons: tracing, policy gates, tamper-evident logs, evals | Low-Med |
| 26 | r/LLMDevs | 178k, +53.5%/yr (GummySearch) | not measured | **Free open-source projects may be shared without approval.** Non-free licences need prior mod approval. Commercial promo is banned. Disguised ads are a bannable offence. (Search excerpt of the mod post.) | Grounding: rejecting numbers or names not in the source, which is what ai-resources-pipeline does. The repo is shareable. | Low |
| 27 | r/LocalLLaMA | 861k, +55.6%/yr (GummySearch) | not measured | **Limit self-promotion: the 1/10 rule (Rule 4)** (search excerpt of the r/LocalLLaMA wiki) | Local TTS (Kokoro fallback), GPU traps (Vulkan/iGPU), local model benchmarks | Med |
| 28 | r/developersIndia | 1.6M, +12.6%/yr (GummySearch, 2026-10-26) | not measured | Promo is heavily restricted. "I Made This" flair is for open-source and code projects; a monthly **"Showcase Sunday"** megathread exists. No YouTube channels or for-profit services. (Mod post, via search excerpt.) | Career and engineering answers from a Bengaluru founder; share repos only under I Made This | Med |
| 29 | r/AgentsOfAI | 132k, +84%/yr (GummySearch, 2026-10-27) | not measured | Rules not found | Agent deployment pain points | Med |

**Weekly or recurring promo threads:** r/startups (Share Your Startup), r/smallbusiness (Promote your business, weekly), r/AI_Agents (Project Display, weekly), r/developersIndia (Showcase Sunday, monthly), r/IndiaInvestments (recurring promo-content thread), r/ClaudeAI ("Built with Claude" megathread), r/SaaS (Feedback Friday or Saturday), r/algotrading (Weekly Discussion, no promo). These threads are the only places a product link belongs, and only when posted by hand.

## 3. Avoid (big but hostile to promo, AI content or automation)

| Subreddit | Members (GummySearch) | Why |
|---|---|---|
| r/Entrepreneur | 5.3M | **AI-generated posts or comments can mean a permanent ban** (rule text, via search excerpt). Promo only in "Thank You Thursday". An LLM commenter is exactly what this rule targets. Manual comments only, if at all. |
| r/opensource | 394k | Since **2026-10-26** it bans AI-assisted, AI-generated and AI-focused projects, and requires the posting account to be at least a year old (winbuzzer.com, 2026-10-27). Every Drix10 repo is AI-related. |
| r/marketing | 2.0M | Actively punishes self-promotion (search excerpt); mostly practitioners venting. Too risky for an automated account. |
| r/investing | 3.5M | Large, strict, retail. An AI-fund founder will read as a shill. |
| r/wallstreetbets | 20.4M | Hostile culture; no value in it for MiroHedge. |
| r/MachineLearning | 3.1M | Research-grade, strict about self-promotion; easy to look shallow there. |
| r/programming | 6.9M | Reported to have banned LLM discussion (dev.to post title, 2026). |
| r/VideoEditing | 532k | Editors are hostile to "automated editing" tools; Factory is a direct threat to them. |
| r/SEO, r/freelance | not fetched | Tool mentions removed; no self-promotion, no "hire me" (redship.io). |

## 4. Rules for an automated commenter (most important section)

### Reddit platform rules (2025-2026) change the design

1. **Data API access is approval-only.** Since **2025-11-11**, under the Responsible Builder Policy, new OAuth credentials need a reviewed request (target turnaround about 7 days). Mining Reddit data to train AI models is banned. (redditapis.com summary of support.reddithelp.com/…/42728983564564, policy updated 2026-06-05. The primary page returned 403 to WebFetch.)
2. **Automated accounts carry an [App] label** (since 2026-03-31). App accounts must be used only for app functions: "no mixed use accounts" (same source). Reddit also announced human verification (passkeys, Face ID) for accounts that look automated, and says it removes about **100,000 unauthorised bot accounts a day** (Huffman announcement 2026-03-25, via ainewspapertoday.pages.dev and ppc.land).
3. **Never lie about your User-Agent.** The required format is `<platform>:<app_id>:<version> (by /u/username)`. Free tier: 100 queries per minute per OAuth client (Data API Wiki, via redditapis.com).
4. **Banned outright:** automated spam comments, identical or near-identical content across subreddits, vote manipulation, ban evasion (same source).

**What this means for the pipeline:** posting LLM-written comments from Drishtant's personal account through browser automation, the way the LinkedIn and X stages do, is exactly what the 2026 crackdown targets. Undisclosed automation on a personal account risks a sitewide suspension and human verification. Two compliant designs:
- **(Recommended) Draft-and-approve:** the pipeline finds threads and drafts comments into a review queue. The owner reads, edits and posts each one himself. No Reddit automation, no API approval needed, and it is safe under both the platform rules and r/Entrepreneur-style AI bans.
- **Approved app account:** a separate account labelled [App], registered and approved, with an honest User-Agent. But an [App]-labelled account commenting "as a founder" is unlikely to be welcome in most subreddits above, which defeats the purpose.

### Account and behaviour rules

- **Warm-up:** 2-4 weeks and 30+ substantive comments in a subreddit before any product mention (redship.io). Spread activity across unrelated subs too, and vary posting times (indiehackers.com, 2026).
- **Karma before links:** about 40-50 karma unlocks most subs (secondary sources). r/ClaudeAI needs 50+ for a showcase on the main feed. r/startups is reported to need 30 days of account age.
- **No links in comments by default.** Name a product only when someone asks, always disclose ("I built X"), and only where the rules allow (r/SaaS counts comment plugs against its once-per-60-days limit).
- **Rate:** at most 1-2 comments per subreddit per day and at most about 10 per day sitewide (my estimate, not a published Reddit number). Never the same text twice, and never several subs inside one short window (redship.io).
- **The 90/10 rule:** about 90% plain participation, at most 10% mentioning your own work. Some subs are stricter, near 99/1 (redship.io).
- **Shadowban and spam-filter signals:** comments that get no votes or replies; comments missing when viewed logged out; a high share of promotion; several links across subs in a short time; low karma with promo-only history (redship.io). Escalation runs: removal, then sub shadowban, then sitewide shadowban, then permanent sub ban, then suspension (redship.io).
- **AI-content policies:** subreddits with explicit AI rules more than doubled in a year (a 2025 study, via search excerpt). Known hard lines: r/Entrepreneur (permanent ban), r/opensource (AI projects), r/golang (disclosure required). Every comment must read as first-hand experience, with no LLM tells.
- **Reddit Answers:** Reddit's AI search went to all logged-in users on 2026-05-05 and cites about 4.2 threads per answer (redship.io/learn/what-is-reddit-answers, via search excerpt). Upvoted, specific, human comments get surfaced to everyone, and so do negative brand mentions. This is the strongest reason to post fewer, better comments.

## 5. Top 5 risks

1. **The automation itself breaks Reddit policy.** Undisclosed automated comments on a personal account conflict with the 2026 [App]-label and "no mixed use" rules and can trigger human verification or a sitewide suspension of Drishtant's real account. Use draft-and-approve.
2. **AI-content bans:** r/Entrepreneur bans permanently for AI-written comments; r/opensource now bans AI projects. Detected LLM style means a ban, not just a removal.
3. **Promo counted in comments:** r/SaaS (once per 60 days, comments included), r/algotrading ("Don't" for for-profit products) and r/IndiaInvestments (strict) remove or ban for a single plug.
4. **Unverified rules:** every rule here is secondary; Reddit could not be read directly. Re-read `/about/rules` through approved access, or by hand, before the first comment in each subreddit.
5. **Finance compliance tone:** MiroHedge is paper trading only. Any comment that implies returns or investment advice in investing subs is both a ban risk and a regulatory risk (SEBI in India). Keep to methodology.

## Sources (fetched 2026-10-29)

- Products: coslynx.com, mirohedge.com (WebFetch); api.github.com/users/Drix10/repos; factory/README.md (local)
- Member counts: gummysearch.com/r/<name>/ for every subreddit in the tables
- Weekly visitors and rule summaries: saascity.io/blog/best-subreddits-promote-startup-2026 (2026-09-23); dupple.com/learn/best-subreddits-to-promote-saas; redship.io/blog/reddit-self-promotion-rules-2026; notifier.so/the-best-subreddits-on-reddit-to-share-your-startup/
- Platform: redditapis.com/blogs/reddit-bot-rules-2026 (cites support.reddithelp.com Responsible Builder Policy and Data API Wiki); ainewspapertoday.pages.dev/issues/reddit-bot-labeling-human-verification-policy; ppc.land/reddit-bots-threaten-ad-quality-heres-how-the-platform-fights-back/
- r/opensource: winbuzzer.com/2026/10/27/reddits-open-source-forum-bans-ai-assisted-projects-xcxwbn/
- Per-subreddit rule excerpts came from WebSearch results that quote sidebar, wiki and mod posts (r/Entrepreneur, r/smallbusiness, r/ClaudeAI, r/LocalLLaMA, r/algotrading, r/NewTubers, r/AI_Agents, r/developersIndia, r/IndiaInvestments, r/EntrepreneurRideAlong, r/LLMDevs, r/SaaS)
