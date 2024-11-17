const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../../config");
const { logger } = require("../utils/helpers");

class GeminiService {
  constructor() {
    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.model = this.genAI.getGenerativeModel({
      model: "gemini-1.5-flash",
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.8,
        maxOutputTokens: 100000,
      },
    });

    this.systemPrompt = `
You are a professional content curator and markdown writer. Transform tweets into engaging markdown articles that MUST follow this exact format:

---

### 💻 {Clear Technical Title}

{Main technical explanation and context - focus on the core technical concept}

Key Points:
• {Technical insight 1 - specific and actionable}
• {Technical insight 2 - focus on implementation}
• {Technical insight 3 - best practices or tips}

🔍 Technical Details:
{Detailed technical explanation with code examples if present. Include syntax highlighting when showing code.}

🚀 Implementation:
{Step-by-step practical implementation guide or usage instructions}

🔗 Resources:
{Formatted links from the tweet with descriptive titles}

---

Important rules:
1. Always include section separators (---)
2. Always start with H3 header (###) and emoji
3. Always format links as [descriptive title](url)
4. Always include practical implementation steps with 🚀
5. Always maintain professional technical tone
6. Focus on code examples and technical details
7. Group related tweets together coherently
8. Keep explanations clear and concise
`;
  }

  async generateChat() {
    try {
      return await this.model.startChat({
        history: [
          {
            role: "user",
            parts: [this.systemPrompt],
          },
          {
            role: "model",
            parts: ["I will strictly follow the markdown format provided."],
          },
        ],
      });
    } catch (error) {
      logger.error("Error creating Gemini chat:", error);
      throw new Error("Failed to initialize Gemini chat");
    }
  }

  async generateThreadMarkdown(tweets) {
    try {
      const chat = await this.generateChat();

      const tweetTexts = tweets.map((t) => ({
        text: t.text,
        links: t.links,
      }));

      const prompt = `
Transform these tweets into a markdown article:

Tweet Content:
${JSON.stringify(tweetTexts, null, 2)}

Remember to:
1. Use the exact format provided
2. Include all external links
3. Make content engaging and valuable
4. Add relevant technical context
5. Include clear call to action`;

      // Try up to 3 times to get valid markdown
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const result = await chat.sendMessage(prompt);
          const markdown = result.response.text();

          const validation = this.validateMarkdown(markdown);
          if (validation.isValid) {
            return markdown;
          }

          logger.warn(
            `Attempt ${attempt}: Invalid markdown - ${validation.failures.join(
              ", "
            )}`
          );

          if (attempt === 3) {
            const fixed = this.fixMarkdown(markdown);
            const fixedValidation = this.validateMarkdown(fixed);
            if (fixedValidation.isValid) {
              return fixed;
            }
            throw new Error("Failed to generate valid markdown after fixes");
          }
        } catch (error) {
          if (attempt === 3) throw error;
          await sleep(1000); // Wait before retry
        }
      }
    } catch (error) {
      logger.error("Error generating markdown:", error);
      throw new Error("Markdown generation failed");
    }
  }

  validateMarkdown(markdown) {
    const failures = [];

    if (!markdown.includes("### ")) failures.push("Missing H3 header");
    if (!markdown.includes("---")) failures.push("Missing separators");
    if (!markdown.match(/🚀|📱|💻|🔗/)) failures.push("Missing emojis");
    if (!markdown.includes("](")) failures.push("Missing formatted links");

    const sections = markdown.split("---").filter((s) => s.trim());
    if (sections.length === 0) failures.push("Empty content");

    return {
      isValid: failures.length === 0,
      failures,
    };
  }

  fixMarkdown(markdown) {
    let fixed = markdown;

    // Add separators if missing
    if (!fixed.includes("---")) {
      fixed = "---\n\n" + fixed + "\n\n---";
    }

    // Fix header
    if (!fixed.includes("### ")) {
      fixed = fixed.replace(/---\n\n/, "---\n\n### 📱 Technical Update\n\n");
    }

    // Fix links
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    fixed = fixed.replace(urlRegex, (url) => {
      if (!fixed.includes(`](${url})`)) {
        return `[${url}](${url})`;
      }
      return url;
    });

    // Add call to action if missing
    if (!fixed.includes("🚀")) {
      fixed += "\n\n🚀 Check out these resources to learn more!";
    }

    return fixed;
  }

  async generateMarkdown(tweets) {
    try {
      const conversations = this.groupTweetsByConversation(tweets);
      const markdownPromises = conversations.map((conversation) =>
        this.generateThreadMarkdown(conversation)
      );

      const results = await Promise.all(markdownPromises);
      return results.filter(Boolean).join("\n\n");
    } catch (error) {
      logger.error("Error in markdown generation:", error);
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