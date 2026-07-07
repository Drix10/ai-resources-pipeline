const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
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
You are an expert technical writer and curator. Your writing style is direct, clear, and highly professional, completely free of generic AI-generated filler and corporate fluff.

Transform the Twitter threads and their resources into high-value technical articles following these EXACT formatting and style guidelines:

### 🔗 {Clear Resource Category Title}

{Brief introduction about this collection of resources from the thread}

Featured Resources:
{Numbered list of resources with descriptions from the thread context}

Key Highlights:

• {Main benefit or feature from thread context 1}

• {Main benefit or feature from thread context 2}

• {Main benefit or feature from thread context 3}

💡 Pro Tips:
{Practical implementation advice derived from the thread}

🔗 Resources:

{All external links and images from the thread with descriptive titles}

---

STYLE & ANTI-AI DIRECTIONS:
1. BAN LIST — Absolutely NEVER use these AI buzzwords: "delve", "testament", "tapestry", "unlock", "seamless", "game-changer", "revolutionary", "groundbreaking", "moreover", "furthermore", "in conclusion", "shines a light", "treasure trove", "leverage", "robust", "key takeaway", "elevate".
2. NO MARKETING FLUFF — Avoid empty adjectives. Instead of "powerful framework", say "framework". Instead of "lightning-fast query system", state the actual benchmark or mechanism if present (or just say "query system").
3. VARIANCE — Write with varied sentence lengths (mix short, punchy 5-word statements with longer explanatory sentences).
4. HUMAN VOICE — Write as if you are explaining this directly to another senior engineer. Be technical, precise, and objective.

Important rules:
1. Always include section separators (---)
2. Always start with H3 header (###) and emoji
3. Always format links as [descriptive title](url) and for images this: ![Image](img url)
4. Always include the original context from the thread
5. Always maintain professional tone
6. Group related resources together coherently
7. Keep descriptions clear and concise
8. Never skip any sections
9. Never add fake links or resources
10. Always include ALL external links from the thread
11. Do not remove any information which was provided in the original tweet
12. Do not generate any other text, other than the articles

Note:
1. Always include the original context from the thread, and make one for all the threads provided
2. If no resources are provided, do not include the Resources section
3. Always embed images and links from the thread with correct descriptions
4. Fill it with your best knowledge of the topic, if not enough context is provided.
5. When alot of context is missing, write a detailed introduction about the topic and provide links to more information.
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
You are a professional technical content curator. Transform this each of the Twitter thread into a high-quality markdown article following these EXACT specifications:

FORMAT REQUIREMENTS:
1. HEADER (MANDATORY):
   - Start with "### " followed by ONE emoji and title
   - Emoji options: 🤖 for technical, 🚀 for tools, 💡 for tips, ✨ for features
   - Title format: "### [emoji] Main Topic - Subtopic"
   - Example: "### 🤖 Observability - RAG Implementation"

2. INTRODUCTION (MANDATORY):
   - 2-3 sentences maximum
   - Explain what the article covers
   - No marketing language
   - Professional tone
   - No emojis in introduction

3. KEY POINTS (MANDATORY):
   - Start with "Key Points:"
   - Add TWO newlines after "Key Points:"
   - Use bullet points with "•" symbol (not for Images)
   - 3-5 points maximum
   - Each point must be separated by TWO newlines
   - Each point: single line, clear benefit
   - No emojis in points
   - Example:
     Key Points:

     • First key point about the topic

     • Second key point about functionality

     • Third key point about benefits

     • Fourth key point describing main feature

     • Fifth key point highlighting unique value

   SPACING RULES FOR POINTS:
   - Double newline after section header
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
   - Each step: action-oriented, clear
   - Example:
     🚀 Implementation:
     1. First Step: What to do first
     2. Second Step: What to do next
     3. Third Step: Final action

5. RESOURCES (MANDATORY):
   - Start with "🔗 Resources:"
   - Format: • [Tool Name](url) - Brief description
   - Format: ![Image](Image url)
   - Description: max 10 words
   - Only include verified links
   - Example:
     🔗 Resources:

     • [Tool Name](https://example.com) - What this tool helps with

     • [Another Tool](https://example.com) - What this tool helps with

     ![Image](https://example.png)

STRICT FORMATTING RULES:
- Maintain exact spacing shown in example
- No bold or italic text
- No extra emojis
- No extra sections
- No marketing language
- No placeholder content
- No "Learn more" or similar phrases
- No colons in descriptions
- No extra horizontal rules
- No descriptions for Images

Here's the content to transform:
${combinedPrompt}

Here's the example format:
${exampleFormat}

Remember:
1. Keep it professional and technical
2. Follow exact spacing and formatting
3. No deviations from the structure
4. No extra decorative elements
5. Verify all links and images's format before including
6. Process each conversation as a single unit.
7. Do not repeat content or links within a single article.
8. Make one Formatted article for each of the Tweet's context provided, ideally 10-15 at once depending on input
9. Do not remove any information which was provided in the original tweet
10. Do not generate any other text, other than the articles

Note:
1. Always include the original context from the thread
2. If no resources are provided, do not include the Resources section
3. Always embed images and links from the thread with correct descriptions
4. Fill it with your best knowledge of the topic, if not enough context is provided.
5. When alot of context is missing, write a detailed introduction about the topic and provide links to more information.`;

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
      const waitTime = 60000 - timeSinceLastRequest;
      if (waitTime > 0) {
        logger.info(
          `Gemini Rate limit: Waiting ${
            waitTime / 1000
          } seconds before next request`
        );
        await sleep(waitTime);
        this.requestsThisMinute = 0;
        this.lastRequestTime = Date.now();
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
You are an expert technical writer and curator. Transform the following Twitter threads and LinkedIn posts into a high-quality markdown article following these EXACT specifications:

CONTENT FILTERING RULE (CRITICAL):
- Ignore and completely filter out any threads or posts that are low-value noise, advertisements, self-promotional spam, hiring announcements, open/closed polls, or generic marketing fluff.
- Only generate formatted articles for items containing genuine, high-quality technical insights, architecture lessons, programming guides, or actual tools/libraries.

ANTI-AI WRITING DIRECTIVES (CRITICAL):
1. BANNED WORDS — Absolutely DO NOT use these words or phrases anywhere in your output: "delve", "testament", "tapestry", "unlock", "seamless", "game-changer", "revolutionary", "groundbreaking", "moreover", "furthermore", "in conclusion", "shines a light", "treasure trove", "leverage", "robust", "key takeaway", "elevate".
2. TONE & VOCABULARY — Write in a direct, objective, and analytical tone. Avoid motivational cliches, hype words, and marketing adjectives (e.g. use "database", not "cutting-edge database").
3. VARIANCE — Write with varied sentence lengths. Use short, punchy statements mixed with longer explanatory sentences to sound natural and human.

FORMAT REQUIREMENTS:
1. HEADER (MANDATORY):
   - Start with "### " followed by ONE emoji and title
   - Emoji options: 🤖 for technical, 🚀 for tools, 💡 for tips, ✨ for features
   - Title format: "### [emoji] Main Topic - Subtopic"
   - Example: "### 🤖 Observability - RAG Implementation"

2. INTRODUCTION (MANDATORY):
   - 2-3 sentences maximum
   - Explain what the article covers
   - No marketing language
   - Professional tone
   - No emojis in introduction

3. KEY POINTS (MANDATORY):
   - Start with "Key Points:"
   - Add TWO newlines after "Key Points:"
   - Use bullet points with "•" symbol (not for Images)
   - 3-5 points maximum
   - Each point must be separated by TWO newlines
   - Each point: single line, clear benefit
   - No emojis in points

   SPACING RULES FOR POINTS:
   - Double newline after section header
   - Double newline between each bullet point
   - Double newline after last bullet point

4. IMPLEMENTATION (IF APPLICABLE):
   - Start with "🚀 Implementation:"
   - Numbered steps (1. 2. 3. etc)
   - 3-5 steps maximum
   - Each step: action-oriented, clear

5. RESOURCES (MANDATORY):
   - Start with "🔗 Resources:"
   - Format: • [Tool Name](url) - Brief description
   - Format: ![Image](Image url)
   - Description: max 10 words
   - Only include verified links

STRICT FORMATTING RULES:
- Maintain exact spacing shown in example
- No bold or italic text
- No extra emojis
- No extra sections
- No marketing language
- No placeholder content
- No "Learn more" or similar phrases
- No colons in descriptions
- No extra horizontal rules
- No descriptions for Images

Here's the content to transform:
${combinedPrompt}

Here's the example format:
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
You are a premium technical copywriter and SEO expert. Your task is to analyze the following list of scraped content (tweets and LinkedIn posts) and draft ONE highly professional, engaging, and SEO-optimized LinkedIn summary post that highlights the top insights or resources found in this content.

Here is the GitHub URL where the full curated list of resources has been uploaded:
${githubUrl}

Here is the scraped content:
${combinedPrompt}

INSTRUCTIONS FOR THE LINKEDIN POST:
1. Craft a compelling HOOK as the first sentence. It must intrigue professional readers in tech, development, or AI and encourage them to click "see more".
2. Organize the body into readable paragraphs with ample white space. Do NOT make blocks of text.
3. Call out 3-4 top key takeaways, tools, or resources found in the scraped content. Focus on high-value, educational, or technical quality.
4. Promote the GitHub repository link (${githubUrl}) clearly as the place where all resources are listed, formatted nicely.
5. End with 3-5 relevant, highly targeted hashtags (e.g., #AI, #WebDevelopment, #TechResources).
6. Do NOT use fake urls.
7. Return your response in VALID JSON format. The JSON must contain exactly these two keys:
   - "postText": A string containing the full, raw text of your LinkedIn post (including spacing, emoji, bullet points, and hashtags).
   - "imageToAttach": The URL of the single best image from the scraped content to attach to the post. If no suitable image exists, set this to null.

Ensure the output is ONLY the raw JSON object, starting with { and ending with }. Do not wrap it in markdown code blocks like \`\`\`json.
`;

      try {
        await this.checkRateLimit();
        const responseModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await responseModel.generateContent(prompt);
        let text = result.response.text().trim();
        
        // Clean up markdown block if model output it
        if (text.startsWith("```")) {
          text = text.replace(/```(json)?/g, "").trim();
        }

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
You are a senior tech content strategist with deep expertise in LinkedIn growth for developer and AI audiences.

Your task: From the list of curated tech articles below, select the 1 article (or at most 2 if two topics are clearly complementary) that will make the BEST LinkedIn post for maximum reach and engagement.

Evaluation criteria (score each mentally 1-10 on each):
1. TRENDING RELEVANCE — Is this topic hot RIGHT NOW in tech/AI/dev communities?
2. BROAD APPEAL — Will this resonate with developers, AI engineers, CTOs, and tech enthusiasts?
3. STORYTELLING POTENTIAL — Can we write a compelling hook around this? Does it have a surprising angle?
4. ACTIONABILITY — Can a reader immediately apply something from this? Frameworks, tools, and how-tos score high.
5. UNIQUENESS — Is this a fresh take or a well-covered topic? Niche but important scores highest.

IMPORTANT RULES:
- AVOID selecting anything that is primarily a job listing, generic motivational content, recruiting news, or company announcement
- PREFER topics related to: AI tools/models, developer productivity, architecture patterns, new frameworks/libraries, security insights, performance optimization
- SELECT the topic with the highest combined score across all criteria

Articles list:
${list}

Return ONLY a raw JSON object (no markdown, no commentary) with exactly one key:
- "selectedIndices": An array of integers (the index numbers of your selected articles, max 2)

Example output: {"selectedIndices": [2]}
`;

      try {
        await this.checkRateLimit();
        const responseModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await responseModel.generateContent(prompt);
        let text = result.response.text().trim();
        
        if (text.startsWith("```")) {
          text = text.replace(/```(json)?/g, "").trim();
        }

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
You are a world-class LinkedIn content creator specializing in tech, AI, and software development. You have written viral posts that regularly receive 50K+ impressions. You deeply understand the LinkedIn algorithm and what makes professionals stop scrolling.

Your task: Write ONE masterclass LinkedIn post based on the article content below. This post must follow the proven 2025 LinkedIn virality formula precisely.

=== ARTICLE CONTENT ===
${context}
=== END CONTENT ===

GitHub Resource URL (for mention): ${githubUrl}

=== THE VIRAL LINKEDIN POST FORMULA ===

PART 1: THE HOOK (CRITICAL — first 200 characters)
- This is the text visible BEFORE the "see more" button
- Must create an INFORMATION GAP — a reason to click and read more
- Use ONE of these proven hook styles:
  a) Bold, specific claim: "I analyzed 100 AI tools. Only 3 are actually worth your time."
  b) Surprising statistic: "87% of developers are using [X] wrong. Here's the correct approach."
  c) Contrarian take: "Hot take: [popular belief] is completely wrong for your stack in 2025."
  d) Numbered specific: "5 [X] mistakes that are silently costing your team 10+ hours/week."
  e) Problem statement: "[specific pain point] is the #1 reason senior devs leave their jobs."
- NO generic openings like "Excited to share", "I wanted to discuss", "In today's world"
- NO vague questions like "What do you think?" or "Agree?"
- The hook MUST directly relate to the article topic
- Max 200 characters for the hook line

PART 2: THE BODY (the value-add)
- MANDATORY: empty line after the hook before starting body
- Write 3-5 punchy paragraphs, each 1-3 sentences MAX
- MANDATORY: empty line between EVERY paragraph (LinkedIn renders single newlines as spaces)
- Use bullet points or numbered lists for key takeaways (3-5 items max)
- Each bullet must be concrete and specific — no vague generalities
- Include the SPECIFIC insight, tool, framework, or lesson from the article
- Write in first-person where natural to feel authentic, not corporate
- NO bold/italic (LinkedIn strips most markdown)
- NO walls of text — if a section is longer than 3 lines, break it up
- ANTI-AI RULE: Do NOT use generic robotic filler or transitions (e.g., "In conclusion", "Moreover", "Furthermore").
- ANTI-AI RULE: Completely avoid words like "delve", "testament", "tapestry", "unlock", "seamless", "game-changer", "revolutionary", "groundbreaking", "treasure trove", "leverage", "robust", "elevate". Instead use simple, direct words like "look at", "show", "enable", "simple", "useful", "use", "improve".

PART 3: THE GITHUB MENTION
- Add ONE line that mentions the GitHub resource: "Full resource list → (link in comments 👇)"
- DO NOT paste the actual URL in the post body — LinkedIn's algorithm penalizes outbound links
- The actual URL will be posted separately in the first comment

PART 4: THE ENGAGEMENT CTA
- Ask ONE specific, thought-provoking question that invites expertise-sharing
- Examples: "Which of these have you already tried in production?", "What's the biggest blocker you hit with [topic]?"
- Avoid: "What do you think?", "Thoughts?", "Agree or disagree?" — these are too generic

PART 5: HASHTAGS
- End with exactly 3-4 hashtags — no more
- Mix: 1 broad (#AI or #SoftwareDevelopment), 1 niche (#MLOps or #LLMs), 1 community (#BuildInPublic or #DevCommunity)
- Place them on their own line at the very end

=== SLIDE DETAILS ===
Also generate details for a companion visual slide image:
- "title": Max 50 chars. A punchy headline for the slide. Not the article title — make it a VALUE STATEMENT (e.g., "5 AI Tools Devs Are Sleeping On" not "AI Resources Collection")
- "slidePoints": Exactly 3 bullet points for the slide. Each max 65 chars. Make them specific, numbered insights or powerful one-liners that complement the post. Must use simple, natural language (no AI buzzwords).
- "slideTagline": A short 5-8 word footer tagline (e.g., "Curated by AI · Updated Weekly")

=== IMAGE SELECTION ===
- "originalImage": If the article content contains a high-quality image URL (not a profile photo, avatar, or tiny icon), return it. Otherwise return null.

=== OUTPUT FORMAT ===
Return ONLY a raw JSON object (no markdown code blocks, no commentary before or after). Structure:
{
  "postText": "[full formatted post text with proper newlines — use \\n for newlines]",
  "title": "[slide title — max 50 chars]",
  "slidePoints": ["[point 1 — max 65 chars]", "[point 2 — max 65 chars]", "[point 3 — max 65 chars]"],
  "slideTagline": "[footer tagline — 5-8 words]",
  "originalImage": "[image url or null]"
}

CRITICAL CHECKS before outputting:
✓ Hook is under 200 chars and creates curiosity
✓ Empty lines between every paragraph
✓ GitHub URL is NOT in the post body (mention "link in comments" instead)
✓ CTA asks a specific, engagement-driving question
✓ Exactly 3-4 hashtags at the end
✓ slidePoints are specific, under 65 chars each, and contain no AI buzzwords
✓ Output is valid JSON only
`;

      try {
        await this.checkRateLimit();
        const responseModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await responseModel.generateContent(prompt);
        let text = result.response.text().trim();
        
        if (text.startsWith("```")) {
          text = text.replace(/```(json)?/g, "").trim();
        }

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
