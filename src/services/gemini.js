const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
} = require("@google/generative-ai");
const config = require("../../config");
const fs = require("fs");
const path = require("path");
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
const { logger, sleep } = require("../utils/helpers");

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const BANNED_WORDS = [
  "delve", "testament", "tapestry", "unlock", "unlocking", "seamless", "game-changer",
  "revolutionary", "groundbreaking", "moreover", "furthermore", "in conclusion",
  "shines a light", "treasure trove", "leverage", "robust", "key takeaway",
  "elevate", "cutting-edge", "beacon", "look no further", "significant",
  "significantly", "significant shifts", "advanced", "major", "majorly",
  "making waves", "advance", "powerful", "next-gen", "wild", "impressive",
  "critical", "critical step", "sophisticated", "most powerful", "signaling", "broader reach",
  "push boundaries", "pushing boundaries", "extensibility", "masterclass",
  "paving the way", "incredible ways", "blurring lines", "dive", "deep dive",
  "fundamental", "ensure", "core"
];

const WEAK_CTA_PATTERNS = [
  /what(?:'s| is) your primary bottleneck/i,
  /what do you think/i,
  /is .+ still viable/i,
  /are you using .+ or/i,
  /is your .+ ready for/i,
  /which .+ do you (?:use|prefer)/i,
  /what(?:'s| is) your go-to/i,
  /have you tried .+ yet/i,
  /agree or disagree/i,
];

const MID_QUALITY_PATTERNS = [
  /here(?:'s| is) what you need to know/i,
  /in this (?:post|article|update)/i,
  /let(?:'s| us) (?:dive|explore|break) (?:into|down)/i,
  /as (?:we all know|developers know)/i,
  /it(?:'s| is) worth noting/i,
  /exciting (?:news|update|development)/i,
  /stay tuned/i,
  /thoughts\?/i,
  /swipe (?:left|through)/i,
  /in today(?:'s|s) (?:fast-paced|ever-changing)/i,
];

const MIN_POST_LENGTH = 1200;
const MAX_POST_LENGTH = 2200;
const MIN_QUALITY_SCORE = 72;
const MAX_RECENT_STRUCTURES = 8;

// LinkedIn post structures the AI can choose from to keep posts varied.
// The AI selects the one that best fits the hook, topic, and manual points.
const STRUCTURE_REGISTRY = [
  {
    name: "problem-insight-framework",
    label: "Problem → Insight → Rehook → Framework",
    description: "Name the pain, reveal the non-obvious fact, add a short rehook, then deliver a save-worthy framework of 3-5 numbered steps or bullets."
  },
  {
    name: "contrarian-proof-action",
    label: "Contrarian Take → Proof → Application",
    description: "Challenge a common assumption, prove it with a concrete detail from the source, then show how to act on it with 3-5 practical numbered steps."
  },
  {
    name: "story-arc",
    label: "Story / Narrative Arc",
    description: "Tell a short scene (something that happened, a team's mistake, an observed pattern), then extract 3-5 practical numbered takeaways."
  },
  {
    name: "before-after",
    label: "Before / After Comparison",
    description: "Contrast how most engineers approach the topic today vs. the better way implied by the source, then list 3-5 numbered steps to bridge the gap."
  },
  {
    name: "numbered-listicle",
    label: "Numbered Listicle with Commentary",
    description: "Frame the post as 3-5 discrete observations or rules as numbered steps/bullets, with a sentence or two of connective analysis between them."
  },
  {
    name: "how-i-think-about",
    label: "How I Think About X",
    description: "Write as a senior engineer explaining the mental model they use for this topic; keep it analytical and distill it into 3-5 numbered operating principles."
  },
  {
    name: "direct-technical-breakdown",
    label: "Direct Technical Breakdown",
    description: "Skip the story and walk through the mechanism: what changed, why it matters, and what to do with it in 3-5 numbered technical actions."
  },
  {
    name: "mistake-correction-execution",
    label: "Common Mistake → Correction → Execution",
    description: "Spot a recurring anti-pattern, correct it with the source fact, then give 3-5 numbered concrete execution steps."
  }
];

const SYSTEM_PROMPT = `
You are an expert technical writer and senior software engineer. Your writing style is direct, clear, highly analytical, and professional—completely free of generic AI-generated filler, marketing hype, and corporate fluff.

You curate raw tech/AI/developer content (Twitter threads, LinkedIn posts) and transform them into premium, high-value, and perfectly formatted technical articles in markdown.

=== ANTI-AI & TECHNICAL TONE RULES (STRICT) ===
1. BAN LIST — Absolutely NEVER use these robotic/AI buzzwords:
   ${BANNED_WORDS.map(w => `"${w}"`).join(", ")}
2. NO MARKETING FLUFF — Avoid empty hype adjectives. Instead of "powerful query system" or "lightning-fast framework", write "query system" or "framework". Only include benchmark figures or technical details if specifically present in the source text.
3. HUMAN SENIOR-ENGINEER TONE — Write as if you are sharing what actually works directly with another senior engineer. Be objective, precise, and practical.
4. SENTENCE VARIANCE — Use a natural human rhythm. Mix short, punchy 4-to-6-word statements with slightly longer technical explanations. Avoid repetitive sentence structures.

=== CORE FORMATTING INSTRUCTIONS ===
- Every article must start with a level-3 header: "### [emoji] Topic - Subtopic" (Use ONE appropriate emoji: 🤖 for technical, 🚀 for tools, 💡 for tips, ✨ for features).
- The article must have a concise introduction (2-3 sentences max) explaining what the topic covers. No emojis or marketing language.
- Follow with "Key Points:" with a double newline, then bullet points using "•". There must be a double newline between each point. Single line per point, no emojis in points, 3-5 points max.
- When applicable, add "🚀 Implementation:" followed by 3-5 numbered steps.
- When verified external links or images exist in the source, add "🔗 Resources:" followed by links formatted as "• [Tool Name](url) - Description (max 10 words)" or images formatted as "![Image](url)".
- Never invent or hallucinate any links, tools, or resources. Preserve all factual information from the original context.
- Always separate distinct articles with "---" and a newline.

=== LINKEDIN POST GUARDRAILS ===
Prioritize clarity and specificity over flowery language.
Never use banned words even in creative sections.
Never put external GitHub URLs in the post body — they reduce reach. Put the link in the first comment instead.

=== LINKEDIN POST SPECIFIC RULES ===
Always use "• " for bullet points (never * or -).
Prioritize specific, actionable, or personal ("how I") insights over generic summaries.
Create a curiosity gap in the first 1-3 lines.
Sound like a senior engineer casually sharing something useful — avoid hype, marketing cliches, and corporate language.
MANDATORY: End the post body with exactly "🔗 Full breakdown + resources in the comments." (GitHub URL goes in the comment, not the post).

=== LINKEDIN ANTI-HYPE & VOICE RULES (STRICT) ===
Write like a senior engineer casually sharing something useful with another engineer.
Avoid hype, flowery, or overly polished language including: "significant", "significantly", "significant shifts", "advanced", "major", "majorly", "game-changing", "making waves", "robust", "advance", "powerful", "next-gen", "cutting-edge", "wild", "impressive", "critical step", "sophisticated", "most powerful", "signaling", "broader reach", "push boundaries", "pushing boundaries", "extensibility", "masterclass", "paving the way", "incredible ways", "blurring lines", "game-changer", "revolutionary", "groundbreaking", "dive", "deep dive", etc.
Avoid amplifying adverbs or adjectives that exaggerate facts (e.g., "significantly", "greatly", "impressively", "massively").
Prefer concrete technical details and specific examples over general praise or dramatic framing.
End the post body with exactly: "🔗 Full breakdown + resources in the comments."
Sound direct and practical.
Use "• " for all bullet points.
`;

const model = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  safetySettings,
  systemInstruction: SYSTEM_PROMPT,
});

class GeminiService {
  constructor() {
    this.lastRequestTime = 0;
    this.requestsThisMinute = 0;
    this.resetInterval = null;

    // Reset counter every minute
    this.resetInterval = setInterval(() => {
      this.requestsThisMinute = 0;
    }, 60000);
    if (this.resetInterval && this.resetInterval.unref) {
      this.resetInterval.unref();
    }
  }

  cleanup() {
    if (this.resetInterval) {
      clearInterval(this.resetInterval);
      this.resetInterval = null;
    }
  }

  buildBannedWordRegex(word) {
    if (!word || typeof word !== "string") return null;
    // Strip a trailing silent "e" so derivatives like leverage -> leveraging,
    // ensure -> ensuring, advance -> advanced are caught. Only do this for
    // words longer than 4 characters to avoid over-matching short roots.
    const useStem = word.endsWith("e") && word.length > 4;
    const stem = useStem ? word.slice(0, -1) : word;
    const pattern = (useStem ? stem : word).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const optionalE = useStem ? "e?" : "";
    return new RegExp(`\\b${pattern}${optionalE}(s|ed|ing|ly|tion|ness|er|est|ance|ence|ment|ive|ize|ise|able|ible)?\\b`, 'i');
  }

  async checkRateLimit() {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    // Reset counter if more than a minute has passed
    if (timeSinceLastRequest >= 60000) {
      this.requestsThisMinute = 0;
      this.lastRequestTime = now;
    }

    // Check if we've hit the rate limit
    if (this.requestsThisMinute >= 55) {
      const waitTime = 60000 - (Date.now() - this.lastRequestTime);
      if (waitTime > 0) {
        logger.info(
          `Gemini Rate limit: Waiting ${waitTime / 1000
          } seconds before next request`
        );
        await sleep(waitTime);
        // Concurrency-safe reset: only reset if another request hasn't already reset it
        if (Date.now() - this.lastRequestTime >= 60000) {
          this.requestsThisMinute = 0;
          this.lastRequestTime = Date.now();
        }
      }
    }

    this.requestsThisMinute++;
  }

  buildLinkedInPostRules(githubUrl, includeHook = true) {
    const hookRules = includeHook ? `
HOOK (First 1-3 lines, <200 characters visible):
Create an elite, scroll-stopping curiosity or information gap (80% of post success). You MUST use a results-first bold claim, a specific number, a contrarian angle, or a concrete announcement. Avoid neutral roundups. Prioritize hooks that include concrete numbers, benchmarks, or pricing when available in the content. Consider starting with one strategic emoji when it fits naturally (e.g. 💡, 🚀, ⚡) to act as a clean visual anchor.
Best performing styles (use the single strongest one for the selected content):
- Specific announcement style ("X just launched Y with Z")
- Numbered specific claim (e.g., "Only 3 of this week's AI/dev updates matter for production.")
- "How I..." or specific results-first statement
- A surprising concrete technical detail, benchmark, or statistic
- Contrarian take ("Most engineers get [topic] completely wrong...")
- Critical problem + immediate implication
Avoid weak, open-ended, or generic questions in the hook itself. Never start with "Here is", "This week", or similar roundup intros.
` : "";

    return `
=== 2026 LINKEDIN VIRALITY RULES ===
${hookRules}
BODY STRUCTURE — optimized for saves and dwell time:
Post length target: 1,300-2,000 characters total (including hook). Short posts die.

Use this 4-part structure:
1. PROBLEM paragraph (2-3 sentences): Name the specific pain. Mirror the engineer's internal monologue. "You've been doing X because..."
2. INSIGHT paragraph (2-3 sentences): The non-obvious fact from the source. One concrete thing they didn't know.
3. REHOOK (required): Between the INSIGHT and FRAMEWORK sections, add one short sentence of 6-10 words that creates a second tension or surprise. Examples:
- "But here's where most engineers stop."
- "The part nobody tells you:"
- "This is where it gets specific."
This keeps skimmers reading past the first scroll.
4. FRAMEWORK/STEPS: Use 3-5 numbered steps OR "• " bullets for the actionable takeaway. This is the save-trigger — make it reference-worthy.
5. IMPLICATION sentence: One sentence on why this matters NOW, not generically.

FRAMEWORK DEPTH RULE: Each bullet in the framework section must be 1.5–2 lines of text (not a single short sentence). Expand each point to include the "why it matters" in the same bullet. Example:
BAD: "• Visualize individual user actions from log data."
GOOD: "• Visualize individual user actions from log data — not aggregates. This lets you trace exactly what one user did without filtering out concurrent noise."
This increases dwell time and makes the section worth saving.

SAVE-TRIGGER RULE: At least one section must be structured as a numbered list or bullet sequence that a reader would bookmark. Avoid pure prose paragraphs — nobody saves prose.

GITHUB LINK RULE (CRITICAL for reach):
Do NOT include the GitHub URL in the post body. External links in post bodies reduce reach by ~60%.
Instead, end your post body with this exact line:
"🔗 Full breakdown + resources in the comments."

CTA — engineered for comment threads:
End with a question that FORCES a specific answer revealing the reader's situation. 
The best questions make the reader think "my answer to this is different from most people's."
FORMATS THAT WORK:
- "What's your current setup for X — [Option A] or something else entirely?"
- "How long did it take your team to realize [thing from article]?"  
- "Anyone else been burned by [specific pain from article] before switching?"
- Gold standard format: "How long were you [doing X the hard way] before someone showed you [Y]?"
FORMATS THAT DON'T (CRITICAL):
- "What's your primary bottleneck in X?" (This is a multiple-choice survey, not a provocation. It won't generate 15-word+ personal replies.)
- "What do you think?" (too vague)
- "Is X still viable in 2026?" (readiness survey)
- "Are you using X or Y?" (binary poll)
- NEVER ask "Is your X ready for Y?" — this is a readiness survey, not a provocation.
The question must be answerable in 2-3 sentences and make people want to share their specific experience. That's what generates 15-word+ comments the algorithm rewards.

=== ANTI-MID EXAMPLES (Study these — do NOT write like the BAD column) ===
BAD hook: "Here is a roundup of this week's best AI developer tools."
GOOD hook: "You've been wiring RAG evaluators by hand. Three frameworks now ship the scoring pipeline out of the box."

BAD body opener: "In this post, we'll explore why observability matters for LLM apps."
GOOD body opener: "Most teams still treat RAG failures like a prompt problem. The logs usually tell a different story."

BAD bullet: "• Use a vector database for retrieval."
GOOD bullet: "• Store embeddings in a dedicated vector DB — not your app Postgres. Query latency drops and you stop mixing OLTP traffic with similarity search."

BAD CTA: "What do you think about RAG evaluation?"
GOOD CTA: "How long did it take your team to catch a faithfulness regression before you had automated evals in CI?"

HASHTAGS:
Exactly 3-4 highly targeted hashtags on their own line at the very end. Mix exactly 1 broad + 2-3 niche. Do not overuse or add generic ones (e.g. use exactly 4 tags to prevent reach dilution).

=== BODY RULES (Strict) ===
- Sound like a senior engineer sharing a practical win.
- Remove any hype, flowery, or overly polished corporate language.
- Explicitly explain why the update matters for developers (performance, cost, workflow impact, etc.).
- Prefer concrete numbers and real usage claims over general statements.
- EMOJIS: Use 0–3 emojis maximum per post as visual anchors (e.g., at the start of the hook or as bullet replacements). Never use them as decoration or spam.
- @TAGGING: Tag 0–2 relevant people only (e.g., original content creators like @turtlesoupy or @Presidentlin). Never tag excessively or randomly.

=== ANTI-HYPE & VOICE RULES (STRICT) ===
You MUST strictly follow the anti-hype rules and avoid all banned words defined in the system prompt.
`;
  }

  buildFlexibleLinkedInPostRules(githubUrl, minLength = MIN_POST_LENGTH, maxLength = MAX_POST_LENGTH) {
    return `
=== 2026 LINKEDIN VIRALITY RULES (FLEXIBLE STRUCTURE) ===
BODY STRUCTURE — AI chooses the best fit:
- You are the copywriter. Pick ONE structure from the "Available Structures" list that best fits the hook, the manual points, and the topic.
- Vary the writing style: mix short punchy sentences (4-6 words) with longer technical explanations; avoid repeating the same sentence rhythm across paragraphs.
- Keep the post specific and save-worthy. Every paragraph should teach something or advance the reader's understanding.
- At least one section must be a numbered list or bullet framework that readers would bookmark. Pure prose dies.

MANUAL POINTS RULE (MOST IMPORTANT):
- The MANUAL POINTS listed below are the curated technical facts. They MUST be preserved in substance and accuracy.
- You may lightly reword for flow, but do NOT omit, soften, invent, or replace them with generic summaries.
- Do NOT add industry talking points, "data sovereignty", "cost-effectiveness", or other filler not present in the manual points.

GITHUB LINK RULE (CRITICAL for reach):
Do NOT include the GitHub URL in the post body. External links in post bodies reduce reach by ~60%.
Instead, end your post body with this exact line:
"🔗 Full breakdown + resources in the comments."

CTA — engineered for comment threads:
End with a question that FORCES a specific answer revealing the reader's situation.
The best questions make the reader think "my answer to this is different from most people's."
FORMATS THAT WORK:
- "What's your current setup for X — [Option A] or something else entirely?"
- "How long did it take your team to realize [thing from article]?"
- "Anyone else been burned by [specific pain from article] before switching?"
- "How long were you [doing X the hard way] before someone showed you [Y]?"
FORMATS THAT DON'T:
- "What's your primary bottleneck in X?" (survey)
- "What do you think?" (too vague)
- "Is X still viable in 2026?" (readiness survey)
- "Are you using X or Y?" (binary poll)
- NEVER ask "Is your X ready for Y?" — readiness survey, not provocation.

HASHTAGS:
Exactly 3-4 highly targeted hashtags on their own line at the very end. Mix exactly 1 broad + 2-3 niche.

=== BODY RULES ===
- Sound like a senior engineer casually sharing something useful.
- Avoid hype, flowery, or overly polished corporate language.
- Explicitly explain why the update matters for developers (performance, cost, workflow, correctness).
- Prefer concrete numbers and real usage claims over general statements.
- EMOJIS: Use 0–3 emojis maximum per post as visual anchors. Never decorate or spam.
- @TAGGING: Tag 0–2 relevant original creators only.

=== ANTI-HYPE & VOICE RULES (STRICT) ===
You MUST strictly follow the anti-hype rules and avoid all banned words defined in the system prompt.

Post length target: ${minLength}-${maxLength} characters total (including hook).
`;
  }

  async filterSubstantiveContent(items, retries = 3) {
    if (!items || items.length === 0) return [];

    try {
      const itemsText = items.map((item, idx) => {
        let text = `[Index ${idx}]\n`;
        if (typeof item === 'string') {
          text += item;
        } else if (Array.isArray(item)) {
          // It's a thread (array of tweets)
          text += item.map(t => t.text || "").join("\n");
        } else if (item.text) {
          // It's a post object or tweet object
          text += item.text;
        } else {
          text += JSON.stringify(item);
        }
        return text;
      }).join("\n\n---\n\n");

      const prompt = `
You are a senior developer and technical curator.

Analyze the list of content items below and filter out any items that are low-value noise, advertisements, self-promotional spam, hiring announcements, open/closed polls, generic marketing fluff, or motivational/career/lifestyle advice without real technical substance.

Only select items containing genuine, high-quality technical insights, software architecture lessons, programming guides, code snippets, or real tools/libraries/frameworks.

Content items:
${itemsText}

Return ONLY a valid raw JSON object. No markdown, no explanations, no commentary.

JSON schema:
{
  "substantiveIndices": array of substantive item indices (integers)
}
`;

      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          substantiveIndices: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.INTEGER }
          }
        },
        required: ["substantiveIndices"]
      };

      await this.checkRateLimit();
      const responseModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });
      const result = await responseModel.generateContent(prompt);
      const text = result.response.text().trim();
      const data = JSON.parse(text);

      if (!data || !Array.isArray(data.substantiveIndices)) {
        throw new Error("Invalid response format: missing substantiveIndices array");
      }
      return data.substantiveIndices;
    } catch (error) {
      logger.error("GeminiService: Error in filterSubstantiveContent:", error);
      if (retries > 0) {
        logger.warn(`Retrying filterSubstantiveContent in 15 seconds... (${retries} retries remaining)`);
        await sleep(15000);
        return this.filterSubstantiveContent(items, retries - 1);
      }
      // If all retries fail, fall back to returning all indices to not break the pipeline
      return items.map((_, idx) => idx);
    }
  }

  saveRecentTopic(topic) {
    try {
      const filePath = path.join(process.cwd(), "recent-topics.json");
      let recentTopics = [];
      if (fs.existsSync(filePath)) {
        recentTopics = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
      // Add topic to front, limit to last 10
      if (!recentTopics.includes(topic)) {
        recentTopics.unshift(topic);
        recentTopics = recentTopics.slice(0, 10);
        fs.writeFileSync(filePath, JSON.stringify(recentTopics, null, 2), "utf-8");
        logger.info(`Saved "${topic}" to recent LinkedIn topics history.`);
      }
    } catch (err) {
      logger.warn("Could not save recent topic:", err.message);
    }
  }

  saveRecentStructure(structureName) {
    try {
      if (!structureName || typeof structureName !== "string") return;
      const validNames = new Set(STRUCTURE_REGISTRY.map(s => s.name));

      // The model sometimes returns the structure label instead of the name.
      const matched = STRUCTURE_REGISTRY.find(s => s.name === structureName || s.label === structureName);
      const canonicalName = matched ? matched.name : structureName;
      if (!validNames.has(canonicalName)) return;

      const filePath = path.join(process.cwd(), "recent-structures.json");
      let recentStructures = [];
      if (fs.existsSync(filePath)) {
        recentStructures = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
      if (!Array.isArray(recentStructures)) recentStructures = [];

      // Normalize any legacy label entries to names and de-duplicate against the canonical name.
      recentStructures = recentStructures.map(s => {
        const entry = STRUCTURE_REGISTRY.find(r => r.name === s || r.label === s);
        return entry ? entry.name : s;
      }).filter(s => s !== canonicalName);
      recentStructures.unshift(canonicalName);
      recentStructures = recentStructures.slice(0, MAX_RECENT_STRUCTURES);
      fs.writeFileSync(filePath, JSON.stringify(recentStructures, null, 2), "utf-8");
      logger.info(`Saved "${canonicalName}" to recent LinkedIn structure history.`);
    } catch (err) {
      logger.warn("Could not save recent structure:", err.message);
    }
  }

  loadRecentStructures() {
    try {
      const filePath = path.join(process.cwd(), "recent-structures.json");
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      logger.warn("Could not load recent structures:", err.message);
    }
    return [];
  }

  buildStructureOptions(recentStructures = []) {
    const recentSet = new Set(
      (recentStructures || []).slice(0, 3).filter(Boolean).map(s => {
        const entry = STRUCTURE_REGISTRY.find(r => r.name === s || r.label === s);
        return entry ? entry.name : s;
      })
    );
    const preferred = STRUCTURE_REGISTRY.filter(s => !recentSet.has(s.name));
    const fallback = STRUCTURE_REGISTRY.filter(s => recentSet.has(s.name));
    const ordered = preferred.length > 0 ? [...preferred, ...fallback] : STRUCTURE_REGISTRY;

    return ordered.map((s, idx) => {
      const flag = recentSet.has(s.name) ? " [used recently — only pick if clearly best fit]" : "";
      return `${idx + 1}. ${s.label}${flag}\n   ${s.description}`;
    }).join("\n");
  }

  extractManualPoints(content) {
    if (!content) return [];
    const subArticles = content.split(/\n---\n/);
    const points = [];

    for (const sub of subArticles) {
      if (!sub.trim()) continue;
      const headerMatch = sub.match(/^###\s+(.+)$/m);
      const topic = headerMatch ? headerMatch[1].trim() : "Topic";

      const keyPointsMatch = sub.match(/Key Points:\s*([\s\S]*?)(?=🚀|🔗|---|$)/i);
      if (keyPointsMatch) {
        const lines = keyPointsMatch[1].split("\n").map(l => l.trim()).filter(l => l.startsWith("•"));
        for (const line of lines) {
          const clean = line.replace(/^•\s*/, "").trim();
          if (clean.length > 10) points.push(clean);
        }
      }

      const implMatch = sub.match(/(?:🚀\s*)?Implementation:\s*([\s\S]*?)(?=🔗|---|$)/i);
      if (implMatch) {
        const lines = implMatch[1].split("\n").map(l => l.trim()).filter(l => /^\d+\./.test(l));
        for (const line of lines) {
          const clean = line.replace(/^\d+\.\s*/, "").trim();
          if (clean.length > 10) points.push(clean);
        }
      }
    }

    // Resources are intentionally NOT treated as mandatory manual points because
    // they often contain generic placeholders or links. The GitHub URL is shared
    // in the first comment instead.

    // Deduplicate loosely by lowercased text and drop sentences that are too generic
    const GENERIC_POINT_PATTERNS = [
      /^tool name/i,
      /^brief description/i,
      /^https?:\/\//,
      /^\[.*\]\(.*\)\s*-\s*brief/i
    ];
    return Array.from(new Map(points.map(p => [p.toLowerCase(), p])).values())
      .filter(p => !GENERIC_POINT_PATTERNS.some(pattern => pattern.test(p)));
  }



  // Shared tokenizer used for coverage overlap. Keeps acronyms and short
  // symbolic tech terms (AI, RAG, SQL, LLM, API) even when ≤4 characters.
  tokenizeForCoverage(text) {
    if (!text) return [];

    const stopWords = new Set([
      "the", "a", "an", "is", "it", "are", "of", "to", "for", "in", "and", "or", "on", "with", "that", "this", "your",
      "you", "about", "they", "them", "their", "has", "have", "had", "been", "was", "were", "will", "would", "could",
      "should", "can", "may", "might", "must", "shall", "than", "more", "most", "some", "any", "such", "only", "just",
      "also", "even", "then", "now", "here", "there", "what", "when", "where", "which", "while", "how", "why", "who",
      "all", "each", "every", "both", "few", "many", "much", "other", "another", "same", "different", "own", "under",
      "over", "again", "further", "once", "way", "one", "two", "not", "but", "as", "at", "by", "from", "up", "down",
      "out", "if", "because", "through", "during", "before", "after", "above", "below", "between", "into", "onto",
      "off", "via", "per", "among", "within", "without", "around", "against", "toward", "towards", "across",
      "behind", "beyond", "beside", "besides", "except", "including", "regarding", "concerning", "following",
      "using", "given", "based", "made", "make", "making", "do", "does"
    ]);

    // Capture 2-4 uppercase acronyms/symbolic terms before lowercasing.
    const acronyms = (text.match(/\b[A-Z]{2,4}\b/g) || [])
      .map(w => w.toLowerCase())
      .filter(w => !stopWords.has(w));

    const words = text
      .replace(/'s\b/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w));

    return Array.from(new Set([...acronyms, ...words]));
  }

  getPointFingerprint(text) {
    return this.tokenizeForCoverage(text).join(" ");
  }

  measureManualPointCoverage(postText, manualPoints) {
    if (!postText || !manualPoints || manualPoints.length === 0) return { coverage: 1, missing: [] };

    const postLower = postText.toLowerCase();
    const missing = [];
    let covered = 0;
    let evaluated = 0;

    for (const point of manualPoints) {
      const keywords = this.tokenizeForCoverage(point);
      if (keywords.length === 0) continue;
      evaluated++;

      const matchCount = keywords.filter(w => {
        const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`\\b${escaped}\\b`).test(postLower);
      }).length;

      const ratio = matchCount / keywords.length;
      if (ratio >= 0.6) {
        covered++;
      } else {
        missing.push(point);
      }
    }

    // Only count points that actually contributed evaluable tokens.
    const coverage = evaluated > 0 ? covered / evaluated : 1;
    return { coverage, missing: missing.slice(0, 5) };
  }

  formatManualPoints(manualPoints) {
    if (!manualPoints || manualPoints.length === 0) return "(No explicit manual points extracted; derive directly from article text.)";
    return manualPoints.map((p, i) => `${i + 1}. ${p}`).join("\n");
  }

  splitArticlesIntoSubArticles(articles) {
    if (!Array.isArray(articles)) return [];
    const flattened = [];
    for (const art of articles) {
      if (!art || !art.fullContent) {
        flattened.push(art);
        continue;
      }
      const chunks = art.fullContent
        .split(/\n---\n/)
        .map(s => s.trim())
        .filter(s => s.length > 50);
      if (chunks.length <= 1) {
        flattened.push(art);
        continue;
      }
      for (let i = 0; i < chunks.length; i++) {
        const headerMatch = chunks[i].match(/^###\s+(.+)$/m);
        const header = headerMatch ? headerMatch[1].trim() : `Section ${i + 1}`;
        flattened.push({
          ...art,
          title: `${art.title}: ${header}`,
          fullContent: chunks[i]
        });
      }
    }
    return flattened;
  }

  extractSignificantWords(text) {
    const stopWords = new Set(["the", "a", "an", "is", "it", "are", "of", "to", "for", "in", "and", "or", "on", "with", "that", "this", "your", "you", "about", "they", "them", "their", "has", "have", "had", "been", "was", "were", "will", "would", "could", "should", "can", "may", "might", "must", "shall", "than", "more", "most", "some", "any", "such", "only", "just", "also", "even", "then", "now", "here", "there", "what", "when", "where", "which", "while", "how", "why", "who", "all", "each", "every", "both", "few", "many", "much", "other", "another", "same", "different", "own", "under", "over", "again", "further", "once", "way", "one", "two"]);
    return text.toLowerCase().replace(/'s\b/g, "").replace(/[^a-z0-9]/g, " ").split(/\s+/).map(w => w.trim()).filter(w => w.length > 3 && !stopWords.has(w));
  }

  filterManualPointsByHook(manualPoints, hookText) {
    if (!manualPoints || manualPoints.length === 0 || !hookText) return manualPoints || [];
    const hookWords = this.extractSignificantWords(hookText);
    if (hookWords.length === 0) return manualPoints;

    return manualPoints.filter(point => {
      const pointWords = this.extractSignificantWords(point);
      if (pointWords.length === 0) return false;
      const overlap = pointWords.filter(w => hookWords.includes(w)).length;
      const ratio = overlap / pointWords.length;
      // Require a meaningful overlap: at least two shared distinctive words, or
      // one very central word in a short point, or 25% of the point's words.
      return overlap >= 2 || (overlap === 1 && pointWords.length <= 5) || ratio >= 0.25;
    });
  }

  countSourceBullets(content) {
    if (!content) return 0;
    const lines = content.split("\n");
    const bulletMatches = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith("•") ||
        (trimmed.startsWith("-") && trimmed.length > 3) ||  // exclude ---
        (trimmed.startsWith("*") && trimmed.length > 1) ||
        /^\d+\./.test(trimmed);
    });
    return bulletMatches.length;
  }

  hasSubstantiveBullets(content) {
    if (!content) return false;
    const lines = content.split("\n");
    const bullets = lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith("•") || trimmed.startsWith("-") || trimmed.startsWith("*") || /^\d+\./.test(trimmed);
    });

    const substantive = bullets.filter(b => {
      const text = b.trim();
      return /\d+/.test(text) ||                 // has a number
        /[A-Z][a-z]+[A-Z]/.test(text) ||    // has a CamelCase tool name (e.g. Ollama, GooglePhotos)
        text.length > 80;                   // is detailed enough
    });

    return substantive.length >= 2;
  }

  extractKeyPoints(content) {
    if (!content) return "";
    const subArticles = content.split(/\n---\n/);
    return subArticles.map((sub, idx) => {
      const headerMatch = sub.match(/###\s+.+$/m);
      const header = headerMatch ? headerMatch[0] : `### Sub-Article #${idx + 1}`;

      const keyPointsMatch = sub.match(/Key Points:\s*([\s\S]*?)(?=🚀|🔗|---|$)/i);
      const keyPoints = keyPointsMatch ? keyPointsMatch[1].replace(/^\n+/, "").trim() : "";

      const implMatch = sub.match(/(?:🚀\s*)?Implementation:\s*([\s\S]*?)(?=🔗|---|$)/i);
      const implementation = implMatch ? implMatch[1].replace(/^\n+/, "").trim() : "";

      let formatted = `${header}\n`;
      if (keyPoints) formatted += `Key Points:\n${keyPoints}\n\n`;
      if (implementation) formatted += `Implementation:\n${implementation}`;
      return formatted.trim();
    }).filter(s => s.length > 50).join("\n\n---\n\n");
  }

  extractFrameworkBullets(postText) {
    if (!postText) return [];
    return postText.split("\n").filter(line => {
      const trimmed = line.trim();
      return trimmed.startsWith("•") ||
        trimmed.startsWith("-") ||
        trimmed.startsWith("*") ||
        trimmed.startsWith(">") ||
        /^\d+[\.\)]/.test(trimmed) ||
        /^\(\d+\)[\.\)]?/.test(trimmed) ||
        /^[a-zA-Z][\.\)]/.test(trimmed);
    });
  }

  hasRehook(postText) {
    if (!postText) return false;

    const rehookPatterns = [
      /^but here'?s/i,
      /^the part nobody/i,
      /^this is where/i,
      /^here'?s the (?:catch|twist|part)/i,
      /^most engineers stop/i,
      /^nobody tells you/i,
      /^that'?s not the real/i,
    ];

    const paragraphs = postText.split("\n\n").map(p => p.trim()).filter(p => p.length > 0);
    for (let i = 1; i < paragraphs.length - 1; i++) {
      const paragraph = paragraphs[i];
      const wordCount = paragraph.split(/\s+/).length;
      const sentenceCount = paragraph.split(/[.!?]/).filter(s => s.trim()).length;
      if (
        wordCount >= 4 &&
        wordCount <= 14 &&
        sentenceCount <= 2 &&
        !paragraph.startsWith("•") &&
        !/^#/.test(paragraph) &&
        !paragraph.includes("→") &&
        !paragraph.endsWith("?")
      ) {
        if (rehookPatterns.some(pattern => pattern.test(paragraph))) {
          return true;
        }
        if (wordCount >= 6 && wordCount <= 12 && sentenceCount === 1) {
          return true;
        }
      }
    }
    return false;
  }

  getCtaQuestion(postText) {
    const paragraphs = postText.split("\n\n").map(p => p.trim()).filter(p => p.length > 0);
    for (let i = paragraphs.length - 1; i > 0; i--) {
      const paragraph = paragraphs[i];
      if (paragraph.startsWith("#")) continue;
      if (paragraph.includes("→")) continue;
      if (paragraph.endsWith("?")) return paragraph;
    }

    // Fallback: search within the body only (skip the hook, which is separated by a blank line).
    const firstBlank = postText.indexOf("\n\n");
    const bodyText = firstBlank >= 0 ? postText.slice(firstBlank + 2) : postText;
    const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (line.startsWith("#")) continue;
      if (line.includes("→")) continue;
      if (line.endsWith("?")) return line;
    }
    return "";
  }

  scorePostQuality(postData, sourceBulletCount = 0, manualPoints = []) {
    const postText = postData.postText || "";
    const hook = postText.split("\n\n")[0] || "";
    const bodyWithoutHook = postText.slice(hook.length).trim();
    let score = 100;
    const issues = [];
    let bonusPoints = 0;
    let penaltyPoints = 0;

    const coverage = this.measureManualPointCoverage(bodyWithoutHook, manualPoints);
    if (manualPoints && manualPoints.length > 0) {
      if (coverage.coverage >= 0.8) {
        bonusPoints += 10;
      } else if (coverage.coverage >= 0.6) {
        bonusPoints += 5;
      } else if (coverage.coverage >= 0.4) {
        penaltyPoints += 15;
        issues.push(`Manual point coverage is weak (${Math.round(coverage.coverage * 100)}% preserved)`);
      } else {
        penaltyPoints += 30;
        issues.push(`Manual point coverage too low (${Math.round(coverage.coverage * 100)}% preserved); missing: ${coverage.missing.slice(0, 2).join("; ")}`);
      }
    }

    const foundBannedInPost = BANNED_WORDS.filter(word => {
      const regex = this.buildBannedWordRegex(word);
      return regex && regex.test(postText);
    });
    if (foundBannedInPost.length > 0) {
      penaltyPoints += 25;
      issues.push(`Banned word(s) found: ${foundBannedInPost.join(", ")}`);
    }

    const hashtagMatches = postText.match(/#[a-zA-Z0-9]+/g) || [];
    const hashtagCount = hashtagMatches.length;
    if (hashtagCount < 3 || hashtagCount > 4) {
      penaltyPoints += 15;
      issues.push(`Invalid number of hashtags: found ${hashtagCount} (expected 3-4)`);
    } else {
      bonusPoints += 5;
    }

    if (postText.length < MIN_POST_LENGTH) {
      penaltyPoints += 30;
      issues.push(`Post too short (${postText.length} chars, target ${MIN_POST_LENGTH}-${MAX_POST_LENGTH})`);
    } else if (postText.length > MAX_POST_LENGTH) {
      penaltyPoints += 20;
      issues.push(`Post too long (${postText.length} chars)`);
    } else if (postText.length >= 1400 && postText.length <= 1900) {
      bonusPoints += 10;
    }

    const frameworkBullets = this.extractFrameworkBullets(bodyWithoutHook);
    if (frameworkBullets.length < 3) {
      penaltyPoints += 35;
      issues.push(`Framework section too thin (${frameworkBullets.length} bullets/steps, need 3+)`);
    } else {
      bonusPoints += 10;
    }

    const avgBulletLength = frameworkBullets.length > 0
      ? frameworkBullets.reduce((sum, bullet) => sum + bullet.trim().length, 0) / frameworkBullets.length
      : 0;
    if (avgBulletLength < 70) {
      penaltyPoints += 30;
      issues.push(`Framework bullets too shallow (avg ${Math.round(avgBulletLength)} chars, need 70+)`);
    } else if (avgBulletLength >= 100) {
      bonusPoints += 10;
    }

    if (!this.hasRehook(bodyWithoutHook)) {
      penaltyPoints += 12;
      issues.push("Missing rehook sentence between insight and framework");
    }

    const proseParagraphs = bodyWithoutHook.split("\n\n").filter(p => {
      const trimmed = p.trim();
      return trimmed.length > 0 &&
        !trimmed.startsWith("•") &&
        !/^\d+\./.test(trimmed) &&
        !trimmed.startsWith("#") &&
        !trimmed.includes("→") &&
        !trimmed.endsWith("?");
    });
    if (proseParagraphs.length < 1) {
      penaltyPoints += 25;
      issues.push("Needs at least 1 substantive prose paragraph before the framework");
    } else if (proseParagraphs.length < 2) {
      penaltyPoints += 8;
      issues.push("Consider adding a second prose paragraph for rhythm (optional depending on structure)");
    }

    const cta = this.getCtaQuestion(postText);
    if (!cta) {
      penaltyPoints += 25;
      issues.push("Missing provocative CTA question");
    } else {
      for (const pattern of WEAK_CTA_PATTERNS) {
        if (pattern.test(cta)) {
          penaltyPoints += 30;
          issues.push(`Weak survey-style CTA: "${cta}"`);
          break;
        }
      }
      if (cta.split(/\s+/).length < 8) {
        penaltyPoints += 10;
        issues.push("CTA question is too short to provoke a personal story");
      }
    }

    for (const pattern of MID_QUALITY_PATTERNS) {
      if (pattern.test(postText)) {
        penaltyPoints += 25;
        issues.push("Contains generic mid-quality filler phrasing");
        break;
      }
    }

    if (!bodyWithoutHook.includes("🔗 Full breakdown + resources in the comments.")) {
      penaltyPoints += 15;
      issues.push('Missing required link line: "🔗 Full breakdown + resources in the comments."');
    }

    if (hook.length >= 100 && hook.length <= 180) {
      bonusPoints += 8;
    }

    if (sourceBulletCount > 0 && !this.hasSubstantiveBullets(bodyWithoutHook)) {
      penaltyPoints += 15;
      issues.push("Framework lacks concrete technical detail from source content");
    }

    const total = Math.max(0, Math.min(120, score + bonusPoints - penaltyPoints));

    return {
      score: total,
      issues,
      bonusPoints,
      penaltyPoints
    };
  }

  validatePostText(postData, githubUrl, sourceBulletCount = 0, manualPoints = []) {
    const errors = [];
    const postText = postData.postText || "";

    const allText = [
      postData.postText || "",
      postData.slideTagline || "",
      ...(postData.slidePoints || []),
      postData.title || ""
    ].join(" ");

    const githubUrlPatterns = [
      /github\.com/i,
      /https?:\/\/github/i
    ];
    for (const pattern of githubUrlPatterns) {
      if (pattern.test(postText)) {
        errors.push("GitHub URL is present in the post text body (violates external link reach rule)");
        break;
      }
    }

    if (!postData.commentText) {
      errors.push("commentText is missing or empty");
    } else if (githubUrl && githubUrl.includes("github.com") && !postData.commentText.includes(githubUrl)) {
      errors.push("commentText does not contain the GitHub URL for the resource link");
    }

    const foundBanned = BANNED_WORDS.filter(word => {
      const regex = this.buildBannedWordRegex(word);
      return regex && regex.test(allText);
    });
    if (foundBanned.length > 0) {
      errors.push(`Banned word(s) found: ${foundBanned.join(", ")}`);
    }

    const hook = postText.split("\n\n")[0] || "";
    if (hook.length > 200) {
      errors.push(`Hook exceeds 200 characters (${hook.length} characters)`);
    }

    const bodyWithoutHook = postText.slice(hook.length).trim();
    const coverage = this.measureManualPointCoverage(bodyWithoutHook, manualPoints);
    if (manualPoints && manualPoints.length > 0 && coverage.coverage < 0.6) {
      errors.push(`Manual point coverage too low (${Math.round(coverage.coverage * 100)}% of ${manualPoints.length} points). Missing or weak on: ${coverage.missing.slice(0, 3).join("; ")}`);
    }

    const hashtagMatches = postText.match(/#[a-zA-Z0-9]+/g) || [];
    const hashtagCount = hashtagMatches.length;
    if (hashtagCount < 3 || hashtagCount > 4) {
      errors.push(`Invalid number of hashtags: found ${hashtagCount} (expected 3-4)`);
    }

    const paragraphs = postText.split("\n\n").filter(p => {
      const trimmed = p.trim();
      return trimmed.length > 0 &&
        !trimmed.startsWith("#") &&
        !trimmed.toLowerCase().includes("full breakdown") &&
        !trimmed.endsWith("?");
    });

    // Padding vs. source bullet count and hook/body lexical overlap are surfaced
    // only in the quality score, not as hard validation errors, because good posts
    // legitimately expand ideas beyond the source bullet count and naturally echo
    // the hook topic in the first body paragraph.

    if (postText.length < MIN_POST_LENGTH) {
      errors.push(`Post too short: ${postText.length} characters (minimum ${MIN_POST_LENGTH})`);
    }
    if (postText.length > MAX_POST_LENGTH) {
      errors.push(`Post too long: ${postText.length} characters (maximum ${MAX_POST_LENGTH})`);
    }

    const frameworkBullets = this.extractFrameworkBullets(bodyWithoutHook);
    if (frameworkBullets.length < 3) {
      errors.push(`Framework section must have at least 3 bullets/steps (found ${frameworkBullets.length})`);
    }

    const avgBulletLength = frameworkBullets.length > 0
      ? frameworkBullets.reduce((sum, bullet) => sum + bullet.trim().length, 0) / frameworkBullets.length
      : 0;
    if (frameworkBullets.length > 0 && avgBulletLength < 70) {
      errors.push(`Framework bullets are too shallow (avg ${Math.round(avgBulletLength)} chars, need 70+)`);
    }

    // Rehook is encouraged but not a hard gate — it is already penalized in the quality score.

    const cta = this.getCtaQuestion(postText);
    if (!cta) {
      errors.push("Missing CTA question at the end of the post");
    } else {
      for (const pattern of WEAK_CTA_PATTERNS) {
        if (pattern.test(cta)) {
          errors.push(`Weak survey-style CTA detected: "${cta}"`);
          break;
        }
      }
    }

    for (const pattern of MID_QUALITY_PATTERNS) {
      if (pattern.test(postText)) {
        errors.push("Generic mid-quality filler phrasing detected in post");
        break;
      }
    }

    if (!bodyWithoutHook.includes("🔗 Full breakdown + resources in the comments.")) {
      errors.push('Missing required line: "🔗 Full breakdown + resources in the comments."');
    }

    const quality = this.scorePostQuality(postData, sourceBulletCount, manualPoints);
    if (quality.score < MIN_QUALITY_SCORE) {
      errors.push(`Quality score too low: ${quality.score}/${MIN_QUALITY_SCORE} (penalties: -${quality.penaltyPoints}, bonuses: +${quality.bonusPoints})`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      qualityScore: quality.score,
      qualityIssues: quality.issues
    };
  }

  scoreHooks(candidates) {
    return candidates.map(c => {
      let score = 100;
      const hookText = c.hook || "";
      const hookLower = hookText.toLowerCase();

      const hasTensionSignal =
        hookLower.includes("you've been") ||
        hookLower.includes("you have been") ||
        hookLower.includes("instead of") ||
        hookLower.includes("wrong") ||
        hookLower.includes("unnecessary") ||
        hookLower.includes("stop ") ||
        hookLower.includes("never ") ||
        /\d/.test(hookText) ||
        hookLower.includes("?") ||
        hookLower.includes("...");

      const weakStartPatterns = [
        /^here is/i,
        /^this week/i,
        /^introducing/i,
        /^launched:/i,
        /^announced:/i,
        /^released:/i
      ];

      for (const pattern of weakStartPatterns) {
        if (pattern.test(hookText)) {
          score -= 45;
          break;
        }
      }

      const announcementPatterns = [
        /^[a-z0-9_\-\s]+ just launched/i,
        /^[a-z0-9_\-\s]+ just announced/i,
        /^[a-z0-9_\-\s]+ just released/i,
        /^[a-z0-9_\-\s]+ just updated/i,
        /^[a-z0-9_\-\s]+ has launched/i,
        /^[a-z0-9_\-\s]+ has announced/i,
        /^[a-z0-9_\-\s]+ has released/i,
      ];

      for (const pattern of announcementPatterns) {
        if (pattern.test(hookText) && !hasTensionSignal) {
          score -= 35;
          break;
        }
      }

      const resolutionPatterns = [
        /\.\s+it'?s\s+(the answer|here|built|created|designed|made|done|solved|fixed)/i,
        /\.\s+the answer is/i,
        /\?\s+it'?s\s+(actually|simply|just|really|all about)/i,
        /\.\s+here'?s (how|what|the|a)/i,
        /picture this\.?\s+it'?s/i,
      ];
      for (const pattern of resolutionPatterns) {
        if (pattern.test(hookText)) {
          score -= 35;
          break;
        }
      }

      if (hookLower.includes("you've been") || hookLower.includes("you have been")) score += 18;
      if (hookLower.includes("instead of")) score += 15;
      if (hookLower.includes("why ") || hookLower.includes("how ")) score += 12;
      if (hookLower.includes("stop ") || hookLower.includes("never ")) score += 15;
      if (hookLower.includes("unnecessary") || hookLower.includes("wrong")) score += 15;
      if (hookLower.includes("?") || hookLower.includes("...")) score += 10;
      if (/\d/.test(hookText)) score += 12;

      if (hookText.length > 200) {
        score -= 50;
      } else if (hookText.length < 80) {
        score -= 25;
      } else if (hookText.length >= 100 && hookText.length <= 180) {
        score += 15;
      }

      for (const pattern of MID_QUALITY_PATTERNS) {
        if (pattern.test(hookText)) {
          score -= 30;
          break;
        }
      }

      const bannedInHook = BANNED_WORDS.filter(word => {
        const regex = this.buildBannedWordRegex(word);
        return regex && regex.test(hookText);
      });
      if (bannedInHook.length > 0) {
        score -= 40;
      }

      return {
        ...c,
        score,
        bannedWords: bannedInHook
      };
    }).sort((a, b) => b.score - a.score);
  }

  async generateMarkdown(threads, retries = 3) {
    try {
      if (!threads || threads.length === 0) {
        logger.warn("No threads provided to generateMarkdown.");
        return "";
      }

      let combinedPrompt = "";
      const exampleFormat = `
      Example of perfect formatting (You have to create one for each Tweet):

      ---
      ### 🤖 Observability, Evaluation, and RAG Implementation

      This article outlines the differences between analytics and observability, explains the components needed for a Retrieval Augmented Generation (RAG) system, and provides implementation guidance.

      Key Points:
      • Analytics provides high-level metrics like user counts and page views.

      • Observability offers deeper insights into individual user requests and responses.

      • A basic RAG system requires an inference provider and a vector database.


      🚀 Implementation:
      1. Choose an Inference Provider: Select a service that provides the necessary AI model.
      2. Select a Vector Database: Choose a database suitable for storing embeddings.
      3. Develop Retrieval Logic: Implement logic to retrieve relevant information.

      🔗 Resources:

      • [Tool Name](https://example.com) - Brief description of the tool

      ![Image](https://example.png) 
      `;

      const groupedThreads = this.groupTweetsByConversation(
        threads.flatMap((thread) => thread.tweets)
      );

      // Perform pre-filtering (Gap 1)
      logger.info(`GeminiService: Pre-filtering ${groupedThreads.length} X threads...`);
      const substantiveIndices = await this.filterSubstantiveContent(groupedThreads);
      const filteredThreads = groupedThreads.filter((_, idx) => substantiveIndices.includes(idx));

      if (filteredThreads.length === 0) {
        logger.warn("GeminiService: All threads filtered out as non-substantive.");
        return "";
      }

      logger.info(`GeminiService: Processing ${filteredThreads.length} substantive X threads...`);

      for (const threadTweets of filteredThreads) {
        let threadContent = "";
        threadContent += `[Type: ${threadTweets.type || 'thread'}]\n`;

        for (const tweet of threadTweets) {
          let content = tweet.text || "";

          if (tweet.images && tweet.images.length > 0) {
            content +=
              "\n\n" + tweet.images.map((img) => `![Image](${img})`).join("\n");
          }
          if (tweet.links && tweet.links.length > 0) {
            content += "\n\nLinks:\n" + tweet.links.join("\n");
          }

          threadContent += content + "\n\n---\n\n";
        }

        combinedPrompt += threadContent;
      }

      logger.info("GeminiService: Combined prompt built, sending to API...");

      const prompt = `
Transform each of the provided Twitter threads/conversations into high-quality, professional technical markdown articles.

Note: Some items are single tweets (Type: tweet) and others are multi-tweet threads (Type: thread). Single tweets should be summarized concisely as single-concept updates, whereas multi-tweet threads can be expanded into more detailed structured articles if they contain enough depth.

Follow ALL rules from the SYSTEM_PROMPT (banned words, senior-engineer tone, sentence variance, no hype).

Use this exact structure for every article:

### [ONE emoji] Main Topic - Subtopic

[2-3 sentence introduction — no emojis, no marketing language]

Key Points:

• Point one (single line, no emojis, no bold, no italic)

• Point two (single line, no emojis, no bold, no italic)

🚀 Implementation:          (only if applicable)
1. Step one
2. Step two

🔗 Resources:               (only if verified links or images exist in the source)
• [Tool Name](url) - Brief description (max 10 words, no colons inside descriptions)
![Image](url)

Strict rules:
- Exact spacing with double newlines between Key Points (bullet points starting with "•").
- Maximum 3-5 Key Points and 3-5 Implementation steps.
- Only use verified links and images directly present in the source text.
- No bold, italic, extra emojis, or extra sections.
- Make one formatted article for each thread/conversation provided.
- Do not repeat content or links within a single article.
- Separate distinct articles with "---" and a newline.

Content to process:
${combinedPrompt}

Example format to match exactly:
${exampleFormat}
`;

      try {
        await this.checkRateLimit();
        const result = await model.generateContent(prompt);
        let generatedText = result.response.text();
        logger.info("GeminiService: Markdown generated successfully.");

        generatedText = generatedText
          .replace(/```markdown/g, "")
          .replace(/```/g, "")
          .trim();

        generatedText = generatedText.replace(/^---\s*\n/, "");

        const supportSection = `
---

### ⭐️ Support

If you liked reading this report, please star ⭐️ this repository and follow me on [Github](https://github.com/Drix10), [𝕏 (previously known as Twitter)](https://x.com/DRIX_10_) to help others discover these resources and regular updates.

---`;

        return (
          generatedText.replace(/\n---\n\s*$/g, "").trim() +
          "\n\n" +
          supportSection
        );
      } catch (error) {
        logger.error("GeminiService: generateMarkdown API error:", error);
        if (retries > 0) {
          logger.warn(
            `error, retrying in 60 seconds... (${retries} retries remaining)`
          );
          await sleep(60000);
          return this.generateMarkdown(threads, retries - 1);
        }
        logger.error("Failed to generate content:", error);
        throw error;
      }
    } catch (error) {
      logger.error("Error in markdown generation:", error);
      throw error;
    }
  }

  async generateMarkdownFromCombined(threads, linkedinPosts, retries = 3) {
    try {
      if ((!threads || threads.length === 0) && (!linkedinPosts || linkedinPosts.length === 0)) {
        logger.warn("No content provided to generateMarkdownFromCombined.");
        return "";
      }

      let filteredGroupedThreads = [];
      if (threads && threads.length > 0) {
        const groupedThreads = this.groupTweetsByConversation(
          threads.flatMap((thread) => thread.tweets)
        );
        logger.info(`GeminiService: Pre-filtering ${groupedThreads.length} X threads...`);
        const threadIndices = await this.filterSubstantiveContent(groupedThreads);
        filteredGroupedThreads = groupedThreads.filter((_, idx) => threadIndices.includes(idx));
      }

      let filteredLinkedinPosts = [];
      if (linkedinPosts && linkedinPosts.length > 0) {
        logger.info(`GeminiService: Pre-filtering ${linkedinPosts.length} LinkedIn posts...`);
        const postIndices = await this.filterSubstantiveContent(linkedinPosts);
        filteredLinkedinPosts = linkedinPosts.filter((_, idx) => postIndices.includes(idx));
      }

      if (filteredGroupedThreads.length === 0 && filteredLinkedinPosts.length === 0) {
        logger.warn("GeminiService: All threads and LinkedIn posts filtered out as non-substantive.");
        return "";
      }

      let combinedPrompt = "";

      if (filteredGroupedThreads.length > 0) {
        combinedPrompt += "--- TWITTER/X THREADS ---\n\n";
        for (const threadTweets of filteredGroupedThreads) {
          let threadContent = "";
          threadContent += `[Type: ${threadTweets.type || 'thread'}]\n`;
          for (const tweet of threadTweets) {
            let content = tweet.text || "";
            if (tweet.images && tweet.images.length > 0) {
              content += "\n\n" + tweet.images.map((img) => `![Image](${img})`).join("\n");
            }
            if (tweet.links && tweet.links.length > 0) {
              content += "\n\nLinks:\n" + tweet.links.join("\n");
            }
            threadContent += content + "\n\n---\n\n";
          }
          combinedPrompt += threadContent;
        }
      }

      if (filteredLinkedinPosts.length > 0) {
        combinedPrompt += "--- LINKEDIN POSTS ---\n\n";
        for (const post of filteredLinkedinPosts) {
          let content = `Post by ${post.author || "Unknown"}:\n${post.text || ""}`;
          if (post.images && post.images.length > 0) {
            content += "\n\n" + post.images.map((img) => `![Image](${img})`).join("\n");
          }
          if (post.links && post.links.length > 0) {
            content += "\n\nLinks:\n" + post.links.join("\n");
          }
          combinedPrompt += content + "\n\n---\n\n";
        }
      }

      const exampleFormat = `
      Example of perfect formatting (You have to create one for each resource/thread):

      ---
      ### 🤖 Observability, Evaluation, and RAG Implementation

      This article outlines the differences between analytics and observability, explains the components needed for a Retrieval Augmented Generation (RAG) system, and provides implementation guidance.

      Key Points:
      • Analytics provides high-level metrics like user counts and page views.

      • Observability offers deeper insights into individual user requests and responses.

      • A basic RAG system requires an inference provider and a vector database.


      🚀 Implementation:
      1. Choose an Inference Provider: Select a service that provides the necessary AI model.
      2. Select a Vector Database: Choose a database suitable for storing embeddings.
      3. Develop Retrieval Logic: Implement logic to retrieve relevant information.

      🔗 Resources:

      • [Tool Name](https://example.com) - Brief description of the tool

      ![Image](https://example.png) 
      `;

      const prompt = `
Transform the following Twitter threads and LinkedIn posts into high-quality, professional technical markdown articles.

Note: Some Twitter threads are single tweets (Type: tweet) and others are multi-tweet threads (Type: thread). Single tweets should be summarized concisely as single-concept updates, whereas multi-tweet threads can be expanded into more detailed structured articles if they contain enough depth.

Follow ALL rules from the SYSTEM_PROMPT (banned words, senior-engineer tone, sentence variance, no hype).

Use this exact structure for every article:

### [ONE emoji] Main Topic - Subtopic

[2-3 sentence introduction — no emojis, no marketing language]

Key Points:

• Point one (single line, no emojis, no bold, no italic)

• Point two (single line, no emojis, no bold, no italic)

🚀 Implementation:          (only if applicable)
1. Step one
2. Step two

🔗 Resources:               (only if verified links or images exist in the source)
• [Tool Name](url) - Brief description (max 10 words, no colons inside descriptions)
![Image](url)

Strict rules:
- Exact spacing with double newlines between Key Points (bullet points starting with "•").
- Maximum 3-5 Key Points and 3-5 Implementation steps.
- Only use verified links and images directly present in the source text.
- No bold, italic, extra emojis, or extra sections.
- Make one formatted article for each high-quality content item provided.
- Do not repeat content or links within a single article.
- Separate distinct articles with "---" and a newline.

Content to process:
${combinedPrompt}

Example format to match exactly:
${exampleFormat}
`;

      try {
        await this.checkRateLimit();
        const result = await model.generateContent(prompt);
        let generatedText = result.response.text();

        generatedText = generatedText
          .replace(/```markdown/g, "")
          .replace(/```/g, "")
          .trim();

        generatedText = generatedText.replace(/^---\s*\n/, "");

        const supportSection = `
---

### ⭐️ Support

If you liked reading this report, please star ⭐️ this repository and follow me on [Github](https://github.com/Drix10), [𝕏 (previously known as Twitter)](https://x.com/DRIX_10_) to help others discover these resources and regular updates.

---`;

        return (
          generatedText.replace(/\n---\n\s*$/g, "").trim() +
          "\n\n" +
          supportSection
        );
      } catch (error) {
        logger.error("GeminiService: generateMarkdownFromCombined API error:", error);
        if (retries > 0) {
          logger.warn(`error combined generation, retrying in 60 seconds... (${retries} retries remaining)`);
          await sleep(60000);
          return this.generateMarkdownFromCombined(threads, linkedinPosts, retries - 1);
        }
        logger.error("Failed to generate combined markdown content:", error);
        throw error;
      }
    } catch (error) {
      logger.error("Error in combined markdown generation:", error);
      throw error;
    }
  }

  async generateLinkedInSummaryPost(threads, linkedinPosts, githubUrl, retries = 3) {
    try {
      let combinedPrompt = "";

      if (threads && threads.length > 0) {
        combinedPrompt += "--- TWITTER/X THREADS ---\n\n";
        threads.forEach((t, i) => {
          combinedPrompt += `Item #${i + 1} (X):\n${t.tweets ? t.tweets.map(tweet => tweet.text).join("\n") : t.url}\n`;
          if (t.tweets) {
            t.tweets.forEach(tweet => {
              if (tweet.images) combinedPrompt += tweet.images.map(img => `Image: ${img}\n`).join("");
            });
          }
          combinedPrompt += "\n";
        });
      }

      if (linkedinPosts && linkedinPosts.length > 0) {
        combinedPrompt += "--- LINKEDIN POSTS ---\n\n";
        linkedinPosts.forEach((post, i) => {
          combinedPrompt += `Item #${i + 1} (LinkedIn) by ${post.author}:\n${post.text}\n`;
          if (post.images) combinedPrompt += post.images.map(img => `Image: ${img}\n`).join("");
          combinedPrompt += "\n";
        });
      }

      const postRules = this.buildLinkedInPostRules(githubUrl, true);

      const prompt = `
You are a world-class technical LinkedIn copywriter for developer and AI audiences.

Write ONE high-engagement summary post from the scraped content. Drive traffic to GitHub.

GitHub URL: ${githubUrl}

Content:
${combinedPrompt}

${postRules}

Return ONLY a valid raw JSON object. No markdown, no explanations.

JSON schema:
{
  "postText": string (full formatted post with proper newlines (use \\n)),
  "imageToAttach": string or null (best image URL from content or null)
}
`;

      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          postText: { type: SchemaType.STRING },
          imageToAttach: { type: SchemaType.STRING, nullable: true }
        },
        required: ["postText"]
      };

      try {
        await this.checkRateLimit();
        const responseModel = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
          }
        });
        const result = await responseModel.generateContent(prompt);
        let text = result.response.text().trim();

        const data = JSON.parse(text);
        if (!data.postText) {
          throw new Error("Invalid response format: missing postText");
        }
        return data;
      } catch (error) {
        logger.error("GeminiService: JSON parsing error in generateLinkedInSummaryPost:", error);
        if (retries > 0) {
          logger.warn(`error in summary generation, retrying in 30 seconds... (${retries} retries remaining)`);
          await sleep(30000);
          return this.generateLinkedInSummaryPost(threads, linkedinPosts, githubUrl, retries - 1);
        }
        throw error;
      }
    } catch (error) {
      logger.error("Error in generateLinkedInSummaryPost:", error);
      throw error;
    }
  }

  async selectBestArticlesForLinkedIn(articles, recentTopics = [], retries = 3) {
    try {
      if (!recentTopics || recentTopics.length === 0) {
        try {
          const filePath = path.join(process.cwd(), "recent-topics.json");
          if (fs.existsSync(filePath)) {
            const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            if (Array.isArray(parsed)) {
              recentTopics = parsed;
            }
          }
        } catch (err) {
          logger.warn("Could not read recent-topics.json:", err.message);
        }
      }

      let recentTopicsText = "";
      if (Array.isArray(recentTopics) && recentTopics.length > 0) {
        recentTopicsText = `\n=== RECENTLY POSTED TOPICS ===\n` +
          recentTopics.map(t => `- ${t}`).join("\n") +
          `\n(CRITICAL: Actively AVOID selecting articles that cover similar topics to those recently posted to maintain high diversity in content categories.)\n`;
      }

      const list = articles.map((art, idx) => {
        const subArticles = (art.fullContent || "")
          .split(/\n---\n/)
          .filter(s => s.trim().length > 50)
          .map(s => s.trim().slice(0, 250))
          .join(" | ");
        return `[Index ${idx}] Folder: "${art.title}"\nArticles inside: ${subArticles}`;
      }).join("\n\n");
      const prompt = `
You are a top-tier senior tech content strategist with deep expertise in LinkedIn growth for developer and AI audiences.

Your task: Analyze the list of curated tech articles below and select the single BEST article (or at most two if they are highly complementary) to write a high-engagement, scroll-stopping LinkedIn post.

=== 2026 ENGAGEMENT & SELECTION CRITERIA ===
1. HIGH-SIGNAL CONTENT (VERY HIGH WEIGHT) — Prioritize articles with concrete numbers, benchmarks, pricing, speed claims, real usage data, or direct comparisons. Avoid generic "updates" or broad roundups unless they contain strong quantifiable claims.
2. ACTIONABILITY & UTILITY (HIGH WEIGHT) — Can a developer or engineer immediately use, bookmark, or apply this? Curations, tools, frameworks, and practical guidebooks perform best.
3. STORYTELLING & CURIOSITY GAP — Does this topic have a high storytelling potential? Is there a surprising benchmark, an elegant architecture design, or a contrarian take we can hook readers with?
4. TRENDING COMMUNITY RELEVANCE — Is this topic highly relevant and trending in AI, LLM, devops, or software engineering circles?
5. AVOID ADVERTISING & SPAM — Completely avoid selecting job postings, generic announcements, polls, or motivational/career fluff.
6. REJECT THIN CONTENT — Never select articles that describe a single minor UI/UX update, a feature toggle, or a cosmetic change to an existing platform with no architectural, performance, or cost implications. If the entire substance can be summarized in one sentence, it's not post-worthy on its own. Completely reject changelog/feature-announcement content that has no developer workflow impact beyond "it's slightly more convenient now."

${recentTopicsText}
Articles list:
${list}

Return ONLY a valid raw JSON object. No markdown, no commentary, no explanations.

JSON schema:
{
  "selectedIndices": array of selected article indices (integers, max 2)
}
`;

      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          selectedIndices: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.INTEGER }
          }
        },
        required: ["selectedIndices"]
      };

      try {
        await this.checkRateLimit();
        const responseModel = genAI.getGenerativeModel({
          model: "gemini-2.5-flash",
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
          }
        });
        const result = await responseModel.generateContent(prompt);
        let text = result.response.text().trim();

        const data = JSON.parse(text);
        if (!data.selectedIndices || !Array.isArray(data.selectedIndices)) {
          throw new Error("Invalid response format: missing selectedIndices array");
        }

        const selectedIndices = data.selectedIndices
          .map((idx) => Number(idx))
          .filter((idx) => Number.isInteger(idx));

        if (selectedIndices.length !== data.selectedIndices.length) {
          logger.warn("GeminiService: Some selectedIndices were invalid and were dropped:", {
            original: data.selectedIndices,
            sanitized: selectedIndices,
          });
        }

        return selectedIndices;
      } catch (error) {
        logger.error("GeminiService: JSON parsing error in selectBestArticlesForLinkedIn:", error);
        if (retries > 0) {
          logger.warn(`Error in selectBestArticlesForLinkedIn, retrying in 30 seconds... (${retries} retries remaining)`);
          await sleep(30000);
          return this.selectBestArticlesForLinkedIn(articles, recentTopics, retries - 1);
        }
        throw error;
      }
    } catch (error) {
      logger.error("Error in selectBestArticlesForLinkedIn:", error);
      throw error;
    }
  }

  async generateHook(selectedArticles, retries = 3) {
    let context = "";
    selectedArticles.forEach((art, i) => {
      context += `=== ARTICLE #${i + 1} ===\n`;
      context += `Topic: ${art.title}\n`;
      context += `Content:\n${art.fullContent}\n\n`;
    });

    const prompt = `
You are an elite, world-class technical copywriter specializing in high-performing LinkedIn posts for tech/AI/developer audiences.

Given the technical article context, your task is to generate exactly 5 candidate scroll-stopping hooks with their corresponding "promises" (what the reader expects to learn or get after reading the post).

For each candidate, identify the single article index from the list above that best matches the hook you are writing. If the hook is based on a single article, return that article's index. If it is inspired by multiple articles, return the index for the strongest primary source.

=== 2026 HOOK VIRALITY FORMULA ===
Create an elite, scroll-stopping curiosity or information gap (80% of post success). You MUST use a results-first bold claim, a specific number, a contrarian angle, or a concrete announcement. Avoid neutral roundups. Prioritize hooks that include concrete numbers, benchmarks, or pricing when available in the content. Consider starting with one strategic emoji when it fits naturally (e.g. 💡, 🚀, ⚡) to act as a clean visual anchor.

MANDATORY CURIOSITY GAP RULES (STRICT):
- WITHHOLD INFORMATION: Never tell the full story in the hook itself. Create tension or imply unneeded complexity/unnecessary work. (e.g., instead of "GitHub just launched direct download metrics in the UI", write "You've been making API calls for GitHub download data you can now just... see.")
- ANTI-RESOLUTION RULE (STRICT): The hook must NOT answer its own question or resolve its own tension. If line 1 creates a gap ("You're missing half the picture"), lines 2-3 must deepen the gap or add a second tension — never close it.
  * Question Hook Example — BAD: "Are you parsing logs manually? There's a better way."
  * Question Hook Example — GOOD: "Are you parsing logs manually? Every engineer who's done it at scale has the same regret."
- STOP AT MAX TENSION (CRITICAL): The hook must stop exactly when the tension is maximized. Never append a resolution sentence like "X built a simpler way" or "there is an easier path" or similar deflations. Instead of "X built a simpler way", write "X faced the same problem at scale." The body is where the gap closes.
- PENALTY (CRITICAL): Never start with the subject/platform name directly followed by "just launched", "announced", "released", "updated", or similar verbs. This news-headline style is boring and kills "see more" clicks.
- Hook MUST be 1-3 lines max.
- Hook MUST be under 200 characters to prevent being hidden under LinkedIn's "see more" button.
- Avoid weak, open-ended, or generic questions in the hook itself.
- Never start with "Here is", "This week", or similar roundup/newsletter intros.
- Hook and promise must follow the anti-hype rules from the system prompt (no "significant", "wild", "next-gen", "groundbreaking", etc.).
- NEVER use any of these banned words or their derivatives anywhere in the hook: ${BANNED_WORDS.join(", ")}

PROMISE:
- A brief explanation of what value/delivery the body must provide to satisfy this hook.

Context:
${context}

Return ONLY a valid raw JSON object. No markdown, no commentary, no explanations.

JSON schema:
{
  "candidates": [
    {
      "hook": string,
      "promise": string,
      "sourceIndex": integer
    },
    ... (exactly 5 items)
  ]
}
`;

    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        candidates: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.OBJECT,
            properties: {
              hook: { type: SchemaType.STRING },
              promise: { type: SchemaType.STRING },
              sourceIndex: { type: SchemaType.INTEGER }
            },
            required: ["hook", "promise", "sourceIndex"]
          }
        }
      },
      required: ["candidates"]
    };

    try {
      await this.checkRateLimit();
      const responseModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });
      const result = await responseModel.generateContent(prompt);
      const text = result.response.text().trim();
      const data = JSON.parse(text);
      if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        throw new Error("Invalid response format: missing candidates array");
      }
      return data.candidates;
    } catch (error) {
      logger.error("GeminiService: JSON parsing error in generateHook:", error);
      if (retries > 0) {
        logger.warn(`Error in generateHook, retrying... (${retries} retries remaining)`);
        await sleep(15000);
        return this.generateHook(selectedArticles, retries - 1);
      }
      throw error;
    }
  }

  async generateBody(selectedArticles, chosenHook, retries = 3, validationFeedback = [], recentStructures = [], previousDraft = null) {
    const primaryArticle = selectedArticles && selectedArticles.length > 0 ? selectedArticles[0] : null;
    const rawManualPoints = primaryArticle ? this.extractManualPoints(primaryArticle.fullContent) : [];
    const hookAndPromise = `${chosenHook?.hook || ""} ${chosenHook?.promise || ""}`;
    const manualPointsForThisHook = this.filterManualPointsByHook(rawManualPoints, hookAndPromise);
    const manualPointsText = this.formatManualPoints(manualPointsForThisHook);

    let context = "";
    selectedArticles.forEach((art, i) => {
      context += `=== ARTICLE #${i + 1} ===\n`;
      context += `Topic: ${art.title}\n`;
      context += `GitHub URL: ${art.githubUrl}\n`;
      context += `Content:\n${this.extractKeyPoints(art.fullContent)}\n\n`;
    });

    const githubUrl = primaryArticle ? primaryArticle.githubUrl : "";
    const postRules = this.buildFlexibleLinkedInPostRules(githubUrl, MIN_POST_LENGTH, MAX_POST_LENGTH);

    const recentStructuresList = Array.isArray(recentStructures) ? recentStructures : [];
    const structureOptions = this.buildStructureOptions(recentStructuresList);
    const recentStructuresText = recentStructuresList.length > 0
      ? `Recently used structures (avoid unless this topic clearly demands one): ${recentStructuresList.slice(0, 3).join(", ")}`
      : "No recent structures yet.";

    const previousDraftBlock = previousDraft
      ? `
=== PREVIOUS DRAFT FAILED ===
This was the rejected draft. Diagnose why it failed (length, structure, banned words, weak CTA, missing manual points) and write something meaningfully different:
${previousDraft.substring(0, 1200)}
`
      : "";

    const feedbackBlock = validationFeedback.length > 0
      ? `
=== PREVIOUS ATTEMPT FAILED QUALITY CHECK ===
Your last draft was rejected. Fix every issue below while keeping the same hook promise:
${validationFeedback.map(err => `- ${err}`).join("\n")}

Do NOT produce another generic roundup. Expand thin bullets, vary the structure, and replace any survey-style CTA.
`
      : "";

    const prompt = `
You are an expert LinkedIn content writer and senior developer.

Your task is to write the BODY, CTA, HASHTAGS, and VISUAL SLIDE points for a high-performing LinkedIn post.
You are given a pre-written HOOK and its corresponding PROMISE. Your body MUST deliver precisely on this promise and satisfy the hook's curiosity gap.

=== CHOSEN HOOK & PROMISE ===
Hook: "${chosenHook.hook}"
Promise: "${chosenHook.promise}"

CRITICAL ALIGNMENT DIRECTION (STRICT):
Your body, CTA, visual slide title, tagline, and slide points MUST focus 100% on the topic stated in the CHOSEN HOOK and PROMISE above.
If the article content contains multiple unrelated sub-articles, only use the sub-article that matches the hook topic.
Discard all other sub-article content from your response.

=== MANUAL POINTS (PRESERVE ACCURACY) ===
These are the curated technical facts. Your post MUST include the substance of the ones that align with the CHOSEN HOOK and PROMISE above. You may lightly reword for flow, but do NOT omit, soften, invent, or replace them with generic summaries.
${manualPointsText}

${feedbackBlock}
${previousDraftBlock}

=== AVAILABLE STRUCTURES (CHOOSE ONE) ===
${structureOptions}

${recentStructuresText}

Pick the single structure that best serves the hook and manual points. Announce your choice in the "chosenStructure" field and follow it consistently from hook through CTA.

=== CORE ELEMENTS (every structure must include) ===
- A tension/problem or surprising insight section near the start that earns the reader's attention.
- One short 6-10 word rehook/tension line placed right before the actionable framework.
- A save-worthy framework of 3-5 bullets or numbered steps using ONLY the manual points. Each step MUST be on its own line and start with a number + period (e.g., "1. First step...") or a bullet "• ". Never bury the steps inside a prose paragraph.
- A one-sentence implication/takeaway explaining why this matters now.

=== ARTICLE CONTENT ===
${context}
=== END ===

GitHub URL: ${githubUrl}

${postRules}

=== STYLE NOTE ===
- Vary sentence rhythm: mix very short punchy sentences (4-6 words) with denser technical explanations.
- Vary paragraph length. Avoid every paragraph being the same size.
- The structure and flow are up to you; do not chain identical transition phrases.
- Sound like a senior engineer sharing useful findings, not a corporate comms team.

STRICT BANNED WORDS RULE:
Absolutely NEVER use any of these banned words or their derivatives (such as plural -s, past -ed, continuous -ing, adverb -ly, etc.) anywhere in your output (including the slide title, slide points, slide tagline, and body paragraphs):
${BANNED_WORDS.join(", ")}

=== ADDITIONAL BODY RULES ===
- Do NOT repeat the pre-written hook inside the "postTextBody" field. We will prepend the hook programmatically.
- Combine the generated Body, CTA, and the required link line into the "postTextBody" field. Put the hashtags in the separate "hashtags" field, NOT inside "postTextBody".
- Final assembled post length target (hook + body + CTA + link line + hashtags): ${MIN_POST_LENGTH}-${MAX_POST_LENGTH} characters.
- EMOJI UNIQUE RULE: Do NOT use any emoji that appears in the pre-written hook above. Check the hook text (e.g. if it uses 💡 or 🚀) and pick entirely different emojis or none at all for the body paragraph visual anchors.
- NO FABRICATIONS OR HALLUCINATIONS: Do NOT invent or infer details that are not present in the source article content. If you cannot fill a paragraph using only facts from the Key Points or Manual Points above, write fewer paragraphs — do not invent connecting tissue.
- CTA MUST ask for a personal story or timeline, never a yes/no poll or readiness survey.

=== HARD CONSTRAINTS (violations cause regeneration) ===
1. postTextBody MUST contain a save-worthy framework of 3-5 bullets or numbered steps and a 6-10 word rehook/tension line before it. Each framework step must start on its own line with "1. ", "2. ", etc., or "• ". Do not merge them into a single paragraph.
2. Hashtags field MUST contain exactly 3-4 targeted hashtags separated by spaces.
3. Zero banned words anywhere in the output (scan your draft and remove any matches).
4. Every substantive claim must reflect the manual points above.

Before returning JSON, run a final self-check against every HARD CONSTRAINT and fix any violation.

=== VISUAL SLIDE ===
title: Max 50 characters (punchy value statement)
slidePoints: Exactly 3 technical bullet points (each max 65 chars, starting with a clear value). Bullet points MUST focus on technical details. No links or resource links in this array!
slideTagline: 5-8 words, specific and benefit-focused.
slideTagline and slidePoints must also follow the anti-hype rules from the system prompt (no "pushing boundaries", "advanced", "cutting-edge", "next-gen", etc.).

Return ONLY valid raw JSON.

JSON schema:
{
  "postTextBody": string (formatted body, CTA, and required link line with \\n for line breaks — do NOT include hashtags here),
  "hashtags": string (exactly 3-4 targeted hashtags separated by spaces, e.g. "#AI #DevTools #Engineering"),
  "title": string (max 50 chars),
  "slidePoints": array of exactly 3 strings (max 65 chars each),
  "slideTagline": string (5-8 words),
  "cta": string (the provocative CTA question),
  "chosenStructure": string (the "name" value of the structure you chose from Available Structures)
}
`;

    const responseSchema = {
      type: SchemaType.OBJECT,
      properties: {
        postTextBody: { type: SchemaType.STRING },
        title: { type: SchemaType.STRING },
        slidePoints: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          minItems: 3,
          maxItems: 3
        },
        slideTagline: { type: SchemaType.STRING },
        cta: { type: SchemaType.STRING },
        chosenStructure: { type: SchemaType.STRING },
        hashtags: { type: SchemaType.STRING }
      },
      required: ["postTextBody", "hashtags", "title", "slidePoints", "slideTagline", "cta", "chosenStructure"]
    };

    try {
      await this.checkRateLimit();
      const responseModel = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        }
      });
      const result = await responseModel.generateContent(prompt);
      const text = result.response.text().trim();
      const data = JSON.parse(text);

      if (!data.postTextBody || !data.title || !data.cta) {
        throw new Error("Invalid response format: missing postTextBody, title or cta");
      }

      let postTextBodyClean = data.postTextBody;
      const linkLine = "🔗 Full breakdown + resources in the comments.";
      const ctaText = data.cta ? data.cta.trim() : "";

      // Canonicalize the body CTA: keep exactly one instance, placed right before the link line.
      if (ctaText) {
        const ctaNormalized = ctaText.toLowerCase().replace(/\?$/, "").trim();
        postTextBodyClean = postTextBodyClean.split("\n")
          .filter(line => {
            const lineNorm = line.trim().toLowerCase().replace(/\?$/, "").trim();
            return lineNorm !== ctaNormalized;
          })
          .join("\n");
      }

      if (!postTextBodyClean.includes(linkLine)) {
        postTextBodyClean = postTextBodyClean.trim() + "\n\n" + linkLine;
      }

      if (ctaText) {
        const lines = postTextBodyClean.split("\n");
        const linkIdx = lines.findIndex(l => l.trim() === linkLine);
        if (linkIdx >= 0) {
          // Check whether a CTA is already immediately before the link line.
          let prevIdx = -1;
          for (let i = linkIdx - 1; i >= 0; i--) {
            if (lines[i].trim()) { prevIdx = i; break; }
          }
          const ctaNormalized = ctaText.toLowerCase().replace(/\?$/, "").trim();
          const prevIsCta = prevIdx >= 0 && lines[prevIdx].trim().toLowerCase().replace(/\?$/, "").trim() === ctaNormalized;
          if (!prevIsCta) {
            lines.splice(linkIdx, 0, "", ctaText);
            postTextBodyClean = lines.join("\n");
          }
        }
      }

      // Sanitize hashtags: remove any inline hashtags from the body and append
      // exactly 3-4 hashtags from the dedicated field on their own line.
      const tagRegex = /#[a-zA-Z0-9]+/g;
      const allHashtags = ((data.hashtags || "").trim().match(tagRegex) || []);
      const bodyHashtags = (postTextBodyClean.match(tagRegex) || []);
      const uniqueHashtags = Array.from(new Set([...allHashtags, ...bodyHashtags])).slice(0, 4);

      // Strip inline hashtags line-by-line, preserving blank-line paragraph breaks.
      postTextBodyClean = postTextBodyClean
        .split("\n")
        .map(line => line.replace(tagRegex, "").trim().replace(/[ \t]{2,}/g, " "))
        .join("\n")
        .trim();

      if (uniqueHashtags.length > 0) {
        postTextBodyClean = postTextBodyClean + "\n\n" + uniqueHashtags.join(" ");
      }

      const postText = `${chosenHook.hook}\n\n${postTextBodyClean}`;

      const commentText = `Full resource list and tools → ${githubUrl}`;

      if (!Array.isArray(data.slidePoints) || data.slidePoints.length === 0) {
        throw new Error("Invalid response format: slidePoints must be a non-empty array");
      }
      while (data.slidePoints.length < 3) {
        data.slidePoints.push(data.slidePoints[data.slidePoints.length - 1] || "");
      }
      const slidePoints = data.slidePoints.slice(0, 3);
      const slideTagline = data.slideTagline || "Curated by AI \u00b7 Updated Weekly";

      // Canonicalize chosenStructure to a registry name (model sometimes returns a label).
      const structureEntry = STRUCTURE_REGISTRY.find(
        s => s.name === data.chosenStructure || s.label === data.chosenStructure
      );
      const chosenStructureName = structureEntry ? structureEntry.name : (data.chosenStructure || "unspecified");

      return {
        postText,
        commentText,
        title: data.title,
        slidePoints,
        slideTagline,
        chosenStructure: chosenStructureName
      };
    } catch (error) {
      logger.error("GeminiService: JSON parsing error in generateBody:", error);
      if (retries > 0) {
        logger.warn(`Error in generateBody, retrying in 15 seconds... (${retries} retries remaining)`);
        await sleep(15000);
        return this.generateBody(selectedArticles, chosenHook, retries - 1, validationFeedback, recentStructures, previousDraft);
      }
      throw error;
    }
  }

  async generateLinkedInMasterPost(selectedArticles, retries = 3, validationFeedback = []) {
    try {
      if (!selectedArticles || selectedArticles.length === 0) {
        throw new Error("No selected articles provided for generateLinkedInMasterPost");
      }

      const primaryArticle = selectedArticles[0];
      const githubUrl = primaryArticle.githubUrl || "";
      const sourceBulletCount = this.countSourceBullets(primaryArticle.fullContent);
      const manualPoints = this.extractManualPoints(primaryArticle.fullContent);
      const recentStructures = this.loadRecentStructures();

      logger.info("GeminiService: Step 2a: Generating hook candidates...");
      const hookCandidates = await this.generateHook(selectedArticles);
      const scoredHooks = this.scoreHooks(hookCandidates);

      logger.info("=============================================================");
      logger.info("📝 SCORING HOOK CANDIDATES:");
      scoredHooks.forEach((sh, index) => {
        logger.info(`   [Rank ${index + 1}] Score: ${sh.score} -> "${sh.hook}"`);
        logger.info(`          Promise: "${sh.promise}"`);
      });
      logger.info("=============================================================");

      const topHooks = scoredHooks.slice(0, 3);
      if (validationFeedback.length > 0) {
        logger.warn("GeminiService: Retrying generateLinkedInMasterPost with previous validation feedback:");
        validationFeedback.forEach(err => logger.warn(`  - ${err}`));
      }
      let bestPost = null;
      let bestValidation = null;
      let chosenHook = null;

      const isBetterCandidate = (candidateValidation, candidateScore, candidateHook, currentValidation, currentHook) => {
        const candidateIsValid = candidateValidation.isValid;
        const currentIsValid = currentValidation?.isValid ?? false;

        if (candidateIsValid && !currentIsValid) return true;
        if (candidateIsValid === currentIsValid) {
          if (candidateScore > (currentValidation?.qualityScore ?? -1)) return true;
          if (candidateScore === (currentValidation?.qualityScore ?? -1) && candidateHook.score > (currentHook?.score ?? -1)) return true;
        }
        return false;
      };

      for (const hookCandidate of topHooks) {
        hookCandidate.hook = hookCandidate.hook
          .replace(/\.([a-zA-Z])/g, ". $1")
          .replace(/\?([a-zA-Z])/g, "? $1");

        logger.info(`GeminiService: Step 2b: Generating body for hook [Score ${hookCandidate.score}]: "${hookCandidate.hook.substring(0, 60)}..."`);

        const postData = await this.generateBody(selectedArticles, hookCandidate, 1, validationFeedback, recentStructures, null);
        const hookManualPoints = this.filterManualPointsByHook(manualPoints, `${hookCandidate.hook} ${hookCandidate.promise}`);
        const validation = this.validatePostText(postData, githubUrl, sourceBulletCount, hookManualPoints);
        const qualityScore = validation.qualityScore ?? this.scorePostQuality(postData, sourceBulletCount, hookManualPoints).score;

        logger.info(`GeminiService: Candidate quality score: ${qualityScore} (valid: ${validation.isValid})`);

        if (!bestPost || isBetterCandidate(validation, qualityScore, hookCandidate, bestValidation, chosenHook)) {
          bestPost = postData;
          bestValidation = validation;
          chosenHook = hookCandidate;
        }
      }

      let remainingRetries = retries;
      let previousQualityScore = -1;
      let previousDraft = bestPost ? bestPost.postText : null;
      while (!bestValidation.isValid && remainingRetries > 0) {
        remainingRetries--;
        const currentScore = bestValidation.qualityScore ?? 0;

        if (previousQualityScore >= 0 && currentScore <= previousQualityScore) {
          logger.warn(`GeminiService: Quality score not improving (${previousQualityScore} -> ${currentScore}). Stopping retry loop.`);
          break;
        }
        previousQualityScore = currentScore;

        const combinedFeedback = [
          ...bestValidation.errors,
          ...(bestValidation.qualityIssues || []).filter(issue => !bestValidation.errors.includes(issue))
        ];

        logger.warn(`GeminiService: Post failed quality gate (score ${currentScore}). Retrying body with feedback... (${remainingRetries} retries remaining)`);
        logger.warn(`GeminiService: Validation issues:\n- ${combinedFeedback.join("\n- ")}`);

        let improvedPost = bestPost;
        let improvedValidation = bestValidation;
        let improvedHook = chosenHook;

        for (const retryHook of topHooks) {
          const retryPost = await this.generateBody(
            selectedArticles,
            retryHook,
            1,
            combinedFeedback,
            recentStructures,
            previousDraft
          );
          const retryHookManualPoints = this.filterManualPointsByHook(manualPoints, `${retryHook.hook} ${retryHook.promise}`);
          const retryValidation = this.validatePostText(retryPost, githubUrl, sourceBulletCount, retryHookManualPoints);
          const retryScore = retryValidation.qualityScore ?? this.scorePostQuality(retryPost, sourceBulletCount, retryHookManualPoints).score;

          if (!improvedPost || isBetterCandidate(retryValidation, retryScore, retryHook, improvedValidation, improvedHook)) {
            improvedPost = retryPost;
            improvedValidation = retryValidation;
            improvedHook = retryHook;
          }
        }

        bestPost = improvedPost;
        bestValidation = improvedValidation;
        chosenHook = improvedHook;
        previousDraft = bestPost ? bestPost.postText : null;

        logger.info(`GeminiService: Retry quality score: ${bestValidation.qualityScore} (valid: ${bestValidation.isValid})`);
      }

      const winningSourceIndex = Number.isInteger(chosenHook?.sourceIndex)
        ? chosenHook.sourceIndex
        : 0;
      const winningSourceTitle = selectedArticles[winningSourceIndex]?.title || selectedArticles[0]?.title || "";

      const structureLabel = STRUCTURE_REGISTRY.find(s => s.name === bestPost.chosenStructure)?.label || bestPost.chosenStructure;
      logger.info(`GeminiService: Final post quality score: ${bestValidation.qualityScore}. Title: "${bestPost.title}", slideTagline: "${bestPost.slideTagline}", sourceTitle: "${winningSourceTitle}", structure: "${structureLabel}"`);
      if (!bestValidation.isValid) {
        logger.warn(`GeminiService: Publishing best available draft after retries. Remaining issues:\n- ${bestValidation.errors.join("\n- ")}`);
      }

      if (bestPost.chosenStructure) {
        this.saveRecentStructure(bestPost.chosenStructure);
      }

      return {
        ...bestPost,
        isValid: bestValidation.isValid,
        validationErrors: bestValidation.errors || [],
        qualityScore: bestValidation.qualityScore,
        qualityIssues: bestValidation.qualityIssues || [],
        sourceIndex: winningSourceIndex,
        sourceTitle: winningSourceTitle
      };
    } catch (error) {
      logger.error("Error in generateLinkedInMasterPost:", error);
      throw error;
    }
  }

  groupTweetsByConversation(tweets) {
    const conversations = new Map();

    tweets.forEach((tweet) => {
      const conversationId = tweet.conversation_id || tweet.id;
      if (!conversations.has(conversationId)) {
        conversations.set(conversationId, []);
      }
      conversations.get(conversationId).push(tweet);
    });

    return Array.from(conversations.values()).map(group => {
      // Annotate type (tweet vs thread) to address smaller observations (Gap 6)
      group.type = group.length > 1 ? 'thread' : 'tweet';
      return group;
    });
  }
}

module.exports = new GeminiService();
