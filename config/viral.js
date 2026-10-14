/**
 * Where the LinkedIn viral pass (src/services/feedEngage.js runViralPass) looks for posts that are
 * about to be seen by a very large audience: big names (founders, CEOs, labs, big dev tools, top
 * investors), and the day's most-engaged posts on launches, funding rounds and big-company news.
 * An early, good comment on such a post is seen by far more people than one on an ordinary post.
 *
 * Edit freely. A profile or company page that no longer exists only costs one page load (its
 * scan logs "collected 0 likeable posts"). Some names people expect here barely post on LinkedIn
 * (Elon Musk, Mark Zuckerberg, Sam Altman); the viral searches below catch the posts about them.
 *
 * people:    personal profiles, scanned through their recent activity
 * companies: company pages, scanned through their posts tab
 * searches:  content searches, past 24 hours, most relevant (LinkedIn ranks by engagement) first
 */
module.exports = {
  people: [
    { name: "Satya Nadella", slug: "satyanadella" },
    { name: "Sundar Pichai", slug: "sundarpichai" },
    { name: "Bill Gates", slug: "williamhgates" },
    { name: "Reid Hoffman", slug: "reidhoffman" },
    { name: "Jensen Huang", slug: "jenhsunhuang" },
    { name: "Andrew Ng", slug: "andrewyng" },
    { name: "Yann LeCun", slug: "yann-lecun" },
    { name: "Mustafa Suleyman", slug: "mustafa-suleyman" },
    { name: "Ryan Roslansky", slug: "ryanroslansky" },
    { name: "Jeff Weiner", slug: "jeffweiner08" },
    { name: "Arvind Krishna", slug: "arvindkrishna" },
    { name: "Garry Tan", slug: "garrytan" },
    { name: "Dharmesh Shah", slug: "dharmesh" },
    { name: "Amjad Masad", slug: "amjadmasad" },
    { name: "Guillermo Rauch", slug: "rauchg" },
    { name: "Clem Delangue", slug: "clementdelangue" },
    { name: "Anton Osika", slug: "antonosika" },
    { name: "Allie K. Miller", slug: "alliekmiller" },
  ],
  companies: [
    { name: "OpenAI", slug: "openai" },
    { name: "Anthropic", slug: "anthropicresearch" },
    { name: "Google DeepMind", slug: "deepmind" },
    { name: "NVIDIA", slug: "nvidia" },
    { name: "Microsoft", slug: "microsoft" },
    { name: "Google", slug: "google" },
    { name: "Meta", slug: "meta" },
    { name: "GitHub", slug: "github" },
    { name: "Hugging Face", slug: "huggingface" },
    { name: "Replit", slug: "replit" },
    { name: "Vercel", slug: "vercel" },
    { name: "Perplexity", slug: "perplexity-ai" },
    { name: "Stripe", slug: "stripe" },
    { name: "Y Combinator", slug: "y-combinator" },
    { name: "Andreessen Horowitz", slug: "andreessen-horowitz" },
    { name: "Sequoia Capital", slug: "sequoia" },
  ],
  searches: [
    "OpenAI", "Anthropic", "Nvidia", "Google AI", "Microsoft AI", "Meta AI",
    "Elon Musk", "xAI", "Sundar Pichai", "Satya Nadella", "Zuckerberg", "Sam Altman", "Jensen Huang",
    "raises Series", "unicorn startup", "funding round AI", "Y Combinator", "just launched",
    "Replit", "Cursor", "Lovable", "Perplexity", "GitHub Copilot", "IPO tech",
  ],
};
