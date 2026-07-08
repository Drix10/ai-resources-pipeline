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
You are a professional technical content curator and senior engineer. Your task is to transform each of the provided Twitter threads/conversations into a high-quality, professional markdown article following these EXACT formatting and style specifications:

=== ANTI-AI & TONE DIRECTIVES ===
Follow all rules from the system prompt (banned words, senior-engineer tone, no hype, sentence variance).

FORMAT REQUIREMENTS:
1. HEADER (MANDATORY):
   - Start with "### " followed by ONE emoji and title
   - Emoji options: 🤖 for technical, 🚀 for tools, 💡 for tips, ✨ for features
   - Title format: "### [emoji] Main Topic - Subtopic"
   - Example: "### 🤖 Observability - RAG Implementation"

2. INTRODUCTION (MANDATORY):
   - 2-3 sentences maximum explaining what the article covers
   - No marketing language, pure technical value
   - Professional tone
   - No emojis in the introduction text

3. KEY POINTS (MANDATORY):
   - Start with "Key Points:"
   - Add TWO newlines after "Key Points:"
   - Use bullet points with "•" symbol (not for Images)
   - 3-5 points maximum
   - Each point: single line, clear benefit/insight, no emojis, no bold/italic formatting
   
   SPACING RULES FOR POINTS (STRICT):
   - Double newline after "Key Points:"
   - Double newline between each bullet point
   - Double newline after last bullet point
   - Example format:
     Key Points:

     • Point one

     • Point two

     • Point three

4. IMPLEMENTATION (IF APPLICABLE):
   - Start with "🚀 Implementation:"
   - Numbered steps (1. 2. 3. etc)
   - 3-5 steps maximum
   - Each step: action-oriented, clear, technical

5. RESOURCES (MANDATORY):
   - Start with "🔗 Resources:"
   - Format: • [Tool Name](url) - Brief description (max 10 words, no colons inside descriptions)
   - Format: ![Image](Image url) (no descriptions for images)
   - Only include verified links and images directly present in the source text

STRICT FORMATTING RULES:
- Maintain exact spacing shown in the example
- No bold or italic text
- No extra emojis or decorative elements
- No extra sections
- No placeholder content
- No "Learn more" or similar phrases
- No extra horizontal rules
- Keep it highly structured and extremely clean

Here is the content to transform:
${combinedPrompt}

Here is the example format to match exactly:
${exampleFormat}

Remember:
1. Process each conversation as a single unit.
2. Do not repeat content or links within a single article.
3. Make one formatted article for each thread/conversation provided.
4. Do not remove or omit any factual information provided in the original content.
5. Do not generate any other text, other than the articles.
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
You are an expert technical writer, senior software engineer, and content curator. Transform the following Twitter threads and LinkedIn posts into high-quality, professional markdown articles following these EXACT specifications:

CONTENT FILTERING RULE (CRITICAL):
- Ignore and completely filter out any threads or posts that are low-value noise, advertisements, self-promotional spam, hiring announcements, open/closed polls, or generic marketing fluff.
- Only generate formatted articles for items containing genuine, high-quality technical insights, architecture lessons, programming guides, or actual tools/libraries.

=== ANTI-AI & TONE DIRECTIVES ===
Follow all rules from the system prompt (banned words, senior-engineer tone, no hype, sentence variance).

FORMAT REQUIREMENTS:
1. HEADER (MANDATORY):
   - Start with "### " followed by ONE emoji and title
   - Emoji options: 🤖 for technical, 🚀 for tools, 💡 for tips, ✨ for features
   - Title format: "### [emoji] Main Topic - Subtopic"
   - Example: "### 🤖 Observability - RAG Implementation"

2. INTRODUCTION (MANDATORY):
   - 2-3 sentences maximum explaining what the article covers
   - No marketing language, pure technical value
   - Professional tone
   - No emojis in the introduction text

3. KEY POINTS (MANDATORY):
   - Start with "Key Points:"
   - Add TWO newlines after "Key Points:"
   - Use bullet points with "•" symbol (not for Images)
   - 3-5 points maximum
   - Each point: single line, clear benefit/insight, no emojis, no bold/italic formatting

   SPACING RULES FOR POINTS (STRICT):
   - Double newline after "Key Points:"
   - Double newline between each bullet point
   - Double newline after last bullet point

4. IMPLEMENTATION (IF APPLICABLE):
   - Start with "🚀 Implementation:"
   - Numbered steps (1. 2. 3. etc)
   - 3-5 steps maximum
   - Each step: action-oriented, clear, technical

5. RESOURCES (MANDATORY):
   - Start with "🔗 Resources:"
   - Format: • [Tool Name](url) - Brief description (max 10 words, no colons inside descriptions)
   - Format: ![Image](Image url) (no descriptions for images)
   - Only include verified links and images directly present in the source text

STRICT FORMATTING RULES:
- Maintain exact spacing shown in the example
- No bold or italic text
- No extra emojis or decorative elements
- No extra sections
- No placeholder content
- No "Learn more" or similar phrases
- No colons in descriptions
- No extra horizontal rules
- No descriptions for Images

Here is the content to transform:
${combinedPrompt}

Here is the example format to match exactly:
${exampleFormat}

Remember:
1. Keep it professional and technical
2. Follow exact spacing and formatting
3. No deviations from the structure
4. No extra decorative elements
5. Verify all links and images's format before including
6. Process each thread or post as a single unit where applicable.
7. Do not repeat content or links within a single article.
8. Make one Formatted article for each high-quality content item provided.
9. Do not remove any information which was provided in the original content.
10. Do not generate any other text, other than the articles.
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
You are a world-class technical LinkedIn copywriter who creates high-engagement posts for developer and AI audiences.

Your goal: Write ONE premium LinkedIn summary post that highlights the best insights/tools from the scraped content and drives traffic to the GitHub repository.

GitHub URL: ${githubUrl}

Scraped content:
${combinedPrompt}

=== 2026 LINKEDIN VIRALITY RULES (STRICTLY FOLLOW) ===

HOOK (CRITICAL - First 1-3 lines, under 200 characters visible):
Must create a strong curiosity/information gap so people click "see more".
Best performing styles for tech content: 
  Numbered specific claim
  "I analyzed/tested X..." 
  Surprising statistic or result
  Contrarian take ("Most devs do this wrong...")
  Problem statement or "This changed everything"
Make it specific and concrete. Avoid generic openers like "Excited to share" or "In today's world".

BODY:
Use plenty of white space (double newlines between paragraphs).
3-5 short paragraphs maximum (1-3 sentences each).
Highlight 3-4 top specific tools, insights, or frameworks from the content.
Make it skimmable with bullets or numbered lists where natural.
Naturally promote the GitHub as the full curated resource list: "Full resource list and tools → ${githubUrl}"
Keep tone direct, technical, and valuable (like a senior engineer sharing what actually works).

CTA:
End with EXACTLY ONE specific, thought-provoking question that invites expertise-sharing (e.g., "Which of these tools have you tried in production?", "What's the biggest challenge you face with [topic]?").
Avoid weak/generic CTAs like "Thoughts?", "Agree?", or "What do you think?".

HASHTAGS:
Exactly 3-5 highly targeted hashtags on the final line (mix 1 broad + 2-3 niche).

=== ANTI-AI & TONE DIRECTIVES ===
Follow all rules from the system prompt (banned words, senior-engineer tone, no hype, sentence variance).

Return ONLY a valid raw JSON object. No markdown, no explanations.

JSON schema:
{
  "postText": string (full formatted post with proper newlines (use \\n)),
  "imageToAttach": string or null (best image URL from content or null)
}
`;

      // Structured output schema for reliable JSON generation
      const responseSchema = {
        type: SchemaType.OBJECT,
        properties: {
          postText: { type: SchemaType.STRING },
          imageToAttach: {
            type: SchemaType.STRING,
            nullable: true,
            description: "Best image URL from the scraped content or null"
          }
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
1. ACTIONABILITY & UTILITY (HIGH WEIGHT) — Can a developer or engineer immediately use, bookmark, or apply this? Curations, tools, frameworks, and practical guidebooks perform best.
2. STORYTELLING & CURIOSITY GAP — Does this topic have a high storytelling potential? Is there a surprising benchmark, an elegant architecture design, or a contrarian take we can hook readers with?
3. TRENDING COMMUNITY IRRELEVANCE — Is this topic highly relevant and trending in AI, LLM, devops, or software engineering circles?
4. BROAD DEVELOPER APPEAL — Will this resonate deeply with software engineers, AI developers, CTOs, and tech leads?
5. AVOID ADVERTISING & SPAM — Completely avoid selecting job postings, generic announcements, polls, or motivational/career fluff.

Articles list:
${list}

Return ONLY a valid raw JSON object. No markdown, no commentary, no explanations.

JSON schema:
{
  "selectedIndices": array of selected article indices (integers, max 2)
}
`;

      // Structured output schema for reliable JSON generation
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
You are a top-tier LinkedIn content creator specializing in tech, AI, and developer content. You write posts that regularly get high engagement through strong hooks, valuable insights, and conversation-starting CTAs.

Task: Write ONE high-performing LinkedIn post based on the selected article(s) below. Follow the proven 2026 virality formula exactly.

=== ARTICLE CONTENT ===
${context}
=== END ===

GitHub Resource URL: ${githubUrl}

=== VIRAL LINKEDIN POST FORMULA (2026) ===

PART 1: HOOK (Most important - first 1-3 lines, <200 characters)
Create a strong curiosity gap.
Use one of these high-performing styles for tech content:
  Numbered specific ("I tested 47 AI tools. Only these 5 matter.")
  "How I..." or results-first
  Surprising statistic or concrete result
  Contrarian take ("Most developers are using [tool] wrong...")
  Problem statement or "This one change..."
Make it specific and promise value. No generic hooks.

PART 2: BODY
Double newline after the hook.
3-5 short paragraphs (1-3 sentences max each).
Heavy whitespace — use empty lines between paragraphs for mobile readability.
Deliver specific, actionable value from the article (tools, frameworks, lessons, "what actually works").
Use bullets or numbered lists for key takeaways (max 3-5).
Naturally include: "Full resource list → ${githubUrl}"
Keep it skimmable and valuable.

PART 3: CTA
End with EXACTLY ONE strong, specific question that drives comments and conversation (e.g. "Which of these have you already implemented?", "What's your experience with [specific topic]?").
This is critical for algorithm reach.

PART 4: HASHTAGS
Exactly 3-4 targeted hashtags on the last line.

=== VISUAL SLIDE DETAILS ===
Also generate companion slide content:
"title": Max 50 characters. Punchy value statement (not just the article title).
"slidePoints": Exactly 3 specific bullet points (max 65 chars each). Use simple, concrete language.
"slideTagline": 5-8 word footer (e.g. "Curated technical resources • Updated weekly")

=== IMAGE ===
"originalImage": Best high-quality image URL from the article content, or null.

=== ANTI-AI & TONE DIRECTIVES ===
Follow all rules from the system prompt (banned words, senior-engineer tone, no hype, sentence variance).

Return ONLY a valid raw JSON object. No markdown, no explanations.

JSON schema:
{
  "postText": string (full post with \\n for line breaks),
  "title": string (max 50 chars),
  "slidePoints": array of exactly 3 strings (each max 65 characters, simple & concrete),
  "slideTagline": string (5-8 words),
  "originalImage": string or null
}
`;

      // Structured output schema for reliable JSON generation
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
