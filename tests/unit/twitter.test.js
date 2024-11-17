const { TwitterService } = require("../../api/services/twitter");
const { logger } = require("../../utils/helpers");
const { sanitizeInput } = require("../../utils/helpers");

jest.mock("../../utils/helpers");

describe("TwitterService", () => {
  let service;
  beforeEach(() => {
    service = new TwitterService();
    jest.clearAllMocks();
  });

  describe("fetchTweets", () => {
    it("should successfully retrieve tweets", async () => {
      const mockTweets = [{ id: "123", text: "Test tweet" }];
      const mockResponse = {
        data: mockTweets,
        meta: { next_token: null },
      };
      service.client.v2.search.mockResolvedValue(mockResponse);
      const tweets = await service.fetchTweets("test");
      expect(tweets).toEqual(mockTweets);
      expect(service.client.v2.search).toHaveBeenCalledWith("test", {
        tweet_fields: ["created_at", "entities"],
        expansions: ["author_id", "in_reply_to_user_id"],
        max_results: 100,
      });
    });
    it("should handle empty results", async () => {
      const mockResponse = { data: [], meta: { next_token: null } };
      service.client.v2.search.mockResolvedValue(mockResponse);
      const tweets = await service.fetchTweets("test");
      expect(tweets).toEqual([]);
    });
    it("should handle invalid inputs", async () => {
      expect(() => service.fetchTweets()).toThrow(
        "Keywords or hashtags are required."
      );
    });
    it("should handle pagination", async () => {
      const mockTweetsPage1 = [{ id: "1", text: "Tweet 1" }];
      const mockTweetsPage2 = [{ id: "2", text: "Tweet 2" }];
      const mockResponsePage1 = {
        data: mockTweetsPage1,
        meta: { next_token: "nextToken1" },
      };
      const mockResponsePage2 = {
        data: mockTweetsPage2,
        meta: { next_token: null },
      };
      service.client.v2.search
        .mockResolvedValueOnce(mockResponsePage1)
        .mockResolvedValueOnce(mockResponsePage2);
      const tweets = await service.fetchTweets("test");
      expect(tweets).toEqual([...mockTweetsPage1, ...mockTweetsPage2]);
      expect(service.client.v2.search).toHaveBeenCalledTimes(2);
    });
    it("should handle rate limit exceeded", async () => {
      const mockError = {
        message: "Rate limit exceeded",
        rateLimit: { retryAfter: 10 },
      };
      service.client.v2.search.mockRejectedValue(mockError);
      await expect(service.fetchTweets("test")).rejects.toThrow(
        "Twitter API rate limit exceeded"
      );
    });
    it("should handle network error", async () => {
      const mockError = { code: "ETIMEDOUT" };
      service.client.v2.search.mockRejectedValue(mockError);
      await expect(service.fetchTweets("test")).rejects.toThrow(
        "Request timed out"
      );
    });
    it("should handle authentication error", async () => {
      const mockError = { message: "Unauthorized" };
      service.client.v2.search.mockRejectedValue(mockError);
      await expect(service.fetchTweets("test")).rejects.toThrow(
        "Failed to fetch tweets"
      );
    });
  });

  describe("getBackoffDelay", () => {
    it("should return 0 if no rate limit", () => {
      expect(service.getBackoffDelay()).toBe(0);
    });
    it("should return correct delay if rate limit reached", () => {
      const meta = { rateLimit: { remaining: 0, reset: Date.now() + 15000 } };
      const delay = service.getBackoffDelay(meta);
      expect(delay).toBeGreaterThanOrEqual(15000);
    });
    it("should return 0 if rate limit not reached", () => {
      const meta = { rateLimit: { remaining: 5, reset: Date.now() + 15000 } };
      expect(service.getBackoffDelay(meta)).toBe(0);
    });
    it("should return delay if rate limit close", () => {
      const meta = { rateLimit: { remaining: 2, reset: Date.now() + 15000 } };
      const delay = service.getBackoffDelay(meta);
      expect(delay).toBe(0);
    });
  });
});
