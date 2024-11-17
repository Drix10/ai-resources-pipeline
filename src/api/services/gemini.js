const { GeminiClient } = require("@google/generative-ai");
const config = require("../../config");
const { logger } = require("../../utils/helpers");

class GeminiService {
  constructor() {
    try {
      this.geminiClient = new GeminiClient({
        keyFilename: config.gemini.apiKey,
      });
      logger.info("Gemini client initialized successfully.");
    } catch (error) {
      logger.error("Failed to initialize Gemini client:", error);
      throw new Error("Gemini API initialization failed.");
    }
  }

  async generateMarkdown(tweets) {
    if (!Array.isArray(tweets) || tweets.length === 0) {
      logger.warn("Empty or invalid tweet array received.");
      return [];
    }

    const markdownTweets = await Promise.all(
      tweets.map(async (tweet) => {
        try {
          const prompt = `Generate a well-formatted Markdown summary for the following tweet:\n${JSON.stringify(
            tweet,
            null,
            2
          )}`;
          const response = await this.geminiClient.generateText({ prompt });
          const markdown = response[0].text;
          return { ...tweet, markdown };
        } catch (error) {
          logger.error("Error generating Markdown for tweet:", tweet.id, error);
          return { ...tweet, markdown: "Markdown generation failed" };
        }
      })
    );
    return markdownTweets;
  }
}

module.exports = new GeminiService();
