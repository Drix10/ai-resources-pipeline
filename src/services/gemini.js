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
When generating LinkedIn posts, ALWAYS include the exact GitHub link line if a URL is provided.
Prioritize clarity and specificity over flowery language.
Never use banned words even in creative sections.

=== LINKEDIN POST SPECIFIC RULES ===
Always use "• " for bullet points (never * or -).
Prioritize specific, actionable, or personal ("how I") insights over generic summaries.
Create a curiosity gap in the first 1-3 lines.
Sound like a senior engineer casually sharing something useful — avoid hype, marketing cliches, and corporate language.
MANDATORY: If a GitHub URL is provided, include the exact line "Full resource list → [URL]" (do not shorten or omit).

=== LINKEDIN ANTI-HYPE & VOICE RULES (STRICT) ===
Write like a senior engineer casually sharing something useful with another engineer.
Avoid hype, flowery, or overly polished language including: "significant", "significantly", "significant shifts", "advanced", "major", "majorly", "game-changing", "making waves", "robust", "advance", "powerful", "next-gen", "cutting-edge", "wild", "impressive", "critical step", "sophisticated", "most powerful", "signaling", "broader reach", "push boundaries", "pushing boundaries", "extensibility", "masterclass", "paving the way", "incredible ways", "blurring lines", "game-changer", "revolutionary", "groundbreaking", "dive", "deep dive", etc.
Avoid amplifying adverbs or adjectives that exaggerate facts (e.g., "significantly", "greatly", "impressively", "massively").
Prefer concrete technical details and specific examples over general praise or dramatic framing.
Keep the GitHub link on a single clean line: "Full resource list → [URL]"
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
          `Gemini Rate limit: Waiting ${
            waitTime / 1000
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
BODY:
- Heavy whitespace (double newlines between paragraphs for mobile readability).
- 3-5 short paragraphs max.
- Deliver specific, actionable, or concrete details.
- Sound like a senior engineer — direct and practical (no generic praises or roundups).
- Use "• " for bullets (never * or -).
- Highlight 3-4 specific tools/insights (for summary posts) or key takeaways (for master posts).
- MANDATORY: You MUST include this exact single line (do not break it or change the wording):
"Full resource list and tools → ${githubUrl}"
CRITICAL: The line "Full resource list and tools → [URL]" must appear as a single unbroken string. No line break, no newline character between the label text and the URL.

CTA:
End with exactly ONE strong, informal, opinionated question that drives personal debate or provocation — it should slightly challenge the reader's current approach. Prefer questions with an implicit "wrong answer" that the reader either agrees with or pushes back on.
Example: "Cloud-only inference in 2026 — pragmatic or just lazy?"
Do NOT write boring, survey-ish open-ended workflow or technical options (avoid "Are you using X or Y in your workflow?" or "Are you building hybrid deployments?").

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
      
      const keyPointsMatch = sub.match(/Key Points:([\s\S]*?)(?=🚀|🔗|---|$)/i);
      const keyPoints = keyPointsMatch ? keyPointsMatch[1].trim() : "";
      
      const implMatch = sub.match(/🚀 Implementation:([\s\S]*?)(?=🔗|---|$)/i);
      const implementation = implMatch ? implMatch[1].trim() : "";
      
      let formatted = `${header}\n`;
      if (keyPoints) formatted += `Key Points:\n${keyPoints}\n\n`;
      if (implementation) formatted += `Implementation:\n${implementation}`;
      return formatted.trim();
    }).filter(s => s.length > 50).join("\n\n---\n\n");
  }

  validatePostText(postData, githubUrl, sourceBulletCount = 0) {
    const errors = [];
    const postText = postData.postText || "";

    // 1. Check GitHub URL (Strict formatting checking - Bug 2)
    const urlLineRegex = /Full resource list and tools\s*→\s*https:\/\//;
    if (githubUrl && (!postText.includes(githubUrl) || !urlLineRegex.test(postText) || postText.includes("tools \n→") || postText.includes("tools\n→"))) {
      errors.push("GitHub URL line is missing, broken, or incorrectly formatted");
    }

    // 2. Check Banned Words across ALL text fields with stem-matching (Bug 1 & Audit)
    const allText = [
      postData.postText || "",
      postData.slideTagline || "",
      ...(postData.slidePoints || []),
      postData.title || ""
    ].join(" ");

    const foundBanned = BANNED_WORDS.filter(word => {
      const escaped = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      // Match the word plus common suffixes: -s, -ed, -ing, -ly, -tion, -ness
      const regex = new RegExp(`\\b${escaped}(s|ed|ing|ly|tion|ness)?\\b`, 'i');
      return regex.test(allText);
    });
    if (foundBanned.length > 0) {
      errors.push(`Banned word(s) found: ${foundBanned.join(", ")}`);
    }

    // 3. Check Hook Length (first paragraph before \n\n)
    const hook = postText.split("\n\n")[0] || "";
    if (hook.length > 200) {
      errors.push(`Hook exceeds 200 characters (${hook.length} characters)`);
    }

    // 4. Check Hashtags Count
    const hashtagMatches = postText.match(/#[a-zA-Z0-9]+/g) || [];
    const hashtagCount = hashtagMatches.length;
    if (hashtagCount < 3 || hashtagCount > 4) {
      errors.push(`Invalid number of hashtags: found ${hashtagCount} (expected 3-4)`);
    }

    // 5. Check Padding (paragraph count vs source bullet count)
    const paragraphs = postText.split("\n\n").filter(p => {
      const trimmed = p.trim();
      // Exclude tags, resource URLs, and CTA questions
      return trimmed.length > 0 && 
             !trimmed.startsWith("#") && 
             !trimmed.toLowerCase().includes("full resource list") &&
             !trimmed.endsWith("?");
    });

    if (sourceBulletCount > 0) {
      // The first paragraph is the hook, so body paragraph count is paragraphs.length - 1
      const bodyParagraphCount = Math.max(0, paragraphs.length - 1);
      if (bodyParagraphCount > sourceBulletCount) {
        errors.push(`Padding/Hallucination warning: post has ${bodyParagraphCount} body paragraphs but source content only has ${sourceBulletCount} bullet points/steps.`);
      }
    }

    // 6. Check Hook Repetition in Body (Bug-Audit 2)
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

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  scoreHooks(candidates) {
    return candidates.map(c => {
      let score = 100;
      const hookText = c.hook || "";
      const hookLower = hookText.toLowerCase();

      // Penalize generic announcements and subject-first structures
      const weakStartPatterns = [
        /^[a-z0-9_\-\s]+ just launched/i,
        /^[a-z0-9_\-\s]+ just announced/i,
        /^[a-z0-9_\-\s]+ just released/i,
        /^[a-z0-9_\-\s]+ just updated/i,
        /^[a-z0-9_\-\s]+ has launched/i,
        /^[a-z0-9_\-\s]+ has announced/i,
        /^[a-z0-9_\-\s]+ has released/i,
        /^here is/i,
        /^this week/i,
        /^introducing/i,
        /^launched/i,
        /^announced/i,
        /^released/i
      ];

      for (const pattern of weakStartPatterns) {
        if (pattern.test(hookText)) {
          score -= 40; // Heavy penalty for direct announcement
          break;
        }
      }

      // Penalize generic updates
      if (hookLower.includes("just updated") || hookLower.includes("just launched") || hookLower.includes("just released")) {
        score -= 20;
      }

      // Penalize hooks that answer their own question (resolution patterns)
      const resolutionPatterns = [
        /wrong\.\s*(it'?s|the answer|here'?s)/i,
        /missing\.\s*(it'?s|the answer|here'?s)/i,
        /\?\s*(it'?s|the answer|here'?s|that'?s)/i,
        /picture\.\s*(it'?s|the answer)/i,
      ];
      for (const pattern of resolutionPatterns) {
        if (pattern.test(hookText)) {
          score -= 35;
          break;
        }
      }

      // Reward hooks that withhold information or create high curiosity/tension
      if (hookLower.includes("you've been") || hookLower.includes("you have been")) score += 15;
      if (hookLower.includes("instead of")) score += 15;
      if (hookLower.includes("why ") || hookLower.includes("how ")) score += 10;
      if (hookLower.includes("stop ") || hookLower.includes("never ")) score += 15;
      if (hookLower.includes("unnecessary") || hookLower.includes("wrong")) score += 15;
      if (hookLower.includes("?") || hookLower.includes("...")) score += 10;

      // Length optimization (sweet spot 100 - 180 chars)
      if (hookText.length > 200) {
        score -= 50; // Heavily penalize exceeding LinkedIn visible limits
      } else if (hookText.length >= 100 && hookText.length <= 180) {
        score += 15;
      }

      return {
        ...c,
        score
      };
    }).sort((a, b) => b.score - a.score); // Sort descending by score
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
          combinedPrompt += `Item #${i+1} (X):\n${t.tweets ? t.tweets.map(tweet => tweet.text).join("\n") : t.url}\n`;
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
          combinedPrompt += `Item #${i+1} (LinkedIn) by ${post.author}:\n${post.text}\n`;
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
        return data.selectedIndices;
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
      context += `=== ARTICLE #${i+1} ===\n`;
      context += `Topic: ${art.title}\n`;
      context += `Content:\n${art.fullContent}\n\n`;
    });

    const prompt = `
You are an elite, world-class technical copywriter specializing in high-performing LinkedIn posts for tech/AI/developer audiences.

Given the technical article context, your task is to generate exactly 3 candidate scroll-stopping hooks with their corresponding "promises" (what the reader expects to learn or get after reading the post).

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
      "promise": string
    },
    ... (exactly 3 items)
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
              promise: { type: SchemaType.STRING }
            },
            required: ["hook", "promise"]
          },
          minItems: 3,
          maxItems: 3
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

  async generateBody(selectedArticles, chosenHook, retries = 3) {
    let context = "";
    selectedArticles.forEach((art, i) => {
      context += `=== ARTICLE #${i+1} ===\n`;
      context += `Topic: ${art.title}\n`;
      context += `GitHub URL: ${art.githubUrl}\n`;
      context += `Content:\n${this.extractKeyPoints(art.fullContent)}\n\n`;
    });

    const githubUrl = selectedArticles.length > 0 ? selectedArticles[0].githubUrl : "";
    const postRules = this.buildLinkedInPostRules(githubUrl, false);

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

=== ARTICLE CONTENT ===
${context}
=== END ===

GitHub URL: ${githubUrl}

${postRules}

=== STYLE NOTE ===
Write in a direct, technical, "senior engineer sharing findings" style. Avoid any generalities or promotional language.

STRICT BANNED WORDS RULE:
Absolutely NEVER use any of these banned words or their derivatives (such as plural -s, past -ed, continuous -ing, adverb -ly, etc.) anywhere in your output (including the slide title, slide points, slide tagline, and body paragraphs):
${BANNED_WORDS.join(", ")}

=== ADDITIONAL BODY RULES ===
- Do NOT repeat the pre-written hook inside the "postTextBody" field. We will prepend the hook programmatically.
- Combine the generated Body, CTA, and Hashtags into the "postTextBody" field.
- EMOJI UNIQUE RULE: Do NOT use any emoji that appears in the pre-written hook above. Check the hook text (e.g. if it uses 💡 or 🚀) and pick entirely different emojis or none at all for the body paragraph visual anchors.
- NO FABRICATIONS OR HALLUCINATIONS: Do NOT invent or infer details that are not present in the source article content. If you cannot fill a paragraph using only facts from the Key Points above, write fewer paragraphs — do not invent connecting tissue or industry talking points (like 'data sovereignty' or 'cost-effectiveness' if they aren't explicitly mentioned). Keep your body paragraphs strictly bounded by the actual bullet points/facts provided in the source text.

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
  "slideTagline": string (5-8 words)
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
        slideTagline: { type: SchemaType.STRING }
      },
      required: ["postTextBody", "title", "slidePoints", "slideTagline"]
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

      if (!data.postTextBody || !data.title) {
        throw new Error("Invalid response format: missing postTextBody or title");
      }
      
      // Combine hook and body and collapse newline hashtags (Fix 2)
      const postText = `${chosenHook.hook}\n\n${data.postTextBody}`
        .replace(/(#\w+)\s*\n+\s*(?=#)/g, '$1 ');

      // Validate slidePoints: must be an array; normalize to exactly 3 items
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
        title: data.title,
        slidePoints,
        slideTagline
      };
    } catch (error) {
      logger.error("GeminiService: JSON parsing error in generateBody:", error);
      if (retries > 0) {
        logger.warn(`Error in generateBody, retrying in 30 seconds... (${retries} retries remaining)`);
        await sleep(30000);
        return this.generateBody(selectedArticles, chosenHook, retries - 1);
      }
      throw error;
    }
  }

  async generateLinkedInMasterPost(selectedArticles, retries = 3) {
    try {
      if (!selectedArticles || selectedArticles.length === 0) {
        throw new Error("No selected articles provided for generateLinkedInMasterPost");
      }

      const githubUrl = selectedArticles[0].githubUrl || "";

      logger.info("GeminiService: Step 2a: Generating hook candidates...");
      const hookCandidates = await this.generateHook(selectedArticles);
      
      // Heuristically score and select the hook with the highest curiosity gap / information withholding (Gap 2)
      const scoredHooks = this.scoreHooks(hookCandidates);
      
      logger.info("=============================================================");
      logger.info("📝 SCORING HOOK CANDIDATES:");
      scoredHooks.forEach((sh, index) => {
        logger.info(`   [Rank ${index + 1}] Score: ${sh.score} -> "${sh.hook}"`);
        logger.info(`          Promise: "${sh.promise}"`);
      });
      logger.info("=============================================================");

      const chosenHook = scoredHooks[0];
      // Normalise punctuation spacing programmatically to prevent missing-space typo
      chosenHook.hook = chosenHook.hook.replace(/\.([a-zA-Z])/g, '. $1').replace(/\?([a-zA-Z])/g, '? $1');

      logger.info(`GeminiService: Step 2b: Generating body for chosen hook [Score ${chosenHook.score}]: "${chosenHook.hook.substring(0, 60)}..."`);

      const postData = await this.generateBody(selectedArticles, chosenHook);

      // Perform programmatic validation including the new bullet justification padding check (Gap 5)
      const sourceBulletCount = selectedArticles.length > 0 ? this.countSourceBullets(selectedArticles[0].fullContent) : 0;
      logger.info(`GeminiService: Validating post. Title: "${postData.title}", slideTagline: "${postData.slideTagline}"`);
      const validation = this.validatePostText(postData, githubUrl, sourceBulletCount);
      if (!validation.isValid) {
        logger.warn(`GeminiService: Programmatic post validation failed. Reasons:\n- ${validation.errors.join("\n- ")}`);
        if (retries > 0) {
          logger.info(`Retrying generation with explicit feedback... (${retries} retries remaining)`);
          return this.generateLinkedInMasterPost(selectedArticles, retries - 1);
        }
      }

      // Save selected topic to recent list to prevent topic categories from being repeated in future runs (Gap 3)
      this.saveRecentTopic(selectedArticles[0].title);

      return postData;
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
