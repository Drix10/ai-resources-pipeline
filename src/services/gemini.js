const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
  SchemaType,
} = require("@google/generative-ai");
const config = require("../../config");
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

const SYSTEM_PROMPT = `
You are an expert technical writer and senior software engineer. Your writing style is direct, clear, highly analytical, and professional—completely free of generic AI-generated filler, marketing hype, and corporate fluff.

You curate raw tech/AI/developer content (Twitter threads, LinkedIn posts) and transform them into premium, high-value, and perfectly formatted technical articles in markdown.

=== ANTI-AI & TECHNICAL TONE RULES (STRICT) ===
1. BAN LIST — Absolutely NEVER use these robotic/AI buzzwords: "delve", "testament", "tapestry", "unlock", "seamless", "game-changer", "revolutionary", "groundbreaking", "moreover", "furthermore", "in conclusion", "shines a light", "treasure trove", "leverage", "robust", "key takeaway", "elevate", "cutting-edge", "beacon", "look no further".
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

      for (const threadTweets of groupedThreads) {
        let threadContent = "";

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

  async generateMarkdownFromCombined(threads, linkedinPosts, retries = 3) {
    try {
      if ((!threads || threads.length === 0) && (!linkedinPosts || linkedinPosts.length === 0)) {
        logger.warn("No content provided to generateMarkdownFromCombined.");
        return "";
      }

      let combinedPrompt = "";

      if (threads && threads.length > 0) {
        combinedPrompt += "--- TWITTER/X THREADS ---\n\n";
        const groupedThreads = this.groupTweetsByConversation(
          threads.flatMap((thread) => thread.tweets)
        );

        for (const threadTweets of groupedThreads) {
          let threadContent = "";
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

      if (linkedinPosts && linkedinPosts.length > 0) {
        combinedPrompt += "--- LINKEDIN POSTS ---\n\n";
        for (const post of linkedinPosts) {
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

CONTENT FILTERING RULE (CRITICAL):
- Ignore and completely filter out any threads or posts that are low-value noise, advertisements, self-promotional spam, hiring announcements, open/closed polls, or generic marketing fluff.
- Only generate formatted articles for items containing genuine, high-quality technical insights, architecture lessons, programming guides, or actual tools/libraries.

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

      const prompt = `
You are a world-class technical LinkedIn copywriter for developer and AI audiences.

Write ONE high-engagement summary post from the scraped content. Drive traffic to GitHub.

GitHub URL: ${githubUrl}

Content:
${combinedPrompt}

=== 2026 LINKEDIN VIRALITY RULES ===
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

BODY:
- Heavy whitespace (double newlines between paragraphs)
- 3-5 short paragraphs
- Highlight 3-4 specific tools/insights
- MANDATORY: You MUST include this exact single line (do not break it or change the wording):
"Full resource list and tools → ${githubUrl}"

CTA:
End with exactly ONE strong, specific question that drives comments and is directly relevant to the article content.

HASHTAGS:
Exactly 3-5 highly targeted hashtags on their own line at the very end. Mix 1 broad + 2-3 niche. Do not overuse or add generic ones.

=== BODY RULES (Strict) ===
- Use double newlines between paragraphs for mobile readability.
- Use "• " for bullets (never * or -).
- Deliver specific, actionable, or concrete details.
- Sound like a senior engineer — direct and practical (no generic praises or roundups).
- Remove any hype, flowery, or overly polished corporate language.
- Never use words like "wild", "next-gen", or "impressive" even if they feel natural.
- Never use phrases like "push boundaries", "pushing boundaries", or similar dramatic framing.
- Avoid words like "making waves", "robust", or "powerful" even when describing technical achievements.
- Never use "significant" or "major" as descriptors in the postText.
- Avoid corporate-sounding phrases like "translating that potential", "demands a structured approach", or "It's more than just...".
- Explicitly explain why the update matters for developers (performance, cost, workflow impact, etc.).
- Prefer concrete numbers and real usage claims over general statements.
- EMOJIS: Use 0–3 emojis maximum per post as visual anchors (e.g., at the start of the hook or as bullet replacements). Never use them as decoration or spam.
- @TAGGING: Tag 0–2 relevant people only (e.g., original content creators like @turtlesoupy or @Presidentlin). Never tag excessively or randomly.

=== STRICT RULES ===
NEVER use banned/hype words: game-changer, nailed it, elegantly, truly stands out, seamless, revolutionary, groundbreaking, advanced, next-gen, cutting-edge, wild, impressive, significant, critical step, sophisticated, powerful, most powerful, signaling, broader reach, push boundaries, pushing boundaries, extensibility, masterclass, paving the way, etc.
Follow ALL rules from the SYSTEM_PROMPT.
Write like a senior engineer sharing useful findings.

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

  async selectBestArticlesForLinkedIn(articles, retries = 3) {
    try {
      const list = articles.map((art, idx) => `[Index ${idx}] Topic: "${art.title}"`).join("\n");
      const prompt = `
You are a top-tier senior tech content strategist with deep expertise in LinkedIn growth for developer and AI audiences.

Your task: Analyze the list of curated tech articles below and select the single BEST article (or at most two if they are highly complementary) to write a high-engagement, scroll-stopping LinkedIn post.

=== 2026 ENGAGEMENT & SELECTION CRITERIA ===
1. HIGH-SIGNAL CONTENT (VERY HIGH WEIGHT) — Prioritize articles with concrete numbers, benchmarks, pricing, speed claims, real usage data, or direct comparisons. Avoid generic "updates" or broad roundups unless they contain strong quantifiable claims.
2. ACTIONABILITY & UTILITY (HIGH WEIGHT) — Can a developer or engineer immediately use, bookmark, or apply this? Curations, tools, frameworks, and practical guidebooks perform best.
3. STORYTELLING & CURIOSITY GAP — Does this topic have a high storytelling potential? Is there a surprising benchmark, an elegant architecture design, or a contrarian take we can hook readers with?
4. TRENDING COMMUNITY IRRELEVANCE — Is this topic highly relevant and trending in AI, LLM, devops, or software engineering circles?
5. AVOID ADVERTISING & SPAM — Completely avoid selecting job postings, generic announcements, polls, or motivational/career fluff.

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
          return this.selectBestArticlesForLinkedIn(articles, retries - 1);
        }
        throw error;
      }
    } catch (error) {
      logger.error("Error in selectBestArticlesForLinkedIn:", error);
      throw error;
    }
  }

  async generateLinkedInMasterPost(selectedArticles, retries = 3) {
    try {
      let context = "";
      selectedArticles.forEach((art, i) => {
        context += `=== ARTICLE #${i+1} ===\n`;
        context += `Topic: ${art.title}\n`;
        context += `GitHub URL: ${art.githubUrl}\n`;
        context += `Content:\n${art.fullContent}\n\n`;
      });

      const githubUrl = selectedArticles.length > 0 ? selectedArticles[0].githubUrl : "";

      const prompt = `
You are a top-tier LinkedIn content creator for tech/AI/developer audiences.

Write ONE high-performing LinkedIn post based on the article(s) below.

=== ARTICLE CONTENT ===
${context}
=== END ===

GitHub URL: ${githubUrl}

=== VIRAL LINKEDIN POST FORMULA ===

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

BODY:
Use double newlines between every paragraph for whitespace.
3-5 short paragraphs max.
Deliver specific, actionable value from the article.
Use bullets for key takeaways (max 5).

=== MANDATORY LINK RULE ===
In the postText property of your JSON, you MUST include this exact text on a single, continuous line (do not break it across lines or place this in the slidePoints array):
Full resource list → ${githubUrl}

CTA:
End with exactly ONE strong, specific question that drives comments and is directly relevant to the article content.

HASHTAGS:
Exactly 3-4 targeted hashtags on the last line of postText.

=== STYLE NOTE ===
If the content is a major announcement with benchmarks, pricing, or release details, write it in a direct "tech news + analysis" style rather than a neutral curation summary. Lead with the most important concrete claim.

=== BODY RULES (Strict) ===
- Use double newlines between paragraphs for mobile readability.
- Use "• " for bullets (never * or -).
- Deliver specific, actionable, or concrete details.
- Sound like a senior engineer — direct and practical (no generic praises or roundups).
- Remove any hype, flowery, or overly polished corporate language.
- Never use words like "wild", "next-gen", or "impressive" even if they feel natural.
- Never use phrases like "push boundaries", "pushing boundaries", or similar dramatic framing.
- Avoid words like "making waves", "robust", or "powerful" even when describing technical achievements.
- Never use "significant" or "major" as descriptors in the postText.
- Avoid corporate-sounding phrases like "translating that potential", "demands a structured approach", or "It's more than just...".
- Explicitly explain why the update matters for developers (performance, cost, workflow impact, etc.).
- Prefer concrete numbers and real usage claims over general statements.
- EMOJIS: Use 0–3 emojis maximum per post as visual anchors (e.g., at the start of the hook or as bullet replacements). Never use them as decoration or spam.
- @TAGGING: Tag 0–2 relevant people only (e.g., original content creators like @turtlesoupy or @Presidentlin). Never tag excessively or randomly.

=== VISUAL SLIDE ===
title: Max 50 characters (punchy value statement)
slidePoints: Exactly 3 technical bullet points (each max 65 chars, starting with a clear value). Bullet points MUST focus on technical details. No links or resource links in this array!
slideTagline: 5-8 words, specific and benefit-focused (avoid generic phrases like "Tech updates for developers" or general roundups).
originalImage: Best image URL or null
slideTagline and slidePoints must also follow the anti-hype rules (no "pushing boundaries", "advanced", "cutting-edge", "next-gen", etc.).

=== STRICT RULES ===
NEVER use banned/hype words: game-changer, nailed it, elegantly, truly stands out, seamless, revolutionary, groundbreaking, advanced, next-gen, cutting-edge, wild, impressive, significant, significantly, major, majorly, critical step, sophisticated, powerful, most powerful, signaling, broader reach, push boundaries, pushing boundaries, extensibility, masterclass, paving the way, etc.
Sound like a senior engineer sharing a practical win.
Follow ALL rules from the SYSTEM_PROMPT.

Return ONLY valid raw JSON.

JSON schema:
{
  "postText": string (full post with \\n for line breaks),
  "title": string (max 50 chars),
  "slidePoints": array of exactly 3 strings (max 65 chars each),
  "slideTagline": string (5-8 words),
  "originalImage": string or null
}
`;

      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          postText: { type: SchemaType.STRING },
          title: { type: SchemaType.STRING },
          slidePoints: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.STRING },
            minItems: 3,
            maxItems: 3
          },
          slideTagline: { type: SchemaType.STRING },
          originalImage: { type: SchemaType.STRING, nullable: true }
        },
        required: ["postText", "title", "slidePoints", "slideTagline"]
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
        if (!data.postText || !data.title) {
          throw new Error("Invalid response format: missing postText or title");
        }
        // Validate slidePoints: must be an array; normalize to exactly 3 items
        if (!Array.isArray(data.slidePoints) || data.slidePoints.length === 0) {
          throw new Error("Invalid response format: slidePoints must be a non-empty array");
        }
        // Pad to 3 items if shorter, slice if longer
        while (data.slidePoints.length < 3) {
          data.slidePoints.push(data.slidePoints[data.slidePoints.length - 1] || "");
        }
        data.slidePoints = data.slidePoints.slice(0, 3);
        // Ensure slideTagline has a fallback
        if (!data.slideTagline) data.slideTagline = "Curated by AI \u00b7 Updated Weekly";
        return data;
      } catch (error) {
        logger.error("GeminiService: JSON parsing error in generateLinkedInMasterPost:", error);
        if (retries > 0) {
          logger.warn(`Error in generateLinkedInMasterPost, retrying in 30 seconds... (${retries} retries remaining)`);
          await sleep(30000);
          return this.generateLinkedInMasterPost(selectedArticles, retries - 1);
        }
        throw error;
      }
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

    return Array.from(conversations.values());
  }
}

module.exports = new GeminiService();
