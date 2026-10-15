/**
 * feedEngage.js
 *
 * Fully automated LinkedIn growth, called from cron.js in step with the content loop:
 *  1. runLikePass       (LINKEDIN_LIKE, default on): 3-6 likes after each article is written
 *  2. runFeedEngagement (LINKEDIN_FEED_REPLY=true): 2 or 3 comments after each batch commit
 *  3. runViralPass      (LINKEDIN_VIRAL, default on, needs LINKEDIN_FEED_REPLY=true): 1 or 2 extra
 *     comments after each batch commit on posts going viral (big names in config/viral.js, the
 *     day's most-engaged launches and funding news), early in their rise, written against the
 *     comments already there (llm.draftViralComment), on their own daily cap
 *  4. runConnectPass    (LINKEDIN_CONNECT, default on): 3-7 no-note invites after each batch commit
 *
 * Posts come from targeted sources (the recent posts of people who engaged with us, optional
 * creator profiles in config/creators.json, and AI/founder/finance content search), not the home feed. The
 * home feed is only the fallback when targeted sources yield nothing, or the whole thing when
 * LINKEDIN_SOURCE=feed.
 *
 * Reciprocity: the like and comment passes read the notifications page (at most every 3 h) and
 * engage the people who engaged with us first: like back, follow back, comment on their posts.
 *
 * Safety: every pass first checks the circuit breaker (signed out, checkpoint/limit
 * cooldowns persisted in the tracker) and runs under a 15 min
 * timeout. Sensitive posts (grief, layoffs, war, politics) get no like, follow or comment.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("../../config");
const llmService = require("./llm");
const linkedinService = require("./linkedin");
const LinkedInService = new linkedinService();
const { logger, sleep, isEnglish, REPO_ROOT } = require("../utils/helpers");

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const envInt = (name, def) => {
  const n = parseInt(process.env[name], 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const jitter = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const nowIso = () => new Date().toISOString();

// The tracker path is read per call so tests can point LINKEDIN_TRACK_PATH at a temp dir.
const trackPath = () => process.env.LINKEDIN_TRACK_PATH || path.join(REPO_ROOT, "data", "linkedin-feed-commented.json");
const MAX_PER_DAY = envInt("LINKEDIN_COMMENTS_MAX_PER_DAY", 20); // regular comments, rolling 24 h (viral ones have their own cap)
const REJECT_TTL_MS = 3 * DAY; // drafts our own gates rejected: the post is fine, retry after 3 days
const SKIP_TTL_MS = 30 * DAY; // LLM SKIPs, sensitive and thin posts: the post itself is the problem
const PRUNE_MS = 30 * DAY;
const CONN_PRUNE_MS = 90 * DAY; // invite history: well past the weekly cap, then dropped
const LIKES_MAX_PER_DAY = envInt("LINKEDIN_LIKES_MAX_PER_DAY", 60);
const FOLLOW_MAX_PER_DAY = 5;
const AUTHOR_COMMENT_GAP_MS = 7 * DAY; // at most 1 comment per author per week
const AUTHOR_LIKE_GAP_MS = DAY; // at most 1 like per author per day
const PASS_TIMEOUT_MS = envInt("LINKEDIN_PASS_TIMEOUT_MS", 15 * 60 * 1000);
const SEARCH_LOADS_PER_PASS = 8;
const SEARCH_LOADS_PER_DAY = 40;

// ---- Audience targeting: US-based people in AI and tech (builders, founders, engineers) first, and
// in finance and investing ----
// Every feed card gets a score; likes, follows and comments only go to posts that clear these
// bars, so the feed algorithm learns this audience and our comments land in front of it. Past the
// topic, the score favours posts where a comment is read and answered: early, with room left at
// the top of its comments, by a mid-size author rather than a celebrity, in our network.
const LIKE_MIN = 3;
const COMMENT_MIN = 4;
const FOLLOW_MIN = 7;
// AI/tech is the priority audience (2 pts per distinct term, up to 3 terms); finance is the second
// (1 pt per term, up to 3), so an AI post clears the bars on its own while a finance-only post needs
// to be on-topic, fresh or US-relevant. A post with neither scores 0: off-topic posts by strangers get
// no like, follow or comment however fresh they are.
const FIN_RE = /\b(fintech|finance|financial|banks?|banking|investment banking|payments?|cfo|investors?|investing|investment|investments|venture|vcs?|private equity|hedge funds?|asset management|wealth|portfolio|equity|equities|markets?|stocks?|trading|traders?|earnings|valuation|ipo|m&a|buyouts?|fed|federal reserve|rates|yields?|treasury|bonds?|credit|inflation|recession|gdp|cpi|macro|economy|economic|etfs?|capital|funding|fundraising|seed|series [a-d]|family office|real estate|reits?|commodities|derivatives|options|hedging|liquidity|dealmaking|wall street|nasdaq|s&p)\b/gi;
const TECH_RE = /\b(ai|artificial intelligence|machine learning|ml|llms?|gpt|agents?|agentic|openai|anthropic|claude|gemini|genai|generative|deep learning|neural|inference|fine.?tun\w*|evals?|nvidia|copilot|chatgpt|software|engineering|engineers?|developers?|devtools?|devops|cloud|aws|kubernetes|infrastructure|open.?source|github|apis?|sdks?|saas|startups?|founders?|co-?founders?|indie hackers?|product managers?|cto|cybersecurity|backend|frontend|programming|coding|data scien\w*|semiconductors?|robotics|tech)\b/gi;
// Header signals (post.head: name, degree, headline): 1st/2nd-degree authors see and return our
// engagement far more often; recruiter accounts post jobs, not conversations.
const NETWORK_RE = /•\s*(?:1st|2nd)\b/i;
const RECRUITER_RE = /\b(recruit\w*|talent acquisition|headhunt\w*|staffing|sourcer)\b/i;
const US_RE = /\b(united states|usa|u\.s\.a?|us-based|new york|nyc|manhattan|san francisco|bay area|silicon valley|palo alto|menlo park|austin|seattle|boston|chicago|los angeles|miami|denver|atlanta|dallas|houston|california|texas|washington,? dc|wall street|nasdaq|nyse|s&p|federal reserve|congress)\b|\$\d/i;
// Comment-bait ("Comment AGENT and I'll send you the guide", "drop a YES below"): engaging
// with it is exactly what the bait wants, so it is excluded outright, not just penalised.
const BAIT_RE = /\b(comment\s+["“']?\w+["”']?\s+(?:below\s+)?(?:and|&)\s+i(?:'ll|\s+will)|comment\s+["“']?\w+["”']?\s+(?:below\s+)?to\s+(?:get|receive)|(?:drop|leave|type)\s+(?:a\s+)?["“']?\w+["”']?\s+(?:below|in\s+the\s+comments?)|i(?:'ll|\s+will)\s+(?:send|dm|share)\s+(?:it\s+|you\s+)?(?:the|my|a)\s+(?:link|guide|pdf|template|playbook|list|doc)|repost\s+(?:this\s+)?(?:to|for|if))\b/i;
const NOISE_RE = new RegExp(`\\b(giveaway|hiring|we(?:'re| are) hiring|apply now|webinar|register (?:now|here)|dm me|link in bio|open ?to ?work|bootcamp|cohort|enroll|discount code|follow me for)\\b|${BAIT_RE.source}`, "i");
// Grief, illness, layoffs, war, partisan politics, shootings: no like, no follow, no comment.
// A bot reacting to these is worse than silence. Word-bounded; common finance/tech compounds
// ("price war", "talent war") are not wars.
const SENSITIVE_RE = /\b(passed away|passing of|rest in peace|funeral|condolences?|obituary|grieving|mourn(?:ing|s)?|diagnos(?:is|ed)|cancer|chemo(?:therapy)?|hospice|miscarriage|suicide|laid off|layoffs?|lay-?offs?|(?<!(?:trade|price|talent|bidding|pricing|format|browser|console|flame|turf|tariff|chip|currency|streaming|cola|bid)\s)wars?|warfare|gaza|ukraine|israel|palestin\w*|invasion|airstrikes?|hostages?|elections?|ballots?|trump|biden|kamala|democrats?|republicans?|maga|shootings?|gun violence|terror(?:ist|ism)?|massacre|genocide|prayers?|praying)\b/i;
function isSensitivePost(text) {
  const t = String(text || "");
  return SENSITIVE_RE.test(t) || /\bRIP\b/.test(t);
}
function scorePost(post) {
  const hay = `${post.head || ""} ${post.text || ""}`;
  // English only: likes, follows and comments all key off this score.
  if (!isEnglish(hay)) return -99;
  // Sensitive posts get nothing at all (the body only: a headline is not the post).
  if (isSensitivePost(post.text) || BAIT_RE.test(hay)) return -99;
  const distinct = (re) => new Set((hay.match(re) || []).map((m) => m.toLowerCase())).size;
  const topic = 2 * Math.min(distinct(TECH_RE), 3) + Math.min(distinct(FIN_RE), 3);
  // Promo noise and recruiter accounts are marked down whatever the topic, so an off-topic one
  // scores below zero and a warm author's bonus never lifts it to a like.
  const penalty = (NOISE_RE.test(hay) ? 4 : 0) + (RECRUITER_RE.test(post.head || "") ? 3 : 0);
  if (!topic) return penalty ? -penalty : 0;
  let score = topic;
  if (US_RE.test(hay)) score += 2;
  const age = typeof post.ageH === "number" ? post.ageH : 999;
  if (age <= 3) score += 2; else if (age <= 12) score += 1; else if (age > 72) score -= 1;
  // Where a comment is read and answered, for a post squarely on the topic (one term is not
  // enough): room at the top of its comments and a mid-size author (a celebrity's crowd buries a
  // comment; the viral pass is the one that goes there), from counts the card showed (a card
  // whose counts did not parse reads 0 reactions), and an author in our network.
  if (topic >= 2) {
    const reactions = Number(post.reactions) || 0, comments = Number(post.comments) || 0;
    if (reactions > 0) {
      if (comments <= 30) score += 1; else if (comments > 150) score -= 1;
      if (reactions >= 10 && reactions <= 1000) score += 1; else if (reactions > 3000) score -= 1;
    }
    if (NETWORK_RE.test(post.head || "")) score += 1;
  }
  return score - penalty;
}

// ---- Connection requests: US, 2nd-degree target-industry people, no note ----
// No note: LinkedIn allows free accounts only a few personalised notes a month, and a templated
// note reads worse than none. A 2nd-degree request in the same field is what gets accepted.
const CONNECT_FIN_KEYWORDS = [
  "investment banking analyst", "private equity", "venture capital", "portfolio manager",
  "equity research", "hedge fund", "CFO", "wealth management", "asset management",
  "financial analyst", "fintech", "quantitative analyst", "trader", "family office",
  "credit analyst", "M&A", "growth equity", "angel investor", "capital markets",
  "investor relations", "financial advisor", "managing director investments",
];
const CONNECT_TECH_KEYWORDS = [
  "AI engineer", "machine learning engineer", "LLM engineer", "head of AI", "AI researcher",
  "AI product manager", "developer advocate", "AI startup founder", "startup CTO",
  "data scientist", "software engineer", "technical founder",
];
const CONNECT_PER_KEYWORD = 4; // spread each run across many keywords, 2 AI/tech for every 1 finance
const shuffled = (a) => [...a].sort(() => Math.random() - 0.5);
function buildConnectQueries() {
  const fin = shuffled(CONNECT_FIN_KEYWORDS), tech = shuffled(CONNECT_TECH_KEYWORDS);
  const out = [];
  for (let i = 0; fin.length || tech.length; i++) {
    const list = (i % 3 === 2 && fin.length) || !tech.length ? fin : tech;
    if (list.length) out.push(list.shift());
  }
  return out;
}
const CONNECT_ICP_RE = /\b(ai|artificial intelligence|machine learning|ml|llm|data scien|software|engineer|developer|devrel|advocate|maintainer|researcher|builder|automation|cto|founder|co-?founder|startup|tech|cloud|cyber|product|venture|vc|investor|investing|investment|private equity|equity|portfolio|fintech|finance|financial|banking|banker|analyst|quant|trading|trader|cfo|capital|fund|partner|principal|associate|wealth|advisor|asset|hedge|credit|m&a|treasury|economist|managing director|family office|bank|equity)\b/i;
const CONNECT_SKIP_RE = /\b(recruit|recruiter|talent acquisition|staffing|headhunter|open to work|seeking|student|intern|coach|seo|agency|mlm|forex|signals|dropshipping)\b/i;
// The geo filter leaks occasionally; drop anyone whose card names a non-US country.
const CONNECT_NON_US_RE = /\b(india|russia|ukraine|pakistan|united kingdom|england|london|canada|toronto|germany|france|nigeria|brazil|china|singapore|uae|dubai|australia|bangladesh|philippines|indonesia|egypt|turkey|israel|netherlands|spain|italy|poland|mexico|kenya|vietnam)\b/i;
// Under LinkedIn's own weekly invitation limit (about 100 for most accounts; hitting it pauses
// connects 7 days, see runConnectPass). LinkedIn restricts accounts that invite in bulk: env can lower.
const CONNECT_MAX_PER_DAY = envInt("LINKEDIN_CONNECT_MAX_PER_DAY", 15);
const CONNECT_MAX_PER_WEEK = envInt("LINKEDIN_CONNECT_MAX_PER_WEEK", 90);
const CONNECT_KEY = (href) => `conn:${String(href || "").replace(/\/$/, "")}`;

// ---- Targeted post sources ----
// Content-search queries (newest first): two on AI and the people building with it for every one
// where AI meets finance.
const SOURCE_QUERIES = [
  "AI agents", "building with LLMs", "AI engineering", "open source AI", "AI developer tools",
  "AI startup founder", "machine learning in production", "generative AI",
  "AI in finance", "fintech founder", "venture capital AI", "AI startup funding",
];
const searchUrl = (q) => "https://www.linkedin.com/search/results/content/?keywords=" + encodeURIComponent(q) +
  "&datePosted=%22past-week%22&sortBy=%22date_posted%22";
function loadCreators() {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", "creators.json"), "utf8"));
    return (Array.isArray(list) ? list : []).filter((u) => /linkedin\.com\/in\//i.test(u))
      .map((u) => String(u).split("?")[0].replace(/\/$/, "") + "/recent-activity/all/");
  } catch (e) { return []; }
}
// Ordered scan sources for one pass ("like" or "comment"). The people who engaged with us first
// (warmSources), then creators (highest signal), then shuffled searches. "feed" mode, or a targeted
// run that finds nothing, uses home Top/Recent.
function buildSources(track = {}, limit = 6, pass = "like") {
  if (config.social.linkedinSource === "feed") return [{ label: "feed:top", sort: "top" }, { label: "feed:recent", sort: "recent" }];
  const creators = shuffled(loadCreators()).slice(0, 2).map((url) => ({ label: `creator:${url.split("/in/")[1].split("/")[0]}`, url }));
  const searches = shuffled(SOURCE_QUERIES).map((q) => ({ label: `search:${q}`, url: searchUrl(q) }));
  return [...warmSources(track, WARM_SOURCES_PER_PASS, Date.now(), pass), ...creators, ...searches].slice(0, limit);
}
const FALLBACK_SOURCES = [{ label: "feed:top", sort: "top" }, { label: "feed:recent", sort: "recent" }];
const scanSource = (src, maxScrolls = 8) =>
  LinkedInService.scanFeedPosts({ maxPosts: 12, maxScrolls, ...(src.url ? { url: src.url } : { sort: src.sort }) });

// ---- Viral pass: extra comments where the audience is largest ----
// A post by a big name (config/viral.js), or one gathering reactions fast, is read by far more
// people than an ordinary post, and the comments its readers see are the early ones: timing is
// most of it. The pass checks the big names most likely to have posted since it last looked, and
// the day's most-engaged searches; it scores every post on how early it is in its rise (age,
// reactions per hour, room left at the top of its comments); the best one gets a comment written
// against the comments already there (llm.draftViralComment: drafts, gates and a judge), on its
// own daily cap.
const VIRAL = require("../../config/viral");
const VIRAL_MAX_PER_DAY = envInt("LINKEDIN_VIRAL_MAX_PER_DAY", 8); // on top of MAX_PER_DAY
const VIRAL_MIN = 8;
// A post not by a big name needs a crowd already: one of these, or VIRAL_MIN_PER_HOUR reactions an hour.
const VIRAL_MIN_REACTIONS = 150;
const VIRAL_MIN_COMMENTS = 40;
const VIRAL_MIN_PER_HOUR = 50;
// Past these ages a new comment lands below hundreds of others.
const VIRAL_MAX_AGE_H = 24;
const VIP_MAX_AGE_H = 36;
const VIRAL_AUTHOR_GAP_MS = 2 * DAY; // a big name posts often; still not on every post
const VIRAL_SOURCES_PER_PASS = 3;
const VIRAL_LOADS_PER_DAY = 40; // big-name pages and viral searches loaded, rolling 24 h
const VIRAL_RECHECK_MS = 2 * HOUR; // a big name's page is not reloaded sooner
// Each post costs at least two LLM calls (a draft and its judge or critic, minutes each on Claude): the
// viral pass gets twice the usual pass time, and neither pass starts a post, or a pause before one, in the
// stretch the next post would need: twice the slowest draft this pass (at least 2 minutes), or before the
// first, twice the writer's time-out. That stretch is at most half the pass, so a long time-out never empties it.
const VIRAL_PASS_TIMEOUT_MS = 2 * PASS_TIMEOUT_MS;
const RESERVE_MIN_MS = 2 * 60 * 1000;
// What posting the last comment needs after its draft: the LLM calls end this long before the guard.
const SUBMIT_MS = 90 * 1000;
// The time-out of the writer a job's calls reach now (a resting Claude hands its calls to OpenRouter).
function writerTimeoutMs(role) {
  const provider = llmService.providerFor(role);
  if (provider === "claude" && !llmService.claudeResting()) return config.llm.claude.requestTimeoutMs;
  if (provider === "local") return config.llm.requestTimeoutMs;
  if (provider === "nvidia") return config.llm.nvidia.requestTimeoutMs || 240000;
  return config.llm.openrouter.requestTimeoutMs || 120000;
}
const draftReserveMs = (viral, slowestMs = 0) => Math.min((viral ? VIRAL_PASS_TIMEOUT_MS : PASS_TIMEOUT_MS) / 2,
  slowestMs ? Math.max(RESERVE_MIN_MS, 2 * slowestMs) : 2 * writerTimeoutMs(viral ? "viral" : "comment"));
// Launches, funding and big-company news: what makes a post spread.
const NEWS_RE = /\b(raises?|raised|series [a-e]|seed round|funding|funded|unicorn|valuation|launch(?:es|ed|ing)?|announc\w+|acquir\w+|acquisition|ipo|open.?sourc\w+|releas\w+|ships?|shipped|introducing)\b/gi;
const slugOf = (href, kind) => ((String(href || "").match(new RegExp(`/${kind}/([^/?#]+)`, "i")) || [])[1] || "").toLowerCase();
// A big name from config/viral.js: by the card's profile or company link, or by its author name.
function isVip(post) {
  const person = slugOf(post.href, "in"), company = slugOf(post.href, "company");
  const name = String(post.author || "").trim().toLowerCase();
  return (VIRAL.people || []).some((p) => String(p.slug).toLowerCase() === person || String(p.name).toLowerCase() === name)
    || (VIRAL.companies || []).some((c) => String(c.slug).toLowerCase() === company || String(c.name).toLowerCase() === name);
}
// How much a comment there now would be seen: a big name; how early the post is (the first hours
// decide which comments sit on top); its momentum (reactions an hour); its reach so far (log
// scale); the room left at the top of its comments; and whether it is launch, funding or tech news
// this audience follows. VIRAL_MIN+ gets a draft. Sensitive, bait, non-English and stale posts get nothing.
function viralScore(post) {
  const hay = `${post.head || ""} ${post.text || ""}`;
  if (!isEnglish(hay)) return -99;
  if (isSensitivePost(post.text) || BAIT_RE.test(hay)) return -99;
  const vip = isVip(post);
  const age = typeof post.ageH === "number" ? post.ageH : 999;
  if (age > (vip ? VIP_MAX_AGE_H : VIRAL_MAX_AGE_H)) return -99;
  const reactions = Number(post.reactions) || 0, comments = Number(post.comments) || 0;
  const perHour = reactions / Math.max(0.5, age);
  if (!vip && reactions < VIRAL_MIN_REACTIONS && comments < VIRAL_MIN_COMMENTS && perHour < VIRAL_MIN_PER_HOUR) return 0;
  let score = vip ? 5 : 0;
  score += age <= 1 ? 4 : age <= 3 ? 3 : age <= 6 ? 2 : age <= 12 ? 1 : 0;
  score += perHour >= 300 ? 4 : perHour >= 100 ? 3 : perHour >= 30 ? 2 : perHour >= 10 ? 1 : 0;
  if (reactions >= 100) score += Math.min(3, Math.floor(1.5 * Math.log10(reactions) - 2)); // 1K: 2, 10K: 3
  score += comments < 30 ? 2 : comments < 150 ? 1 : comments > 800 ? -2 : 0;
  const distinct = (re) => new Set((hay.match(re) || []).map((m) => m.toLowerCase())).size;
  score += Math.min(distinct(TECH_RE) + distinct(NEWS_RE), 2);
  if (NOISE_RE.test(hay)) score -= 4;
  return score;
}
const viralSearchUrl = (q) => "https://www.linkedin.com/search/results/content/?keywords=" + encodeURIComponent(q) +
  "&datePosted=%22past-24h%22&sortBy=%22relevance%22";
const vipPages = () => [
  ...(VIRAL.people || []).map((p) => ({ label: `vip:${p.slug}`, url: `https://www.linkedin.com/in/${p.slug}/recent-activity/all/` })),
  ...(VIRAL.companies || []).map((c) => ({ label: `vip:${c.slug}`, url: `https://www.linkedin.com/company/${c.slug}/posts/?feedView=all` })),
];
// One pass's sources: the big names most likely to have posted since their page was last read
// (each page's posting rate, learned from its last read, in the tracker's meta.viralPages), then
// a viral search, alternating. A page read under VIRAL_RECHECK_MS ago waits; one never read goes first.
function buildViralSources(track = {}, limit = VIRAL_SOURCES_PER_PASS, now = Date.now()) {
  const seen = ((track && track.meta) || {}).viralPages || {};
  const chance = (src) => {
    const s = seen[src.label];
    const at = Date.parse((s && s.at) || "");
    if (!Number.isFinite(at)) return 2 + Math.random();
    if (now - at < VIRAL_RECHECK_MS) return -1;
    // (a learned 0 is a page that has gone quiet: the floor, not the unknown-page default)
    const learned = s.perDay === null || s.perDay === undefined ? NaN : Number(s.perDay);
    const perDay = Math.max(0.05, Number.isFinite(learned) ? learned : 0.3);
    return 1 - Math.exp(-perDay * (now - at) / DAY) + Math.random() * 0.15; // P(a new post since)
  };
  const pages = vipPages().map((src) => ({ ...src, p: chance(src) })).filter((s) => s.p >= 0)
    .sort((a, b) => b.p - a.p).map(({ p, ...src }) => src);
  const searches = shuffled(VIRAL.searches || []).map((q) => ({ label: `viral:${q}`, url: viralSearchUrl(q) }));
  const out = [];
  while (out.length < limit && (pages.length || searches.length)) {
    if (pages.length) out.push(pages.shift());
    if (out.length < limit && searches.length) out.push(searches.shift());
  }
  return out;
}
// After a big name's page is read: when, and how often it posts (posts in the last 14 days a day).
function noteViralPage(track, label, posts, now = Date.now()) {
  if (!String(label).startsWith("vip:")) return;
  const ages = posts.map((p) => p.ageH).filter((h) => typeof h === "number" && h <= 14 * 24);
  const days = Math.max(1, Math.max(0, ...ages) / 24);
  const pages = ((track.meta || {}).viralPages) || {};
  // No card read at all says nothing about the page (it may not have rendered): the rate stays as it was.
  const perDay = posts.length ? Number((ages.length / days).toFixed(3)) : ((pages[label] || {}).perDay ?? null);
  const viralPages = { ...pages, [label]: { at: new Date(now).toISOString(), perDay } };
  track.meta = { ...(track.meta || {}), viralPages };
}

// ---- Tracker file ----
// Post/person entries plus three meta keys: cooldowns { all, connect } (ISO times until which
// passes stay off), counters { searchLoads: [ISO] } and meta { ownSlug }. A file without
// them loads as-is.
const META_KEYS = new Set(["cooldowns", "counters", "meta"]);
const postEntries = (track) => Object.entries(track).filter(([k]) => !META_KEYS.has(k));

// A tracker that must not be used: every pass returns "linkedin unavailable", saves refuse.
function disabledTracker(reason) {
  const t = {};
  Object.defineProperty(t, "disabled", { value: reason, enumerable: false });
  return t;
}

function parseTrackFile(file) {
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new SyntaxError("tracker is not a JSON object");
  return raw;
}

// Fails closed. Missing file = first run. A corrupt file is moved aside (.corrupt-<ts>) and
// the .bak used; with no usable backup LinkedIn stays off for the run. Never a silent {}:
// that resets every cap and the commented-memory (double comments, cap overruns).
function loadTrack() {
  const file = trackPath();
  try {
    return parseTrackFile(file);
  } catch (e) {
    if (e.code === "ENOENT") {
      try { return parseTrackFile(`${file}.bak`); } catch (bakErr) { /* no usable backup */ }
      // A tracker moved aside earlier and never restored: someone has to look first.
      const dir = path.dirname(file), base = path.basename(file);
      let corrupt = [];
      try { corrupt = fs.readdirSync(dir).filter((f) => f.startsWith(`${base}.corrupt-`)); } catch (dirErr) { /* no dir yet */ }
      if (corrupt.length) {
        logger.error(`feedEngage: tracker missing and ${corrupt[0]} exists - LinkedIn off until it is restored.`);
        return disabledTracker("tracker missing after corruption");
      }
      return {};
    }
    if (!(e instanceof SyntaxError)) {
      // Locked or unreadable (EBUSY/EACCES): the file may be fine, so leave it alone.
      logger.error(`feedEngage: tracker unreadable (${e.code || e.message}) - LinkedIn off for this run.`);
      return disabledTracker(`tracker unreadable (${e.code || "error"})`);
    }
    const aside = `${file}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(file, aside);
      logger.error(`feedEngage: tracker is corrupt (${e.message}); moved to ${path.basename(aside)}.`);
    } catch (mvErr) {
      logger.error(`feedEngage: tracker is corrupt and could not be moved aside: ${mvErr.message}`);
    }
    try {
      const restored = parseTrackFile(`${file}.bak`);
      logger.warn("feedEngage: tracker restored from its .bak copy.");
      return restored;
    } catch (bakErr) {
      logger.error("feedEngage: no usable tracker backup - LinkedIn off for this run.");
      return disabledTracker("tracker corrupt, no backup");
    }
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Durable write: tmp + fsync + rename, retried while Windows holds the target (antivirus,
// indexer, an editor). The target is never deleted first, and the previous version is kept
// as .bak. Returns false when nothing was written.
function saveTrack(track) {
  if (!track || track.disabled) return false;
  const file = trackPath();
  const dir = path.dirname(file);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Sweep orphaned tmp files from crashed runs (crash between write + rename).
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(`${path.basename(file)}.`) && f.endsWith(".tmp")) {
        const fp = path.join(dir, f);
        try { if (Date.now() - fs.statSync(fp).mtimeMs > HOUR) fs.unlinkSync(fp); } catch (e) {}
      }
    }
    const fd = fs.openSync(tmp, "w");
    try {
      fs.writeSync(fd, JSON.stringify(track, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try { fs.copyFileSync(file, `${file}.bak`); } catch (e) {
      if (e.code !== "ENOENT") logger.warn(`feedEngage: could not refresh tracker backup: ${e.message}`);
    }
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return true;
      } catch (e) {
        if (!["EPERM", "EBUSY", "EACCES"].includes(e.code) || attempt >= 5) throw e;
        sleepSync(150 * (attempt + 1));
      }
    }
  } catch (e) {
    logger.error(`feedEngage: could not persist tracker: ${e.message}`);
    try { fs.unlinkSync(tmp); } catch (rmErr) {}
    return false;
  }
}

// Tracker entries: { ts, status: "commented" | "liked" | "skipped" | "rejected" | "invited",
// likedAt?, followedAt?, commentedAt?, comment? (the text we posted), authorHref?, skipReason?,
// unverified?, viral?, pass? ("comment" | "viral": which pass skipped or rejected it) }
// (a plain-string value = commented). Invites are conn:<profile> entries (acceptedAt once
// accepted), the people who engage with us warm:<profile> entries (see the reciprocity section).
function entryOf(v) {
  if (v && typeof v === "object") return v;
  return { ts: String(v || ""), status: "commented" };
}

// Every key a post may be tracked under: the primary one first, then each other scheme.
const keysOfPost = (post) => [post.key, ...(post.altKeys || []), post.authorKey].filter(Boolean);
function rawEntry(track, keys) {
  for (const k of keys) if (track[k] !== undefined) return track[k];
  return undefined;
}

function entryOfPost(track, post) {
  return entryOf(rawEntry(track, keysOfPost(post)));
}

// shouldSkipTracked(track, key, ...olderKeys): the first key with an entry is the truth.
function shouldSkipTracked(track, key, ...older) {
  const e = entryOf(rawEntry(track, [key, ...older.flat()].filter(Boolean)));
  if (!e.ts) return false;
  if (e.status === "commented") return true; // never twice, inside the 30d prune window
  const age = Date.now() - Date.parse(e.ts);
  if (e.status === "skipped" && age < SKIP_TTL_MS) return true;
  if (e.status === "rejected" && age < REJECT_TTL_MS) return true;
  return false;
}

// One form per profile link: no query, no trailing slash, no escapes (notifications write "-" as "%2D").
const normHref = (h) => {
  const s = String(h || "").split("?")[0].replace(/\/$/, "");
  try { return decodeURI(s); } catch { return s; }
};

// Merge, never replace: a comment must not erase the likedAt/followedAt the caps count.
function markPost(track, post, fields) {
  const prev = rawEntry(track, keysOfPost(post));
  const base = prev === undefined ? {} : entryOf(prev);
  const next = { status: "liked", ...base, ...fields };
  next.ts = fields.ts || base.ts || nowIso();
  if (post.href) next.authorHref = normHref(post.href);
  track[post.key] = next;
  return next;
}

const within = (iso, ms, now = Date.now()) => {
  const t = Date.parse(iso || "");
  return Number.isFinite(t) && now - t < ms;
};
const commentedAtOf = (e) => e.commentedAt || (e.status === "commented" ? e.ts : "");
// Rolling windows: "today" is the last 24 h, not the UTC calendar day.
const countEntries = (track, pred) => postEntries(track).filter(([, v]) => pred(entryOf(v))).length;
// viral: true counts only the viral pass's comments, false only the others, absent all of them.
const commentedSince = (track, ms, { viral } = {}) =>
  countEntries(track, (e) => within(commentedAtOf(e), ms) && (viral === undefined || !!e.viral === viral));
const likedSince = (track, ms) => countEntries(track, (e) => within(e.likedAt, ms));
const followedSince = (track, ms) => countEntries(track, (e) => within(e.followedAt, ms));
const invitedSince = (track, ms) => countEntries(track, (e) => e.status === "invited" && within(e.ts, ms));
// The texts of our latest comments, newest first: the drafters write against them so no two
// comments open or run the same way.
const RECENT_COMMENTS = 8;
const recentComments = (track, n = RECENT_COMMENTS) => postEntries(track).map(([, v]) => entryOf(v))
  .filter((e) => e.comment && commentedAtOf(e))
  .sort((a, b) => Date.parse(commentedAtOf(b)) - Date.parse(commentedAtOf(a)))
  .slice(0, n).map((e) => e.comment);
const authorDid = (track, href, pick, ms) => {
  const h = normHref(href);
  return !!h && countEntries(track, (e) => e.authorHref === h && within(pick(e), ms)) > 0;
};

// Prune entries older than 30 days by their LAST activity (a like today on an old entry keeps
// it, so the like cap still sees it). Invite history (conn:) is kept 90 days.
function pruneTrack(track) {
  const now = Date.now();
  for (const [key, v] of postEntries(track)) {
    const cutoff = now - (key.startsWith("conn:") ? CONN_PRUNE_MS : PRUNE_MS);
    const e = entryOf(v);
    const times = [e.ts, e.likedAt, e.followedAt, e.commentedAt].map((x) => Date.parse(x || "")).filter(Number.isFinite);
    if (!times.length || Math.max(...times) < cutoff) delete track[key];
  }
}

// ---- Circuit breaker, pass guard ----
function cooldownLeft(track, kind) {
  const until = Date.parse(((track && track.cooldowns) || {})[kind] || "");
  return Number.isFinite(until) ? Math.max(0, until - Date.now()) : 0;
}
function setCooldown(track, kind, ms, why) {
  const until = new Date(Date.now() + ms).toISOString();
  track.cooldowns = { ...(track.cooldowns || {}), [kind]: until };
  logger.error(`feedEngage: LinkedIn ${kind === "all" ? "paused" : `${kind} paused`} until ${until} (${why}).`);
  saveTrack(track);
}

// Why a pass must not start, or "" when it may.
function passBlocked(track, kind) {
  const off = linkedinService.disabledReason();
  if (off) return `linkedin unavailable (${off})`;
  if (track.disabled) return `linkedin unavailable (${track.disabled})`;
  if (cooldownLeft(track, "all")) return `linkedin unavailable (cooldown until ${track.cooldowns.all})`;
  if (kind === "connect" && cooldownLeft(track, "connect")) return `linkedin unavailable (connect cooldown until ${track.cooldowns.connect})`;
  return "";
}

// A pacing wait that ends as soon as a stop is requested (cron's stopping()): nothing is posted after a stop.
async function pause(ms, shouldStop) {
  const end = Date.now() + ms;
  while (!shouldStop() && Date.now() < end) await sleep(Math.min(1000, end - Date.now()));
}

const stopError = (message) => Object.assign(new Error(message), { code: "LINKEDIN_UNAVAILABLE" });
// After a public action the tracker MUST persist; if it cannot, the pass stops (and LinkedIn
// stays off for the run) rather than act again with no memory of what it did.
function saveOrStop(track) {
  if (saveTrack(track)) return;
  linkedinService.disable(6 * HOUR, "tracker save failed");
  throw stopError("tracker save failed after a public action");
}

// Every pass runs under one guard: a hard timeout (a hung WebDriver call must not hold the run;
// on timeout chromedriver is killed and LinkedIn is off for the run), and the typed LinkedIn
// stops (signed out, checkpoint, earlier failure) turned into a clean return with a reason.
// A checkpoint/limit wall also pauses every pass for 24-48 h, persisted in the tracker.
async function guarded(name, ctx, body, timeoutMs = PASS_TIMEOUT_MS) {
  let timer = null;
  ctx.deadline = Date.now() + timeoutMs;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
    if (timer.unref) timer.unref();
  });
  const run = body();
  run.catch(() => {}); // a body still running after a timeout must not raise an unhandled rejection
  try {
    const r = await Promise.race([run.then(() => "done"), timedOut]);
    if (r === "timeout") {
      ctx.aborted = true;
      ctx.out.reason = `linkedin unavailable (${name} pass timed out after ${Math.round(timeoutMs / 60000)} min)`;
      logger.error(`feedEngage ${name}: ${ctx.out.reason}; stopping chromedriver.`);
      linkedinService.disable(6 * HOUR, `${name} pass timed out`);
      await LinkedInService.cleanup().catch(() => {});
    }
  } catch (e) {
    ctx.aborted = true;
    if (!linkedinService.isStopError(e)) throw e;
    if (e.code === "LINKEDIN_RESTRICTED") setCooldown(ctx.track, "all", jitter(24 * HOUR, 48 * HOUR), e.message);
    ctx.out.reason = `linkedin unavailable (${e.message})`;
    logger.warn(`feedEngage ${name}: stopped - ${ctx.out.reason}.`);
  } finally {
    clearTimeout(timer);
  }
  return ctx.out;
}

// Our profile slug is remembered in the tracker once the service has read it.
function shareOwnSlug(track) {
  const saved = (track.meta || {}).ownSlug;
  if (saved && !LinkedInService._ownSlug) LinkedInService._ownSlug = saved;
  return () => {
    const slug = LinkedInService._ownSlug;
    if (slug && slug !== saved && !track.disabled) {
      track.meta = { ...(track.meta || {}), ownSlug: slug };
      saveTrack(track);
    }
  };
}
const rethrowStop = (e) => { if (linkedinService.isStopError(e)) throw e; };

// ---- Reciprocity: the people who engage with us ----
// Whoever comments on, reacts to, reposts or mentions our posts, follows us or accepts our invite
// is the warmest audience there is. The notifications page (read at most every 3 h) records them as
// warm:<profile> entries { ts: their latest engagement, status: "warm", name, kinds, visitedAt?,
// ourFirst?: we had engaged them first, aliasOf?: the same person under another profile link },
// and an accepted invite gets acceptedAt on its conn: entry.
// The like and comment passes engage them first: their recent posts are the first sources, their
// posts score WARM_BONUS higher, and following them back needs no top score. Every daily cap and
// per-author gap still holds.
const WARM_KEY = (href) => `warm:${normHref(href)}`;
const WARM_BONUS = 3;
const WARM_MAX_AGE_H = 7 * 24; // an older notification says little about who is around now
const WARM_TTL_MS = 14 * DAY; // warm this long after their latest engagement
const WARM_RECHECK_MS = 3 * HOUR;
const WARM_REVISIT_MS = 3 * DAY; // a warm person's page is not reloaded sooner
const WARM_SOURCES_PER_PASS = 2;
// Who goes first: a comment, reply or mention is a conversation; a reaction is a nod.
const WARM_RANK = { comment: 5, reply: 5, mention: 4, repost: 4, accepted: 3, follow: 2, reaction: 1 };
const warmRank = (w) => Math.max(0, ...(w.kinds || []).map((k) => WARM_RANK[k] || 0));

// One per person (aliases left out); isWarm sees every link a person is known by.
function warmPeople(track, now = Date.now()) {
  return postEntries(track).filter(([k, v]) => k.startsWith("warm:") && v && !v.aliasOf && within(v.ts, WARM_TTL_MS, now))
    .map(([k, v]) => ({ ...v, key: k, href: k.slice("warm:".length) }));
}
const isWarm = (track, href) => {
  const e = track[WARM_KEY(href)];
  if (!normHref(href) || !e) return false;
  const main = e.aliasOf && track[e.aliasOf];
  return within(e.ts, WARM_TTL_MS) || (!!main && within(main.ts, WARM_TTL_MS));
};

// Records what the notifications page showed (LinkedInService.scanNotifications). Returns how many
// people are new to the warm list.
function noteWarmPeople(track, items, now = Date.now()) {
  let added = 0;
  for (const it of items || []) {
    const href = normHref(it.href);
    // An age the card did not show is unknown: it never moves a known person's ts (a notification that
    // stays in the list would keep them warm forever) and dates a new one now.
    const known = typeof it.ageH === "number" && Number.isFinite(it.ageH);
    if (!/linkedin\.com\/in\/[^/]+$/i.test(href) || (known && it.ageH > WARM_MAX_AGE_H)) continue;
    const key = WARM_KEY(href);
    const prev = track[key] && typeof track[key] === "object" ? track[key] : null;
    if (prev && !known) continue;
    if (!prev) added++;
    const atMs = known ? now - it.ageH * HOUR : now, at = new Date(atMs).toISOString();
    const invite = track[CONNECT_KEY(href)];
    const invited = !!invite && invite.status === "invited" && Date.parse(invite.ts) < atMs;
    // We engaged them first (a comment, like or follow in the 30 days before they engaged, or our
    // invite): it came back. Our like back after their engagement is not a first.
    const before = (x) => !!x && Date.parse(x) < atMs && within(x, PRUNE_MS, now);
    const ourFirst = (prev && prev.ourFirst) || invited || authorDid(track, href, (e) => [e.commentedAt, e.likedAt, e.followedAt].find(before), PRUNE_MS);
    track[key] = {
      ts: prev && Date.parse(prev.ts) > atMs ? prev.ts : at,
      status: "warm",
      name: it.name || (prev && prev.name) || "",
      kinds: [...new Set([...((prev && prev.kinds) || []), it.kind])],
      ...(prev && prev.visitedAt ? { visitedAt: prev.visitedAt } : {}),
      ...(prev && prev.commentVisitedAt ? { commentVisitedAt: prev.commentVisitedAt } : {}),
      ...(prev && prev.aliasOf ? { aliasOf: prev.aliasOf } : {}),
      ...(ourFirst ? { ourFirst: true } : {}),
    };
    // A notification under an alias's link is news of the person it stands for.
    const main = prev && prev.aliasOf && track[prev.aliasOf];
    if (main && typeof main === "object" && Date.parse(track[key].ts) > Date.parse(main.ts)) track[prev.aliasOf] = { ...main, ts: track[key].ts };
    if (it.kind === "accepted" && invited && !invite.acceptedAt) track[CONNECT_KEY(href)] = { ...invite, acceptedAt: at };
  }
  return added;
}

// Reads the notifications page when the last read is over WARM_RECHECK_MS old, and logs how the
// reciprocity loop is doing: warm people, how many came back after we engaged first, invites accepted.
// Never fatal: a failed read leaves the pass to its other sources (a stop still stops).
async function refreshWarm(track) {
  try {
    if (searchLoadsSince(track, WARM_RECHECK_MS, "notifLoads")) return;
    recordSearchLoad(track, "notifLoads");
    const items = await LinkedInService.scanNotifications();
    const added = noteWarmPeople(track, items);
    saveTrack(track);
    const warm = warmPeople(track);
    const invites = postEntries(track).filter(([k, v]) => k.startsWith("conn:") && v.status === "invited" && within(v.ts, PRUNE_MS));
    logger.info(`feedEngage: ${items.length} engagements with us read, ${added} new; ${warm.length} warm people (${warm.filter((w) => w.ourFirst).length} came back after we engaged first); invites accepted in 30 days: ${invites.filter(([, v]) => v.acceptedAt).length}/${invites.length}.`);
  } catch (e) {
    rethrowStop(e);
    logger.warn(`feedEngage: notifications not read: ${e.message}`);
  }
}

// Up to WARM_SOURCES_PER_PASS warm people's recent posts as scan sources for a pass ("like" or
// "comment"): the strongest engagement first, then the latest; never a page that pass read in the
// last WARM_REVISIT_MS, nor a person inside that pass's author gap (liked today, commented this week)
// under any link they are known by: a notification's member id or their posts' vanity link (an alias).
const WARM_VISITED = { like: "visitedAt", comment: "commentVisitedAt" };
function warmSources(track = {}, limit = WARM_SOURCES_PER_PASS, now = Date.now(), pass = "like") {
  const visited = WARM_VISITED[pass] || WARM_VISITED.like;
  const aliases = postEntries(track).filter(([k, v]) => k.startsWith("warm:") && v && v.aliasOf);
  const hrefsOf = (w) => [w.href, ...aliases.filter(([, v]) => v.aliasOf === w.key).map(([k]) => k.slice("warm:".length))];
  const gapHit = pass === "comment"
    ? (w) => hrefsOf(w).some((h) => authorDid(track, h, (e) => e.commentedAt, AUTHOR_COMMENT_GAP_MS))
    : (w) => hrefsOf(w).some((h) => authorDid(track, h, (e) => e.likedAt, AUTHOR_LIKE_GAP_MS));
  return warmPeople(track, now)
    .filter((w) => !within(w[visited], WARM_REVISIT_MS, now) && !gapHit(w))
    .sort((a, b) => warmRank(b) - warmRank(a) || Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, limit)
    .map((w) => ({ label: `warm:${w.href.split("/in/")[1]}`, url: `${w.href}/recent-activity/all/`, warmKey: w.key, pass }));
}
// A warm person's page is read: not again for WARM_REVISIT_MS. A notification may link a person by
// member id (/in/ACoAA...) while their posts link the vanity name: their posts on the page, matched
// by name, carry the warm record over to the link the posts use (an alias).
function noteWarmPage(track, src, posts = []) {
  const w = src.warmKey && track[src.warmKey];
  if (!w) return;
  track[src.warmKey] = { ...w, [WARM_VISITED[src.pass] || WARM_VISITED.like]: nowIso() };
  const name = String(w.name || "").trim().toLowerCase();
  for (const post of posts) {
    const key = WARM_KEY(post.href);
    if (!name || String(post.author || "").trim().toLowerCase() !== name || !/\/in\//i.test(String(post.href)) || key === src.warmKey || track[key]) continue;
    track[key] = { ...track[src.warmKey], aliasOf: src.warmKey };
  }
  saveTrack(track);
}

// A post's audience score with the reciprocity bonus (a sensitive, bait or non-English post still
// gets nothing).
function audienceScore(track, post) {
  const s = scorePost(post);
  return s > -99 && isWarm(track, post.href) ? s + WARM_BONUS : s;
}

// Follow top-scoring authors and everyone warm: follows weigh heavier than likes in what LinkedIn
// ranks into the feed, and a follow back is the first reply to someone who engaged with us. People
// only (a company page follows nobody back). Never unfollows; state-checked in the service. Capped
// per rolling day.
async function maybeFollow(post, track) {
  if (!/\/in\//i.test(String(post.href || ""))) return;
  if ((post.score < FOLLOW_MIN && !isWarm(track, post.href)) || followedSince(track, DAY) >= FOLLOW_MAX_PER_DAY) return;
  if (entryOfPost(track, post).followedAt) return;
  if (authorDid(track, post.href, (e) => e.followedAt, PRUNE_MS)) return; // followed this author already
  try {
    if (await LinkedInService.followFeedCard(post.text.slice(0, 80))) {
      markPost(track, post, { followedAt: nowIso() });
      saveOrStop(track);
      logger.info(`feedEngage: followed @${post.author} (score ${post.score}, ${followedSince(track, DAY)}/${FOLLOW_MAX_PER_DAY} today).`);
      await sleep(jitter(2000, 6000));
    }
  } catch (err) { rethrowStop(err); }
}

// shouldStop (every pass): checked before each public action; true ends the pass at once.
const runFeedEngagement = (opts = {}) => commentPass({ ...opts, viral: false });
// The viral pass: the same comment engine on posts going viral (viralScore), on its own daily cap.
const runViralPass = (opts = {}) => commentPass({ max: 1, ...opts, viral: true });

async function commentPass({ max = 2, dryRun = false, shouldStop = () => false, viral = false } = {}) {
  const tag = viral ? "feedEngage viral" : "feedEngage";
  if ((!config.social.linkedinFeedReply || (viral && !config.social.linkedinViral)) && !dryRun) {
    return { commented: 0, skipped: 0, liked: 0, previews: [], wouldLike: [], reason: "disabled", cost: null };
  }
  // Simple mode skips every gate and the critic: it may preview, never post.
  if (config.social.linkedinSimpleReply && !dryRun) {
    logger.warn("feedEngage: LINKEDIN_SIMPLE_REPLY=true has no gates or critic - forcing a dry run, nothing will be posted.");
    dryRun = true;
  }
  // Cost readout: snapshot LLM token meters so every run reports its own spend.
  const m0 = llmService.getMetrics();
  const runCost = () => {
    const m1 = llmService.getMetrics();
    const d = (k) => (Number(m1[k]) || 0) - (Number(m0[k]) || 0);
    const orPrompt = d("openrouterPromptTokens"), orCompletion = d("openrouterCompletionTokens");
    const nvPrompt = d("nvidiaPromptTokens"), nvCompletion = d("nvidiaCompletionTokens");
    return {
      openrouter: { prompt: orPrompt, completion: orCompletion, usd: llmService.commentCostUsd(orPrompt, orCompletion) },
      nvidia: { prompt: nvPrompt, completion: nvCompletion },
    };
  };
  const out = { commented: 0, skipped: 0, liked: 0, previews: [], wouldLike: [], reason: "", cost: null };
  const track = loadTrack();
  const blocked = passBlocked(track, "comment");
  if (blocked) return { ...out, reason: blocked, cost: runCost() };
  pruneTrack(track);
  const cap = viral ? VIRAL_MAX_PER_DAY : MAX_PER_DAY;
  const capHit = () => !dryRun && commentedSince(track, DAY, { viral }) >= cap;
  if (capHit()) return { ...out, reason: `daily ${viral ? "viral " : ""}cap (${cap}) reached`, cost: runCost() };
  const rememberSlug = shareOwnSlug(track);
  const ctx = { track, out, aborted: false };
  let dryLoads = 0;
  // The slowest draft so far, and whether the pass already ran out of time for another post.
  let slowestDraftMs = 0;
  let timeUp = false;
  const nearlyUp = (extraMs = 0) => timeUp || Date.now() + extraMs > ctx.deadline - draftReserveMs(viral, slowestDraftMs);

  const skipPost = (post, status, why) => {
    if (dryRun) return;
    markPost(track, post, { status, ts: nowIso(), skipReason: String(why || status).slice(0, 200), pass: viral ? "viral" : "comment" });
    saveTrack(track);
  };
  // The regular pass's own rejection (its stricter, peer-only gates) does not bar the viral pass
  // from the same post during the hours that matter; anything else tracked does.
  const tracked = (post) => {
    const e = entryOfPost(track, post);
    if (viral && e.status === "rejected" && e.pass !== "viral") return false;
    return shouldSkipTracked(track, post.key, keysOfPost(post).slice(1));
  };

  // (one line per author: a profile source can offer several of an author's posts)
  const authorsSkipped = new Set();
  // Sources whose comment box would not open, and how often: a page that fails twice is left.
  const noEditor = new Map();
  const engageOne = async (post, sort) => {
    if (tracked(post)) { out.skipped++; return; }
    if (authorDid(track, post.href, commentedAtOf, viral ? VIRAL_AUTHOR_GAP_MS : AUTHOR_COMMENT_GAP_MS)) {
      if (!authorsSkipped.has(post.author)) logger.info(`${tag}: already commented on @${post.author} ${viral ? "in the last 2 days" : "this week"} - skipping.`);
      authorsSkipped.add(post.author);
      out.skipped++;
      return;
    }
    let draft;
    // A draft's time (from its first LLM call to its verdict) sizes the reserve for the next post: only a
    // draft that reached a model (a thin, foreign or promo post ends before any call, and teaches nothing).
    let drafting = 0, callsBefore = 0;
    const startDraft = () => { drafting = Date.now(); callsBefore = llmService.commentCalls || 0; };
    const timed = () => { if (drafting && (llmService.commentCalls || 0) > callsBefore) slowestDraftMs = Math.max(slowestDraftMs, Date.now() - drafting); };
    try {
      if (viral) {
        // Read the thread first (and see the post as readers do): the comment must say what the
        // comments on top have not. Opening the comments is read-only.
        const section = await LinkedInService.readComments(post.text.slice(0, 80), post.href, { expectComments: (Number(post.comments) || 0) > 0 });
        if (section.status === "already") {
          if (!dryRun) { markPost(track, post, { status: "commented", ts: nowIso(), commentedAt: nowIso(), viral: true, skipReason: "our earlier comment found on the post" }); saveOrStop(track); }
          logger.info(`${tag}: @${post.author}'s post already has our comment - skipping.`);
          out.skipped++;
          return;
        }
        if (section.status !== "open") {
          logger.warn(`${tag}: could not open the comments on ${post.key} (${section.reason}) - not tracked, tried again later.`);
          out.skipped++;
          return;
        }
        let shot = "", shotDir = "";
        startDraft();
        try {
          if (llmService.providerFor("viral") === "claude" && !llmService.claudeResting()) {
            shotDir = fs.mkdtempSync(path.join(os.tmpdir(), "viral-shot-"));
            shot = path.join(shotDir, "post.png");
            if (!(await LinkedInService.screenshotCard(post.text.slice(0, 80), shot))) shot = "";
          }
          draft = await llmService.draftViralComment({ post, comments: section.comments, imageFile: shot, recent: recentComments(track) });
        } finally {
          if (shotDir) try { fs.rmSync(shotDir, { recursive: true, force: true }); } catch (e) { /* a temp image left behind costs nothing */ }
        }
        if (draft.candidates && draft.candidates.length) {
          for (const c of draft.candidates) logger.info(`${tag}: candidate [${c.angle}] "${c.comment}" -> ${c.gate && c.gate.length ? `gates: ${c.gate.join("; ")}` : c.judge ? `judge: ${c.judge.pass ? "PASS" : "FAIL"} ${c.judge.reason}` : "not judged"}`);
        }
      } else {
        startDraft();
        draft = await llmService.draftFeedComment({ postAuthor: post.author, postText: post.text, recent: recentComments(track) });
      }
    } catch (e) {
      timed();
      rethrowStop(e); // a checkpoint or sign-out while reading the thread ends the pass (and pauses LinkedIn)
      // The pass's deadline came before the draft could end: this post and the pass end here, untracked.
      if (e.code === "PASS_TIME_UP") { timeUp = true; out.reason = "the pass's time is nearly up"; out.skipped++; return; }
      // Thin posts throw before any LLM call: park them so every cycle doesn't waste a scan
      // slot on them. Anything else (network, LLM down) stays untracked and retries next cycle.
      if (/too thin/i.test(e.message || "")) skipPost(post, "skipped", "too thin");
      logger.warn(`feedEngage: draft failed for ${post.key}: ${e.message}`);
      out.skipped++;
      return;
    }
    timed();
    if (ctx.aborted || shouldStop()) return;
    if (draft.skipped) {
      skipPost(post, "skipped", (draft.errors || []).join("; ") || "llm skip"); // remembered 30 days
      logger.info(`feedEngage: SKIP - no safe angle on @${post.author} post. Moving on.`);
      out.skipped++;
      return;
    }
    if (!draft.isValid) {
      skipPost(post, "rejected", (draft.errors || []).join("; ")); // our draft failed, not the post: 3 days
      logger.warn(`feedEngage: comment rejected (${(draft.errors || []).join("; ")}) - skipping ${post.key} for 3d.`);
      out.skipped++;
      return;
    }
    if (dryRun) {
      out.previews.push({ author: post.author, key: post.key, postText: post.text, comment: draft.comment, sort, score: post.score, reactions: post.reactions || 0, ageH: post.ageH });
      logger.info(`${tag} DRYRUN [${sort}] would comment on @${post.author}: "${draft.comment}"`);
      out.skipped++;
      return;
    }
    logger.info(`${tag} [${sort}]: commenting on @${post.author}${viral ? ` (score ${post.score}, ${post.reactions || 0} reactions, ${Math.round(post.ageH)}h old)` : ""}: "${draft.comment.slice(0, 90)}..."`);
    // The like that goes with a comment counts toward the day's like cap too.
    const res = await LinkedInService.commentOnFeedCard(post.key, post.href, post.text.slice(0, 80), draft.comment, post.author, { like: likedSince(track, DAY) < LIKES_MAX_PER_DAY });
    const at = nowIso();
    const liked = res && res.liked ? { likedAt: at } : {};
    if (res && liked.likedAt) out.liked++;
    if (res && (res.status === "posted" || res.status === "uncertain" || res.status === "already")) {
      // A dispatched submit is never retried: uncertain is tracked as commented (unverified).
      markPost(track, post, {
        status: "commented", ts: at, commentedAt: at, ...liked, ...(viral ? { viral: true } : {}),
        ...(res.status === "already" ? {} : { comment: draft.comment.slice(0, 300) }),
        ...(res.status === "posted" ? {} : { unverified: true }),
        ...(res.status === "already" ? { skipReason: "our earlier comment found on the post" } : {}),
      });
      saveOrStop(track);
      if (res.status === "already") { out.skipped++; return; }
      out.commented++;
      logger.info(`${tag}: commented (${out.commented}/${max} this cycle, ${commentedSince(track, DAY, { viral })}/${cap} today)${res.status === "uncertain" ? " [unverified]" : ""}.`);
      return;
    }
    if (liked.likedAt) {
      markPost(track, post, liked);
      saveOrStop(track);
    }
    logger.warn(`feedEngage: comment not submitted on ${post.key} (not tracked, retried next cycle).`);
    if (res && res.reason === "no-editor") noEditor.set(sort, (noEditor.get(sort) || 0) + 1);
    out.skipped++;
  };

  // Walk the sources until `max` comments land or sources run out. Posts are scored (the
  // regular pass: finance/AI/founder, US, fresh, COMMENT_MIN+; the viral pass: viralScore,
  // VIRAL_MIN+); only those get a draft, best first. No separate like loop here:
  // commentOnFeedCard likes first, and the like pass already ran this cycle.
  const seenThisRun = new Set();
  const wanted = new Set();
  const done = () => ctx.aborted || shouldStop() || (dryRun ? out.previews.length : out.commented) >= max;
  const [score, minScore] = viral ? [viralScore, VIRAL_MIN] : [(p) => audienceScore(track, p), COMMENT_MIN];
  const commentFrom = async (src) => {
    const scanned = await scanSource(src, 10);
    if (!dryRun) noteWarmPage(track, src, scanned);
    // A big name's page: when it was read and how often it posts decide when it is read again.
    if (viral && String(src.label).startsWith("vip:")) {
      noteViralPage(track, src.label, scanned);
      if (!dryRun) saveTrack(track);
    }
    const posts = scanned
      .map((p) => ({ ...p, score: score(p) }))
      .sort((a, b) => b.score - a.score);
    if (viral && posts.length) logger.info(`${tag} [${src.label}]: best ${posts.slice(0, 3).map((p) => `@${p.author} ${p.score} (${Math.round(p.ageH)}h, ${p.reactions || 0} reactions, ${p.comments || 0} comments)`).join("; ")}.`);
    let fresh = 0;
    for (const post of posts) {
      if (done() || capHit()) break;
      // No more drafts for a page whose comment box will not open.
      if ((noEditor.get(src.label) || 0) >= 2) { logger.warn(`${tag} [${src.label}]: the comment box did not open twice - leaving this page.`); break; }
      if (seenThisRun.has(post.key)) continue;
      if (tracked(post)) continue;
      seenThisRun.add(post.key);
      fresh++;
      if (isSensitivePost(post.text)) { skipPost(post, "skipped", "sensitive topic"); continue; }
      if (dryRun && !viral && post.score >= LIKE_MIN && !wanted.has(post.key)) {
        wanted.add(post.key);
        out.wouldLike.push({ author: post.author, snippet: post.text.slice(0, 60), score: post.score });
      }
      if (post.score < minScore) continue;
      if (nearlyUp()) { out.reason = "the pass's time is nearly up"; break; }
      const before = out.commented;
      await engageOne(post, src.label);
      // Pace only published comments (nothing public happened on a rejection); a pause the next post
      // could not follow is not waited out.
      if (!dryRun && out.commented > before && out.commented < max) {
        const wait = jitter(60000, 180000);
        if (nearlyUp(wait)) { timeUp = true; out.reason = "the pass's time is nearly up"; break; }
        await pause(wait, shouldStop);
      }
    }
    return fresh;
  };
  await guarded(viral ? "viral" : "comment", ctx, async () => {
    // The pass's LLM calls end before its guard does, with time left to post the last comment.
    llmService.commentDeadline = ctx.deadline - SUBMIT_MS;
    if (!viral && !dryRun) await refreshWarm(track);
    let found = 0;
    for (const src of viral ? buildViralSources(track) : buildSources(track, 6, "comment")) {
      if (done() || capHit()) break;
      // Drafts take minutes (a draft and its judge or critic): no page is loaded for a post the pass cannot finish.
      if (nearlyUp()) { out.reason = "the pass's time is nearly up"; break; }
      // The viral pass's page loads are capped per day (big-name pages and searches are extra loads).
      if (viral) {
        if (searchLoadsSince(track, DAY, "viralLoads") + dryLoads >= VIRAL_LOADS_PER_DAY) { out.reason = `viral page cap (${VIRAL_LOADS_PER_DAY} per day)`; break; }
        // A dry run tracks nothing: its loads are counted in memory only.
        if (dryRun) dryLoads++;
        else recordSearchLoad(track, "viralLoads");
      }
      try { found += await commentFrom(src); } catch (e) { rethrowStop(e); logger.warn(`${tag} [${src.label}]: scan failed: ${e.message}`); }
    }
    if (found === 0 && !viral && !done() && config.social.linkedinSource !== "feed") {
      logger.warn("feedEngage: targeted sources yielded nothing - falling back to home feed.");
      for (const src of FALLBACK_SOURCES) {
        if (done() || nearlyUp()) break;
        try { await commentFrom(src); } catch (e) { rethrowStop(e); logger.warn(`feedEngage [${src.label}]: scan failed: ${e.message}`); }
      }
    }
    if (!done()) logger.info(`${tag}: ${dryRun ? out.previews.length : out.commented}/${max} comments - ${out.reason || "sources exhausted"}, moving on.`);
  }, viral ? VIRAL_PASS_TIMEOUT_MS : PASS_TIMEOUT_MS).finally(() => { llmService.commentDeadline = 0; });
  if (!ctx.aborted && !dryRun) rememberSlug();

  out.cost = runCost();
  logger.info(`${tag}: run cost ~$${out.cost.openrouter.usd.toFixed(4)} (OpenRouter ${out.cost.openrouter.prompt}+${out.cost.openrouter.completion} tok; NVIDIA ${out.cost.nvidia.prompt}+${out.cost.nvidia.completion} tok).`);
  if (!out.reason && dryRun) out.reason = "dry run - nothing posted or tracked";
  return out;
}

// Like-only pass: no drafting, no commenting, no LLM spend. Walks the targeted
// sources, likes the best-scoring fresh posts right after each scan (cards
// virtualize out within a minute), stops at the target. Already-liked keys
// persist in the tracker; likeFeedCard is state-checked (never toggles off).
async function runLikePass({ min = 5, max = 9, shouldStop = () => false } = {}) {
  const out = { liked: 0, picked: 0, target: 0, reason: "" };
  const track = loadTrack();
  const blocked = passBlocked(track, "like");
  if (blocked) return { ...out, reason: blocked };
  out.target = Math.max(0, Math.min(min + Math.floor(Math.random() * (max - min + 1)), LIKES_MAX_PER_DAY - likedSince(track, DAY)));
  if (out.target <= 0) return { ...out, reason: `daily like cap (${LIKES_MAX_PER_DAY}) reached` };
  const rememberSlug = shareOwnSlug(track);
  const ctx = { track, out, aborted: false };
  const halted = () => ctx.aborted || shouldStop();
  const seen = new Set();
  const likeFrom = async (src) => {
    let posts = [];
    try {
      posts = await scanSource(src);
      noteWarmPage(track, src, posts);
    } catch (e) {
      rethrowStop(e);
      logger.warn(`feedEngage like-pass: ${src.label} scan failed: ${e.message}`);
    }
    const pool = [];
    for (const post of posts) {
      if (!post || seen.has(post.key)) continue;
      seen.add(post.key);
      const e = entryOfPost(track, post);
      if (e.likedAt) continue;
      // The comment pass judged it not worth engaging (LLM SKIP, sensitive, thin): no like either.
      if (e.status === "skipped" && within(e.ts, SKIP_TTL_MS)) continue;
      post.score = audienceScore(track, post);
      if (post.score < LIKE_MIN) continue; // only target-audience posts (and warm people's) train the feed
      pool.push(post);
    }
    // Best audience match first, with a little noise so the pattern isn't mechanical.
    pool.sort((a, b) => (b.score + Math.random() * 1.5) - (a.score + Math.random() * 1.5));
    for (const post of pool) {
      if (halted() || out.liked >= out.target) break;
      if (authorDid(track, post.href, (x) => x.likedAt, AUTHOR_LIKE_GAP_MS)) continue; // 1 like per author per day
      out.picked++;
      await maybeFollow(post, track);
      if (halted()) break;
      try {
        if (await LinkedInService.likeFeedCard(post.text.slice(0, 80))) {
          out.liked++;
          markPost(track, post, { likedAt: nowIso() });
          saveOrStop(track); // persist immediately so a crash can't re-like this post
          logger.info(`feedEngage like-pass: liked @${post.author} via ${src.label} (${out.liked}/${out.target}).`);
          await pause(jitter(6000, 20000), shouldStop);
        } else {
          await sleep(jitter(1500, 4000));
        }
      } catch (e) {
        rethrowStop(e);
        await sleep(jitter(1500, 4000));
      }
    }
    return pool.length;
  };
  await guarded("like", ctx, async () => {
    await refreshWarm(track);
    let found = 0;
    for (const src of buildSources(track)) {
      if (halted() || out.liked >= out.target) break;
      found += await likeFrom(src);
    }
    // Targeted sources empty (markup change, nothing fresh): fall back to the home feed.
    if (found === 0 && !halted() && out.liked < out.target && config.social.linkedinSource !== "feed") {
      logger.warn("feedEngage like-pass: targeted sources yielded nothing - falling back to home feed.");
      for (const src of FALLBACK_SOURCES) {
        if (halted() || out.liked >= out.target) break;
        await likeFrom(src);
      }
    }
    if (out.liked < out.target && !halted()) logger.warn(`feedEngage like-pass: sources exhausted (${out.liked}/${out.target} liked).`);
  });
  if (!ctx.aborted) {
    pruneTrack(track); // bound tracker growth
    saveTrack(track);
    rememberSlug();
  }
  return out;
}

// Page loads in the last 24 h, per counter: people searches (each one counts toward LinkedIn's
// search limits) and the viral pass's big-name pages and searches.
function searchLoadsSince(track, ms, counter = "searchLoads") {
  return (((track.counters || {})[counter]) || []).filter((t) => within(t, ms)).length;
}
function recordSearchLoad(track, counter = "searchLoads") {
  const kept = (((track.counters || {})[counter]) || []).filter((t) => within(t, DAY));
  track.counters = { ...(track.counters || {}), [counter]: [...kept, nowIso()] };
  saveTrack(track);
}

// Connection pass: a few no-note requests per run to US, 2nd-degree people building with AI (and
// some investors around them), found through US-filtered people search. Stops cleanly on
// LinkedIn's weekly cap (connects pause 7 days) or any checkpoint (everything pauses).
async function runConnectPass({ min = 10, max = 15, dryRun = false, shouldStop = () => false } = {}) {
  const out = { sent: 0, target: 0, scanned: 0, previews: [], reason: "" };
  const track = loadTrack();
  const blocked = passBlocked(track, "connect");
  if (blocked) return { ...out, reason: blocked };
  const dayLeft = CONNECT_MAX_PER_DAY - invitedSince(track, DAY);
  const weekLeft = CONNECT_MAX_PER_WEEK - invitedSince(track, 7 * DAY);
  out.target = Math.max(0, Math.min(min + Math.floor(Math.random() * (max - min + 1)), dayLeft, weekLeft));
  if (out.target <= 0) return { ...out, reason: "daily/weekly connect cap reached" };
  const ctx = { track, out, aborted: false };
  await guarded("connect", ctx, async () => {
    const seenHref = new Set();
    let consecutiveFails = 0, loads = 0;
    const queries = buildConnectQueries();
    outer:
    for (const kw of queries) {
      let kwSent = 0;
      for (let page = 1; page <= 2; page++) {
        if (ctx.aborted || shouldStop() || out.sent >= out.target) break outer;
        if (kwSent >= CONNECT_PER_KEYWORD) break;
        if (loads >= SEARCH_LOADS_PER_PASS) { out.reason = `search page cap (${SEARCH_LOADS_PER_PASS} per pass)`; break outer; }
        if (searchLoadsSince(track, DAY) >= SEARCH_LOADS_PER_DAY) { out.reason = `search page cap (${SEARCH_LOADS_PER_DAY} per day)`; break outer; }
        loads++;
        recordSearchLoad(track);
        const res = await LinkedInService.scanPeopleSearch(kw, page);
        if (res.blocked) {
          if (res.code === "LINKEDIN_RESTRICTED") setCooldown(track, "all", jitter(24 * HOUR, 48 * HOUR), res.reason || "checkpoint");
          out.reason = `linkedin unavailable (${res.reason || "login/checkpoint wall"})`;
          break outer;
        }
        if (res.people.length === 0) break; // no more results for this keyword
        for (const p of res.people) {
          if (ctx.aborted || shouldStop() || out.sent >= out.target) break outer;
          if (kwSent >= CONNECT_PER_KEYWORD) break;
          out.scanned++;
          const key = CONNECT_KEY(p.href);
          if (!p.href || track[key] || seenHref.has(key)) continue;
          seenHref.add(key);
          if (!CONNECT_ICP_RE.test(p.text) || CONNECT_SKIP_RE.test(p.text) || CONNECT_NON_US_RE.test(p.text)) continue;
          if (dryRun) {
            out.previews.push({ name: p.name, text: p.text.slice(0, 140), kw });
            out.sent++; kwSent++;
            continue;
          }
          const r = await LinkedInService.sendConnectRequest({ label: p.label, href: p.href });
          if (r === "limit") {
            setCooldown(track, "connect", 7 * DAY, "LinkedIn invitation limit");
            out.reason = "LinkedIn invitation limit reached - connects paused 7 days";
            break outer;
          }
          if (r === "sent" || r === "sent-unverified") {
            out.sent++; kwSent++;
            // Unverified still counts: over-counting the cap is safe, under-counting is not.
            track[key] = { ts: nowIso(), status: "invited", ...(r === "sent-unverified" ? { unverified: true } : {}) };
            saveOrStop(track);
            logger.info(`feedEngage connect: invited ${p.name} (${out.sent}/${out.target}) via "${kw}"${r === "sent-unverified" ? " [unverified]" : ""}.`);
            consecutiveFails = 0;
          } else {
            // Email-gated or UI failure: park so the same person isn't retried every run.
            track[key] = { ts: nowIso(), status: "skipped" };
            saveTrack(track);
            logger.warn(`feedEngage connect: ${p.name} not sent (${r}).`);
            if (++consecutiveFails >= 5) { out.reason = "5 consecutive failures (LinkedIn UI changed?)"; break outer; }
          }
          // A send that navigated away (profile page, verification step) ends the pass.
          if (!(await LinkedInService.onPeopleSearchPage())) { out.reason = "left the people search page after a send"; break outer; }
          await pause(jitter(6000, 14000), shouldStop);
        }
        await pause(jitter(2000, 5000), shouldStop);
      }
    }
  });
  logger.info(`feedEngage connect: ${dryRun ? "would send" : "sent"} ${out.sent}/${out.target} (scanned ${out.scanned})${out.reason ? ` - stopped: ${out.reason}` : ""}.`);
  return out;
}

const cleanup = () => LinkedInService.cleanup();

module.exports = {
  runFeedEngagement, runViralPass, runLikePass, runConnectPass, scorePost, viralScore, isVip, buildViralSources, noteViralPage, isSensitivePost, cleanup,
  _tracker: { shouldSkipTracked, entryOfPost, markPost, loadTrack, saveTrack, pruneTrack, passBlocked, commentedSince, likedSince, setCooldown, recentComments },
  _reciprocity: { noteWarmPeople, noteWarmPage, warmPeople, warmSources, audienceScore, buildSources },
};
