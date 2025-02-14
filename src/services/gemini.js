const {
  GoogleGenerativeAI,
  HarmBlockThreshold,
  HarmCategory,
} = require("@google/generative-ai");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.safetySettings = [
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
    this.systemPrompt = `
You are a professional content curator and markdown writer. Transform all the Twitter threads and their resources into engaging markdown articles that MUST follow this exact format and make one for each Tweet, don't mix all of them into one and make something like this, different for each, around 10-15 depending on input:


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

Note:
1. Always include the original context from the thread, and make one for all the threads provided
2. If no resources are provided, do not include the Resources section
3. Always embed images and links from the thread with correct descriptions
4. Fill it with your best knowledge of the topic, if not enough context is provided.
5. When alot of context is missing, write a detailed introduction about the topic and provide links to more information.
`;
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 100000,
      },
      safetySettings: this.safetySettings,
      systemInstruction: this.systemPrompt,
    });
  }

  async generateChat() {
    try {
      return this.model.startChat({
        history: [
          {
            role: "user",
            parts: [this.systemPrompt],
          },
          {
            role: "model",
            parts: [
              "I will strictly follow the markdown format and create articles for all the tweets provided one by one.",
            ],
          },
        ],
      });
    } catch (error) {
      logger.error("Error creating Gemini chat:", error);
      throw new Error("Failed to initialize Gemini chat");
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

      console.log(combinedPrompt);

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

Note:
1. Always include the original context from the thread
2. If no resources are provided, do not include the Resources section
3. Always embed images and links from the thread with correct descriptions
4. Fill it with your best knowledge of the topic, if not enough context is provided.
5. When alot of context is missing, write a detailed introduction about the topic and provide links to more information.`;

      try {
        await this.checkRateLimit();
        const result = await this.model.generateContent(prompt);
        let generatedText = result.response.text();
        console.log(generatedText);

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
        console.log(error);
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
    if (!this.lastRequestTime) {
      this.lastRequestTime = 0;
    }
    if (!this.requestsThisMinute) {
      this.requestsThisMinute = 0;
    }

    const now = Date.now();
    if (now - this.lastRequestTime < 60000) {
      if (this.requestsThisMinute >= 55) {
        const waitTime = 60000 - (now - this.lastRequestTime);
        logger.info(
          `Gemini Rate limit: Waiting ${
            waitTime / 1000
          } seconds before next request`
        );
        await sleep(waitTime);
        this.requestsThisMinute = 0;
        this.lastRequestTime = Date.now();
      }
    } else {
      this.requestsThisMinute = 0;
      this.lastRequestTime = now;
    }
    this.requestsThisMinute++;
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
