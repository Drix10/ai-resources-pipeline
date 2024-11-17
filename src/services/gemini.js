const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("../../config");
const { logger, handleError } = require("../utils/helpers");

class GeminiService {
  constructor() {
    try {
      this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
      this.model = this.genAI.getGenerativeModel({ model: "gemini-pro" });
      logger.info("Gemini client initialized successfully");
    } catch (error) {
      handleError(error, "Failed to initialize Gemini client");
      throw error;
    }
  }

  async generateMarkdown(tweets) {
    if (!Array.isArray(tweets) || tweets.length === 0) {
      logger.warn("Empty or invalid tweet array received");
      return [];
    }

    const processedTweets = await Promise.all(
      tweets.map(async (tweet) => {
        try {
          const markdown = await this.generateThreadMarkdown(tweet);
          return { ...tweet, markdown };
        } catch (error) {
          handleError(error, `Error generating markdown for tweet ${tweet.id}`);
          return null;
        }
      })
    );

    // Filter out failed generations
    return processedTweets.filter(Boolean);
  }

  async generateThreadMarkdown(tweet) {
    try {
      const prompt = this.constructPrompt(tweet);
      const result = await this.model.generateContent(prompt);
      const markdown = result.response.text();
      
      if (!this.isValidMarkdown(markdown)) {
        throw new Error("Generated markdown does not meet quality standards");
      }

      return this.formatMarkdown(markdown, tweet);
    } catch (error) {
      handleError(error, "Error in markdown generation");
      throw error;
    }
  }

  constructPrompt(tweet) {
    return `Create a comprehensive Markdown document for this developer resource tweet thread.

Tweet Information:
${JSON.stringify({
  thread: tweet.thread,
  topics: tweet.topics,
  links: tweet.entities?.urls || [],
  hashtags: tweet.entities?.hashtags || []
}, null, 2)}

Requirements:
1. Start with a clear, descriptive title (H1)
2. Add a brief summary/description
3. Include all links with descriptions
4. Format code snippets in appropriate code blocks
5. Organize content by topics/sections
6. Add relevant tags at the bottom
7. Maintain professional formatting

Format the content to be easily readable and well-structured. Include all relevant information from the thread.`;
  }

  formatMarkdown(markdown, tweet) {
    const timestamp = new Date(tweet.created_at).toISOString().split('T')[0];
    
    // Add metadata header
    const header = `---
tweet_id: ${tweet.id}
author_id: ${tweet.author_id}
created_at: ${timestamp}
topics: ${tweet.topics.join(', ')}
---

`;

    // Clean up and standardize markdown
    let formattedMarkdown = markdown
      .trim()
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .replace(/```(\w+)\n\n/g, '```$1\n') // Fix code block formatting
      .replace(/\n\s*\n\s*\n/g, '\n\n'); // Standardize spacing

    return header + formattedMarkdown;
  }

  isValidMarkdown(markdown) {
    // Basic validation checks
    const requirements = [
      {
        test: /^#\s.+/m,
        message: "Missing main title (H1)"
      },
      {
        test: /##\s.+/m,
        message: "Missing sections (H2)"
      },
      {
        test: /\[.+\]\(.+\)/,
        message: "Missing formatted links"
      },
      {
        test: /.{100,}/,
        message: "Content too short"
      },
      {
        test: /\n{2}Tags?:|Keywords?:/i,
        message: "Missing tags section"
      }
    ];

    const failures = requirements
      .filter(req => !req.test.test(markdown))
      .map(req => req.message);

    if (failures.length > 0) {
      logger.warn("Markdown validation failed:", { failures });
      return false;
    }

    return true;
  }

  async retryGeneration(tweet, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        const markdown = await this.generateThreadMarkdown(tweet);
        if (this.isValidMarkdown(markdown)) {
          return markdown;
        }
        logger.warn(`Attempt ${i + 1}: Generated invalid markdown, retrying...`);
      } catch (error) {
        if (i === attempts - 1) throw error;
        logger.warn(`Attempt ${i + 1} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
    throw new Error(`Failed to generate valid markdown after ${attempts} attempts`);
  }
}

module.exports = new GeminiService();