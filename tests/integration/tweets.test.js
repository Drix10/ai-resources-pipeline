const request = require("supertest");
const app = require("../../src/api/app");
const config = require("../../src/config");
const { cleanDB } = require("../../src/utils/helpers");
const Tweet = require("../../src/api/models/tweet");

describe("Tweet Integration Tests", () => {
  let server;
  beforeEach(async () => {
    server = app.listen();
    await cleanDB();
  });

  afterEach(async () => {
    await server.close();
    await cleanDB();
  });

  it("should successfully process and store tweets", async () => {
    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "test" });
    expect(res.status).toBe(200);
    expect(res.body.tweets).toHaveLength(1);
    expect(res.body.tweets[0]).toHaveProperty("markdown");
    const tweets = await Tweet.find({});
    expect(tweets).toHaveLength(1);
  });

  it("should handle Twitter API rate limit", async () => {
    const mockTwitterService = {
      fetchTweets: jest
        .fn()
        .mockRejectedValue(new Error("Rate limit exceeded")),
    };
    jest.mock("../../src/api/services/twitter", () => ({
      __esModule: true,
      default: mockTwitterService,
    }));

    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "test" });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe("Twitter API rate limit exceeded");
    jest.unmock("../../src/api/services/twitter");
  });

  it("should handle invalid input", async () => {
    const res = await request(server).post("/tweets").send({});
    expect(res.status).toBe(400);
  });

  it("should handle Gemini API error", async () => {
    const mockGeminiService = {
      generateMarkdown: jest
        .fn()
        .mockRejectedValue(new Error("Gemini API error")),
    };
    jest.mock("../../src/api/services/gemini", () => ({
      __esModule: true,
      default: mockGeminiService,
    }));

    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "test" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal Server Error");
    jest.unmock("../../src/api/services/gemini");
  });

  it("should handle database error", async () => {
    jest
      .spyOn(Tweet, "insertMany")
      .mockRejectedValue(new Error("Database error"));

    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "test" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal Server Error");
    jest.restoreAllMocks();
  });

  it("should handle GitHub API error", async () => {
    const mockGithubService = {
      uploadMarkdownFile: jest
        .fn()
        .mockResolvedValue({ success: false, message: "GitHub API error" }),
    };
    jest.mock("../../src/api/services/github", () => ({
      __esModule: true,
      default: mockGithubService,
    }));

    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "test" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Internal Server Error");
    jest.unmock("../../src/api/services/github");
  });

  it("should handle empty keywords and hashtags", async () => {
    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "", hashtags: "" });
    expect(res.status).toBe(400); // Expect a bad request error code
    expect(res.body.error).toBeDefined();
  });

  it("should handle non-string keywords", async () => {
    const res = await request(server)
      .post("/tweets")
      .send({ keywords: 123, hashtags: "test" });
    expect(res.status).toBe(400); // Expect a bad request error code
    expect(res.body.error).toBeDefined();
  });

  it("should handle non-string hashtags", async () => {
    const res = await request(server)
      .post("/tweets")
      .send({ keywords: "test", hashtags: 123 });
    expect(res.status).toBe(400); // Expect a bad request error code
    expect(res.body.error).toBeDefined();
  });
});
