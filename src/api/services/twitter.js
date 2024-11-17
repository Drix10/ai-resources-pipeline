const { TwitterApi } = require("twitter-api-v2");
const config = require("../../config");
const { sanitizeInput } = require("../../utils/helpers");

class TwitterService {
  constructor() {
    this.client = new TwitterApi({
      appKey: config.twitter.apiKey,
      appSecret: config.twitter.apiSecret,
      accessToken: config.twitter.bearerToken,
    });
  }

  async fetchTweets(keywords, hashtags) {
    keywords = sanitizeInput(keywords);
    hashtags = sanitizeInput(hashtags);
    const query = `(${keywords || ""}) ${hashtags || ""}`.trim();

    if (!query) {
      throw new Error("Keywords or hashtags are required.");
    }

    const maxResults = 100;
    let tweets = [];
    let nextToken = null;

    while (true) {
      try {
        const response = await this.client.v2.search(query, {
          tweet_fields: ["created_at", "entities"],
          expansions: ["author_id", "in_reply_to_user_id"],
          max_results: maxResults,
          next_token: nextToken,
        });

        tweets = tweets.concat(response.data);
        nextToken = response.meta.next_token;

        if (!nextToken) {
          break;
        }

        //Implement exponential backoff for rate limits
        await new Promise((resolve) =>
          setTimeout(resolve, this.getBackoffDelay(response.meta))
        );
      } catch (error) {
        console.error("Error fetching tweets:", error);
        if (error.message.includes("Rate limit")) {
          const retryAfter = parseInt(error.rateLimit.retryAfter, 10) * 1000;
          await new Promise((resolve) => setTimeout(resolve, retryAfter));
          continue; //Retry on rate limit
        } else if (error.code === "ETIMEDOUT") {
          throw new Error("Request timed out");
        }
        throw new Error("Failed to fetch tweets");
      }
    }
    return tweets;
  }

  getBackoffDelay(meta) {
    if (!meta || !meta.rateLimit) {
      return 0; //No rate limit, no delay
    }
    const remaining = meta.rateLimit.remaining;
    const reset = meta.rateLimit.reset;
    const now = Date.now();
    if (remaining === 0) {
      const delay = Math.max(0, reset - now) + 1000; //Add a small buffer to avoid hitting the limit
      return delay;
    } else {
      return 0;
    }
  }
}

module.exports = new TwitterService();
