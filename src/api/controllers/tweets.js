const { TwitterApi } = require("twitter-api-v2");
const { GeminiClient } = require("@google-cloud/gemini");
const Tweet = require("../models/tweet");
const config = require("../config");
const { sanitizeInput } = require("../utils/helpers");

class TweetsController {
  constructor() {
    this.twitterClient = new TwitterApi({
      appKey: config.twitter.apiKey,
      appSecret: config.twitter.apiSecret,
      accessToken: config.twitter.bearerToken,
    });
    this.geminiClient = new GeminiClient({
      keyFilename: config.gemini.apiKey,
    });
    this.tweetModel = Tweet;
  }

  async fetchAndProcessTweets(keywords, hashtags) {
    keywords = sanitizeInput(keywords);
    hashtags = sanitizeInput(hashtags);
    const query = `(${keywords ? keywords : ""}) ${
      hashtags ? hashtags : ""
    }`.trim();

    try {
      const tweets = await this.fetchTweets(query);
      const processedTweets = await this.processTweets(tweets);
      return await this.saveTweets(processedTweets);
    } catch (error) {
      console.error("Error in fetchAndProcessTweets:", error);
      if (error.code === "ETIMEDOUT") {
        throw new Error("Request timed out");
      }
      throw new Error("Failed to fetch and process tweets");
    }
  }

  async fetchTweets(query) {
    try {
      const recentTweets = await this.twitterClient.v2.search(query, {
        tweet_fields: ["created_at", "entities"],
        expansions: ["author_id", "in_reply_to_user_id"],
        max_results: 100,
      });
      return recentTweets.data;
    } catch (error) {
      console.error("Error fetching tweets:", error);
      if (error.message.includes("Rate limit")) {
        throw new Error("Twitter API rate limit exceeded");
      }
      throw new Error("Failed to fetch tweets");
    }
  }

  async processTweets(tweets) {
    try {
      const markdownTweets = await Promise.all(
        tweets.map(async (tweet) => {
          const markdown = await this.generateMarkdown(tweet);
          return { ...tweet, markdown };
        })
      );
      return markdownTweets;
    } catch (error) {
      console.error("Error processing tweets:", error);
      throw new Error("Failed to process tweets");
    }
  }

  async generateMarkdown(tweet) {
    try {
      const response = await this.geminiClient.generateText({
        prompt: `Generate a well-formatted Markdown summary for the following tweet:\n${JSON.stringify(
          tweet,
          null,
          2
        )}`,
      });
      return response[0].text;
    } catch (error) {
      console.error("Error generating Markdown:", error);
      return "Failed to generate Markdown";
    }
  }

  async saveTweets(tweets) {
    try {
      const existingTweets = await this.tweetModel.find({
        id: { $in: tweets.map((t) => t.id) },
      });
      const newTweets = tweets.filter(
        (tweet) => !existingTweets.find((t) => t.id === tweet.id)
      );

      if (newTweets.length > 0) {
        await this.tweetModel.insertMany(newTweets);
      }
      return tweets;
    } catch (error) {
      console.error("Error saving tweets:", error);
      throw new Error("Failed to save tweets");
    }
  }
}

module.exports = new TweetsController();
