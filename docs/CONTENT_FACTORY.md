# Instagram content factory

The factory turns the articles this pipeline already writes into Instagram reels and carousels. Each reel is a one-off film built in code by Opus 5.5, running through your local Claude Code. It is off until you set `FACTORY_ENABLED=true`, and nothing is posted until you set `IG_POST=true`.

## How a piece is made

```mermaid
flowchart TD
    A["End of a pipeline run: articles, LinkedIn, blog sync done (cron.js)"] --> B["Fresh sources: this run's digest items + Insights added in the last 36 h (archive only as fallback)"]
    B --> C["Novelty filter: drop topics already made"]
    C --> P["Editor: Opus picks the ONE story with the most concrete, showable idea"]
    P --> R["Deep dive: read every page the story links to (research) + screenshot them (real material)"]
    R --> D["Storyboard: Opus via local claude -p writes JSON (copy, beats, caption), knowing the screenshots"]
    D --> E{"Code gates: facts, numbers, lengths, hype words, emoji"}
    E -- "rejected (once)" --> D
    E --> G{"Format"}
    G -- reel --> H["Agent film: Claude Code (Opus 5.5, effort xhigh) studies the full reference library, builds a one-off film in Remotion or HyperFrames mixing designed motion with the real screenshots, checks its own stills, renders"]
    G -- carousel --> I["Remotion slide templates (incl. a real-screenshot slide) + vision QA (Opus reads the stills, one fix round)"]
    H --> J["Synthesized soundtrack from the film's cue file, muxed with ffmpeg"]
    I --> K["Ledger: factory/state/queue.json"]
    J --> K
    K --> L["Instagram publisher (Selenium on Chrome :9222): cap, spacing, dry run by default"]
```

This follows the same order as the motion galleries (motionpromptgallery.com, prompt-motion.com) and the two reference repos (`Leonxlnx/claude-launchvideo`, `mexicat/pdoom-video`): a text beat sheet first, then a code-rendered film, then still checks and fixes, then the render. Like them, there are no image models: every word is drawn in code, so there is no garbled AI lettering and no image bill. The pictures that are not code are **real**: screenshots of the pages the story links to (the repo, the docs, the blog post) and the share images those pages publish.

## What gets made, and from what

At the end of each pipeline run (after the articles, LinkedIn and the blog sync), the factory:

1. **Collects fresh material**: the digest items this run committed, plus any LinkedIn Insight added in the last 36 hours. The Insights archive is used only when the run produced nothing new.
2. **Lets an editor pick one story** (`src/factory/editor.js`): Opus reads a shortlist and picks the one with the most concrete, surprising, showable idea, ideally with a real page behind it. `FACTORY_PER_CYCLE` (default 1) is the number of stories per run.
3. **Deep-dives it**: every page the story links to is read with the pipeline's safe page fetcher (public hosts only) and appended as RESEARCH. The storyboard gets more to work with, and the fact gate accepts what those pages say, so numbers from a linked README are fair game while invented ones are still rejected.
4. **Captures real material** (`src/factory/assets.js`): for each linked page, a desktop shot, a 900-wide close-up "card" whose text reads at phone size, a full-length mobile page to scroll through, and the page's og:image. It runs in Remotion's own headless Chrome over the DevTools protocol; every request is checked, and private or local hosts are refused, redirects included. `FACTORY_ASSET_PAGES` (default 4, 0 = off) caps the pages.
5. **Makes every format in `FACTORY_FORMATS`** (default `reel`) from that one story. The agent gets the captures under REAL MATERIAL and a tool (`node src/factory/shot.js <url> out/x.jpg [--mobile]`) to capture more, limited to the hosts the story links to. Carousels can use a `shot` slide: a real card capture in a drawn browser frame.

## Where things run

| Step | Runs on | Needs |
| --- | --- | --- |
| Storyboard, vision QA, agent films | Your machine (the one that runs `npm start`), via `claude -p` | Claude Code installed and signed in with your Claude plan. **No Anthropic API key.** |
| Rendering | Your machine: Remotion (`factory/node_modules`), headless Chromium, ffmpeg | `npm run factory:install`, ffmpeg on PATH |
| Screenshots | Remotion's headless Chrome (already downloaded by `factory:sample`) | nothing extra |
| Posting | The Chrome on `:9222` that the X and LinkedIn services already use | Log in to instagram.com once in that window |

Opus runs with `--model claude-opus-5-5 --effort xhigh` ("extra" effort). Change these with `FACTORY_OPUS_MODEL` and `FACTORY_CLAUDE_EFFORT`. If the pipeline has to run on a server without Claude Code, set `FACTORY_OPUS_BACKEND=anthropic` or `=openrouter` to use an API key instead.

## Every reel is unique

- **New topic.** Each source gets a TF-IDF signature (the title weighted ×4, plus the body), compared against the recent pieces and the rest of the pool. A cosine of 0.28 or more counts as the same topic. On the current LinkedIn Insights this collapses 24 posts into 15–16 distinct topics. For example, the three struct-padding posts become one, and so do the two webhook-HMAC posts. Once a topic has been made, its near-duplicates are skipped from then on.
- **New look.** Every agent film writes `out/look.json` describing its visual idea, palette, fonts, technique and engine. The next agent receives the last `FACTORY_NOVELTY_WINDOW` (15) looks under "do not reuse". The brand only fixes the end lockup (author + handle) and the legibility rules. Everything else is chosen per film. The house fonts and palette are offered as optional defaults, not as the look.
- **New structure.** The storyboard writer also sees recent hooks and pattern ids, and is told to use a different hook shape and structure.
- **Engines.** `FACTORY_HERO_ENGINE=auto` alternates between Remotion and HyperFrames from film to film.
- **No templated fallback.** By default, a failed agent film is marked failed and retried next cycle rather than replaced by a template (`FACTORY_TEMPLATE_FALLBACK=false`). Each source gets two attempts, and if the picked story fails the cycle moves to the editor's next choice, at most twice, so it can't burn through your plan.

Carousels (4:5 still posts) use the Remotion slide templates, with a theme picked per piece.

## Skills the agent can use

Install these into your local Claude Code. The agent is told to invoke whatever is listed in `FACTORY_HERO_SKILLS`.

```bash
# Remotion (official)
claude plugin marketplace add remotion-dev/claude-code-plugin
claude plugin install remotion@remotion
# HyperFrames (HeyGen): HTML + GSAP -> MP4, listed in the official directory
claude plugin install hyperframes@claude-plugins-official
```

The Remotion plugin clones over SSH. Without a GitHub SSH key, run the install once over HTTPS
(this does not change your git config):

```bash
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=git@github.com: claude plugin install remotion@remotion
```

Plugin skills are namespaced `/<plugin>:<skill>`. HyperFrames also ships `motion-graphics`.

```env
FACTORY_HERO_SKILLS=/remotion:remotion-best-practices,/hyperframes:motion-graphics
FACTORY_HERO_ENGINE=auto
```

The agent can only use file tools plus `npx remotion`, `npx hyperframes`, `npx tsc`, `npm install --ignore-scripts`, `ffmpeg`, `ffprobe`, `node shot.cjs` (the screenshot tool, nothing else), `ls`, `mkdir` and `cp`. It works in a per-piece workspace under `factory/state/jobs/<job>/agent-<engine>/`, never in the repo itself.

This is not a sandbox: `ffmpeg` and `cp` can still reach any path your account can. What it rules out is running arbitrary code if third-party text in its prompt (articles, linked pages, scraped gallery prompts) tries to steer it: no bare `node`, no npm install scripts. The reference library is read-only for the agent: it is snapshotted with git before each film, and anything the agent changed is restored afterwards.

## Failure handling and posting safety

- **One factory at a time.** `factory/state/factory.lock` (owner pid) is held by a cycle, a `--source` run and `--publish`; a second one is skipped with a log line. A lock whose process is gone, or older than 3 h, is taken over.
- **No double posts.** An item is marked `sharing` *before* the Share click. If Instagram does not confirm, it becomes `unconfirmed`: check your profile, because it is never posted again automatically. Both count toward `IG_DAILY_CAP` and `IG_MIN_GAP_MINUTES`. A posted (or possibly posted) item is never replaced, even by `--source --force`.
- **No stuck queue.** The next item to post is the one with the fewest failed attempts, then the oldest, and only if its files still exist. After 3 failed publishes it becomes `publish_failed`.
- **The ledger is never silently reset.** A missing `queue.json` is empty; a locked one is retried; an unreadable one stops the factory and is copied to `queue.json.corrupt-<time>`.
- **Time-boxed everything.** The agent (`FACTORY_HERO_TIMEOUT_MS`, and on timeout its whole process tree is killed), every DevTools call and capture, ffmpeg, and the soundtrack (cue values are clamped).
- **Screenshots cannot reach your network.** Chrome sends all traffic through an in-process proxy that resolves every host itself and refuses private, local and LAN addresses and any port but 80/443; Chrome is driven over a pipe (no debugging port) and exits with the factory.
- **The film is the proof.** A film counts as done when `out/hero.muted.mp4` exists and is a readable 5-180 s video; its real length, not the agent's cue file, sets the soundtrack length.

## Fact safety

Opus designs the motion, but it cannot change what the piece claims.

1. The storyboard is the only place where on-screen words are decided, and `storyboard.js#validate` checks them against the source article:
   - every number above 10 that appears on screen or in the caption must be in the article (code blocks are exempt);
   - quotes must be verbatim from the article;
   - numbers are checked as drawn (a stat's prefix + value + suffix), with units glued or spaced ("40s", "5000qps", "8 GB"), decimals, magnitude words ("a million") and hashtags; only bare whole numbers 0-10 are free;
   - research text from linked pages counts as a source, but its URLs and page headers do not;
   - the pipeline's `BANNED_WORDS` list (shared with `llm.js`) is rejected in any inflection ("unlocks", "game changer"), unless the author's own text used the word (research text does not excuse it);
   - every field must have the right type (a malformed reply goes back to Opus, it never crashes the cycle);
   - emojis are not allowed on screen;
   - every Instagram-safe length limit is enforced.
2. The agent receives that wording as **FIXED WORDING**. It may split lines across beats or drop at most one line, but it may not add claims.
3. The soundtrack is synthesized by `src/factory/soundtrack.js` from the film's cue times: kick, hats, bass, pad, riser and impacts at 120 bpm in A minor, mastered at roughly −13 LUFS. It is original audio, so there is nothing to clear.

## Files

```
factory/                      Remotion package (own package.json, like blog/)
  src/schema.ts               storyboard contract (scenes, slides)
  src/brand.ts                tokens from blogs.drix10.com, Instagram safe zones
  src/Reel.tsx, Carousel.tsx  9:16 reel and 4:5 slide compositions
  src/scenes/ReelScenes.tsx   hook, statement, code, stat, list, compare, quote, cta
  library/patterns.json       storyboard patterns (myth-number, versus, teardown, ...)
  library/videos/<slug>/      reference library: meta.json + prompt.md (+ contact.jpg, video.mp4, src/)
  library/repos/              shallow clones of every linked repo (gitignored; npm run factory:library)
  fixtures/struct-padding.json  sample storyboard (studio default, tests)
src/factory/
  index.js       orchestrator: produce(), runCycle(), publishDue()
  storyboard.js  Opus director + code gates
  hero.js        Claude Code agent films (Remotion / HyperFrames)
  library.js     reference library: catalog, closest prompts, repo sync
  render.js      Remotion renders, contact sheets, ffmpeg mux
  qa.js          Opus vision check on rendered stills
  novelty.js     topic dedupe + look memory
  sources.js     LinkedIn Insights + digest items -> sources
  opus.js        claude -p client (API fallbacks optional)
  soundtrack.js  beat-locked synth
  instagram.js   Selenium publisher
  queue.js       ledger at factory/state/queue.json
factory-run.js   CLI
```

## Reference library

`factory/library/videos/<slug>/` holds every film from motionpromptgallery.com (`mpg-*`), prompt-motion.com (`pm-*`) and the two reference repos, plus anything you add:

- `meta.json`: `title`, `source`, `url`, `model`, `engine`, `formats`, `tags`, `score` (1–5), `why` (the reusable craft idea) and optional `repo`.
- `prompt.md`: the full prompt (or, for repo entries, the README and treatment docs) verbatim.
- `contact.jpg`: nine frames across the film, so the agent can see it.
- `video.mp4` (gitignored) and `src/` (optional).

Every agent film gets the **whole** library: a catalog line per entry with the paths to its prompt, frames, video and code, the full text of the 3 entries whose tags best match the article, and read access to `factory/library/` (including `repos/`). It must open at least 3 more entries before designing and name the ones it drew on in `treatment.md`. The `why` lines of the best matches also go into the storyboard prompt. `npm run factory:library` clones or updates every repo an entry links to (`factory:install` runs it too). See `factory/library/videos/README.md`.

## Run it

```bash
npm run factory:install                 # once: Remotion into factory/node_modules + clone the library repos
npm i -g @anthropic-ai/claude-code && claude   # once: sign in with your Claude plan
npm run factory:sample                  # render the bundled sample reel + carousel (no keys, no Claude)
node factory-run.js --list              # candidate sources, best first
node factory-run.js --source "LinkedIn Insights/<file>.md" --format reel   # one piece now
node factory-run.js --queue             # ledger
node factory-run.js --publish --dry     # walk Instagram's upload flow, stop before Share, discard
npm run factory:studio                  # Remotion Studio for the templates
```

With `FACTORY_ENABLED=true`, `npm start` runs a factory pass at the end of every cycle, after the blog sync. It makes up to `FACTORY_PER_CYCLE` pieces and posts at most one, within `IG_DAILY_CAP` and `IG_MIN_GAP_MINUTES`. Review a piece by opening its job folder, which contains `reel.mp4` or `slide-*.jpg`, `contact.jpg`, `caption.txt`, `storyboard.json`, `treatment.md` and `look.json`.

## Before going live

1. Run one real piece with `--source` and watch the agent log (`agent.log` in the job folder). Expect roughly 15–40 minutes per film at `xhigh`, depending on the machine. This is untested.
2. Run `--publish --dry` with Instagram logged in on `:9222`, and check the `dry-run-ready` screenshot in `factory/state/ig-debug/`. Instagram's web UI changes, so all selectors are kept in `SEL` at the top of `instagram.js`. As of October 2026: Create opens a "Post" link in the sidebar, uploads open at a square crop (the publisher switches to Original, so reels stay 9:16 and slides 4:5), and the caption is typed as keystrokes so its paragraph breaks survive. Every failed step saves a screenshot to `factory/state/ig-debug/`.
3. Then set `IG_POST=true`.

Browser automation on Instagram is against its terms of use and can get the account limited. The daily cap, spacing and dry-run default reduce the risk but do not remove it. The official Content Publishing API (Business/Creator account) is the safer path if that ever becomes an option.
