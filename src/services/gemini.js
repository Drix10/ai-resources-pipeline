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
      return trimmed.startsWith("•") || /^\d+\./.test(trimmed);
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
    return "";
  }

  scorePostQuality(postData, sourceBulletCount = 0) {
    const postText = postData.postText || "";
    const hook = postText.split("\n\n")[0] || "";
    const bodyWithoutHook = postText.slice(hook.length).trim();
    let score = 100;
    const issues = [];
    let bonusPoints = 0;
    let penaltyPoints = 0;

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
      penaltyPoints += 25;
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
    if (proseParagraphs.length < 2) {
      penaltyPoints += 25;
      issues.push("Needs at least 2 prose paragraphs (problem + insight) before the framework");
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

  validatePostText(postData, githubUrl, sourceBulletCount = 0) {
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
      const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}(s|ed|ing|ly|tion|ness)?\\b`, 'i');
      return regex.test(allText);
    });
    if (foundBanned.length > 0) {
      errors.push(`Banned word(s) found: ${foundBanned.join(", ")}`);
    }

    const hook = postText.split("\n\n")[0] || "";
    if (hook.length > 200) {
      errors.push(`Hook exceeds 200 characters (${hook.length} characters)`);
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

    if (sourceBulletCount > 0) {
      const bodyParagraphCount = Math.max(0, paragraphs.length - 1);
      if (bodyParagraphCount > sourceBulletCount) {
        errors.push(`Padding/Hallucination warning: post has ${bodyParagraphCount} body paragraphs but source content only has ${sourceBulletCount} bullet points/steps.`);
      }
    }

    const firstBodyParagraph = paragraphs[1] || "";
    if (firstBodyParagraph) {
      const firstBodySentence = firstBodyParagraph.split(/[.!?]/)[0] || "";
      const hookSentence = hook.split(/[.!?]/)[0] || "";

      const getSignificantWords = (text) => {
        const stopWords = ["the", "a", "an", "is", "it", "are", "of", "to", "for", "in", "and", "or", "on", "with", "that", "this", "your", "you", "about"];
        return text.toLowerCase().split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(w => w.length > 3 && !stopWords.includes(w));
      };

      const firstBodyWords = getSignificantWords(firstBodySentence);
      const hookWords = getSignificantWords(hookSentence);
      const commonWords = firstBodyWords.filter(w => hookWords.includes(w));

      if (commonWords.length >= 4) {
        errors.push(`Verbatim/Paraphrase Repetition warning: first sentence of body paragraph heavily repeats hook concepts (shared words: ${commonWords.join(", ")})`);
      }
    }

    if (postText.length < MIN_POST_LENGTH) {
      errors.push(`Post too short: ${postText.length} characters (minimum ${MIN_POST_LENGTH})`);
    }
    if (postText.length > MAX_POST_LENGTH) {
      errors.push(`Post too long: ${postText.length} characters (maximum ${MAX_POST_LENGTH})`);
    }

    const bodyWithoutHook = postText.slice(hook.length).trim();
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

    if (!this.hasRehook(bodyWithoutHook)) {
      errors.push("Missing rehook sentence between insight and framework sections");
    }

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

    const quality = this.scorePostQuality(postData, sourceBulletCount);
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

      return {
        ...c,
        score
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

  async generateBody(selectedArticles, chosenHook, retries = 3, validationFeedback = []) {
    let context = "";
    selectedArticles.forEach((art, i) => {
      context += `=== ARTICLE #${i + 1} ===\n`;
      context += `Topic: ${art.title}\n`;
      context += `GitHub URL: ${art.githubUrl}\n`;
      context += `Content:\n${this.extractKeyPoints(art.fullContent)}\n\n`;
    });

    const githubUrl = selectedArticles.length > 0 ? selectedArticles[0].githubUrl : "";
    const postRules = this.buildLinkedInPostRules(githubUrl, false);

    const feedbackBlock = validationFeedback.length > 0
      ? `
=== PREVIOUS ATTEMPT FAILED QUALITY CHECK ===
Your last draft was rejected. Fix every issue below while keeping the same hook promise:
${validationFeedback.map(err => `- ${err}`).join("\n")}

Do NOT produce another generic roundup. Expand thin bullets, add the missing rehook, and replace any survey-style CTA.
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

${feedbackBlock}

=== ARTICLE CONTENT ===
${context}
=== END ===

GitHub URL: ${githubUrl}

${postRules}

=== STYLE NOTE ===
Write in a direct, technical, "senior engineer sharing findings" style. Avoid any generalities or promotional language.
This post must feel worth saving — not a neutral summary. Every framework bullet should teach something specific.

STRICT BANNED WORDS RULE:
Absolutely NEVER use any of these banned words or their derivatives (such as plural -s, past -ed, continuous -ing, adverb -ly, etc.) anywhere in your output (including the slide title, slide points, slide tagline, and body paragraphs):
${BANNED_WORDS.join(", ")}

=== ADDITIONAL BODY RULES ===
- Do NOT repeat the pre-written hook inside the "postTextBody" field. We will prepend the hook programmatically.
- Combine the generated Body, CTA, and Hashtags into the "postTextBody" field.
- Target ${MIN_POST_LENGTH}-${MAX_POST_LENGTH} characters for the final assembled post (hook + body + CTA + hashtags).
- EMOJI UNIQUE RULE: Do NOT use any emoji that appears in the pre-written hook above. Check the hook text (e.g. if it uses 💡 or 🚀) and pick entirely different emojis or none at all for the body paragraph visual anchors.
- NO FABRICATIONS OR HALLUCINATIONS: Do NOT invent or infer details that are not present in the source article content. If you cannot fill a paragraph using only facts from the Key Points above, write fewer paragraphs — do not invent connecting tissue or industry talking points (like 'data sovereignty' or 'cost-effectiveness' if they aren't explicitly mentioned). Keep your body paragraphs strictly bounded by the actual bullet points/facts provided in the source text.
- REHOOK IS MANDATORY: Include one short 6-10 word tension line between the insight paragraph and the framework bullets.
- CTA MUST ask for a personal story or timeline, never a yes/no poll or readiness survey.

=== VISUAL SLIDE ===
title: Max 50 characters (punchy value statement)
slidePoints: Exactly 3 technical bullet points (each max 65 chars, starting with a clear value). Bullet points MUST focus on technical details. No links or resource links in this array!
slideTagline: 5-8 words, specific and benefit-focused.
slideTagline and slidePoints must also follow the anti-hype rules from the system prompt (no "pushing boundaries", "advanced", "cutting-edge", "next-gen", etc.).

Return ONLY valid raw JSON.

JSON schema:
{
  "postTextBody": string (formatted body, CTA, and hashtags with \\n for line breaks),
  "title": string (max 50 chars),
  "slidePoints": array of exactly 3 strings (max 65 chars each),
  "slideTagline": string (5-8 words),
  "cta": string (the provocative CTA question)
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
        cta: { type: SchemaType.STRING }
      },
      required: ["postTextBody", "title", "slidePoints", "slideTagline", "cta"]
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
      if (!postTextBodyClean.includes(linkLine)) {
        postTextBodyClean = postTextBodyClean.trim() + "\n\n" + linkLine;
      }

      const postText = `${chosenHook.hook}\n\n${postTextBodyClean}`
        .replace(/(#\w+)\s*\n+\s*(?=.+)/g, '$1 ')
        .replace(/(#\w+)\s*\n+\s*(?=#)/g, '$1 ');

      const commentText = `Full resource list and tools → ${githubUrl}`;

      if (!Array.isArray(data.slidePoints) || data.slidePoints.length === 0) {
        throw new Error("Invalid response format: slidePoints must be a non-empty array");
      }
      while (data.slidePoints.length < 3) {
        data.slidePoints.push(data.slidePoints[data.slidePoints.length - 1] || "");
      }
      const slidePoints = data.slidePoints.slice(0, 3);
      const slideTagline = data.slideTagline || "Curated by AI \u00b7 Updated Weekly";

      return {
        postText,
        commentText,
        title: data.title,
        slidePoints,
        slideTagline
      };
    } catch (error) {
      logger.error("GeminiService: JSON parsing error in generateBody:", error);
      if (retries > 0) {
        logger.warn(`Error in generateBody, retrying in 30 seconds... (${retries} retries remaining)`);
        await sleep(30000);
        return this.generateBody(selectedArticles, chosenHook, retries - 1, validationFeedback);
      }
      throw error;
    }
  }

  async generateLinkedInMasterPost(selectedArticles, retries = 3, validationFeedback = []) {
    try {
      if (!selectedArticles || selectedArticles.length === 0) {
        throw new Error("No selected articles provided for generateLinkedInMasterPost");
      }

      const githubUrl = selectedArticles[0].githubUrl || "";
      const sourceBulletCount = selectedArticles.length > 0
        ? this.countSourceBullets(selectedArticles[0].fullContent)
        : 0;

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

        const postData = await this.generateBody(selectedArticles, hookCandidate, 1, validationFeedback);
        const validation = this.validatePostText(postData, githubUrl, sourceBulletCount);
        const qualityScore = validation.qualityScore ?? this.scorePostQuality(postData, sourceBulletCount).score;

        logger.info(`GeminiService: Candidate quality score: ${qualityScore} (valid: ${validation.isValid})`);

        if (!bestPost || isBetterCandidate(validation, qualityScore, hookCandidate, bestValidation, chosenHook)) {
          bestPost = postData;
          bestValidation = validation;
          chosenHook = hookCandidate;
        }
      }

      let remainingRetries = retries;
      let previousQualityScore = -1;
      while (!bestValidation.isValid && remainingRetries > 0) {
        remainingRetries--;
        const currentScore = bestValidation.qualityScore ?? 0;

        if (previousQualityScore >= 0 && currentScore <= previousQualityScore) {
          logger.warn(`GeminiService: Quality score not improving (${previousQualityScore} -> ${currentScore}). Stopping retry loop.`);
          break;
        }
        previousQualityScore = currentScore;

        logger.warn(`GeminiService: Post failed quality gate (score ${currentScore}). Retrying body with feedback... (${remainingRetries} retries remaining)`);
        logger.warn(`GeminiService: Validation issues:\n- ${bestValidation.errors.join("\n- ")}`);

        let improvedPost = bestPost;
        let improvedValidation = bestValidation;
        let improvedHook = chosenHook;

        for (const retryHook of topHooks) {
          const retryPost = await this.generateBody(
            selectedArticles,
            retryHook,
            1,
            bestValidation.errors
          );
          const retryValidation = this.validatePostText(retryPost, githubUrl, sourceBulletCount);
          const retryScore = retryValidation.qualityScore ?? this.scorePostQuality(retryPost, sourceBulletCount).score;

          if (!improvedPost || isBetterCandidate(retryValidation, retryScore, retryHook, improvedValidation, improvedHook)) {
            improvedPost = retryPost;
            improvedValidation = retryValidation;
            improvedHook = retryHook;
          }
        }

        bestPost = improvedPost;
        bestValidation = improvedValidation;
        chosenHook = improvedHook;

        logger.info(`GeminiService: Retry quality score: ${bestValidation.qualityScore} (valid: ${bestValidation.isValid})`);
      }

      const winningSourceIndex = Number.isInteger(chosenHook?.sourceIndex)
        ? chosenHook.sourceIndex
        : 0;
      const winningSourceTitle = selectedArticles[winningSourceIndex]?.title || selectedArticles[0]?.title || "";

      logger.info(`GeminiService: Final post quality score: ${bestValidation.qualityScore}. Title: "${bestPost.title}", slideTagline: "${bestPost.slideTagline}", sourceTitle: "${winningSourceTitle}"`);
      if (!bestValidation.isValid) {
        logger.warn(`GeminiService: Publishing best available draft after retries. Remaining issues:\n- ${bestValidation.errors.join("\n- ")}`);
      }

      return {
        ...bestPost,
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
