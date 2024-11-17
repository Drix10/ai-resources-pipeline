const supertest = require("supertest");
const app = require("../../src/api/app");
const config = require("../../src/config");
const GithubService = require("../../src/api/services/github");
const fs = require("node:fs/promises");
const path = require("node:path");

jest.mock("../../src/api/services/github");

describe("GitHub Integration Tests", () => {
  let server;
  let githubService;

  beforeEach(async () => {
    server = app.listen();
    githubService = new GithubService();
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await server.close();
  });

  it("should successfully upload a markdown file", async () => {
    const markdownContent =
      "# Test Markdown File\nThis is a test file for GitHub upload.";
    const filePath = path.join(__dirname, "test.md");
    await fs.writeFile(filePath, markdownContent);
    const fileStream = fs.createReadStream(filePath);
    const response = await supertest(server)
      .post("/github/upload")
      .attach("file", fileStream)
      .expect(200);
    expect(response.body).toEqual({
      success: true,
      message: "File uploaded successfully",
    });
    expect(GithubService.uploadMarkdownFile).toHaveBeenCalled();
    await fs.rm(filePath);
  });

  it("should handle unauthorized access", async () => {
    const markdownContent = "# Unauthorized Access Test";
    const filePath = path.join(__dirname, "unauthorized.md");
    await fs.writeFile(filePath, markdownContent);
    const fileStream = fs.createReadStream(filePath);

    const response = await supertest(server)
      .post("/github/upload")
      .attach("file", fileStream)
      .expect(401);
    expect(response.body.error).toBe("Unauthorized");
    await fs.rm(filePath);
  });

  it("should handle GitHub API rate limit exceeded", async () => {
    GithubService.uploadMarkdownFile.mockRejectedValue({
      status: 429,
      message: "GitHub API rate limit exceeded",
    });
    const markdownContent = "# Rate Limit Test";
    const filePath = path.join(__dirname, "ratelimit.md");
    await fs.writeFile(filePath, markdownContent);
    const fileStream = fs.createReadStream(filePath);
    const response = await supertest(server)
      .post("/github/upload")
      .attach("file", fileStream)
      .expect(429);
    expect(response.body.error).toBe("GitHub API rate limit exceeded");
    await fs.rm(filePath);
  });

  it("should handle file not found error", async () => {
    GithubService.uploadMarkdownFile.mockRejectedValue({
      code: "ENOENT",
      message: "File not found",
    });
    const response = await supertest(server).post("/github/upload").expect(400);
    expect(response.body.error).toBe("File not found");
  });

  it("should handle generic server error", async () => {
    GithubService.uploadMarkdownFile.mockRejectedValue({
      status: 500,
      message: "Internal Server Error",
    });
    const markdownContent = "# Server Error Test";
    const filePath = path.join(__dirname, "servererror.md");
    await fs.writeFile(filePath, markdownContent);
    const fileStream = fs.createReadStream(filePath);
    const response = await supertest(server)
      .post("/github/upload")
      .attach("file", fileStream)
      .expect(500);
    expect(response.body.error).toBe("Internal Server Error");
    await fs.rm(filePath);
  });

  it("should handle invalid file type", async () => {
    const response = await supertest(server)
      .post("/github/upload")
      .attach("file", Buffer.from("invalid file content"))
      .expect(500);
    expect(response.body.error).toBe("Internal Server Error");
  });

  it("should handle empty file", async () => {
    const filePath = path.join(__dirname, "empty.md");
    await fs.writeFile(filePath, "");
    const fileStream = fs.createReadStream(filePath);
    const response = await supertest(server)
      .post("/github/upload")
      .attach("file", fileStream)
      .expect(500);
    expect(response.body.error).toBe("Internal Server Error");
    await fs.rm(filePath);
  });
});
