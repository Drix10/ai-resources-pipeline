const { Octokit } = require("@octokit/rest");
const { GithubService } = require("../../api/services/github");
const config = require("../../config");
const { logger } = require("../../utils/helpers");

jest.mock("../../config");
jest.mock("../../utils/helpers");

describe("GithubService", () => {
  let service;
  let mockOctokit;

  beforeEach(() => {
    mockOctokit = {
      rest: {
        repos: {
          getContent: jest.fn(),
          createOrUpdateFileContents: jest.fn(),
        },
      },
    };
    config.github.personalAccessToken = "test-token";
    config.github.repo = "test-owner/test-repo";
    config.github.folder = "test-folder";
    service = new GithubService(mockOctokit);
    jest.clearAllMocks();
  });

  it("should successfully upload a markdown file", async () => {
    const fileBuffer = Buffer.from("test markdown content");
    const mockFileContent = {
      data: { sha: "test-sha" },
    };
    mockOctokit.rest.repos.getContent.mockResolvedValue(mockFileContent);
    const result = await service.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    expect(result).toEqual({
      success: true,
      message: "File uploaded successfully",
    });
    expect(
      mockOctokit.rest.repos.createOrUpdateFileContents
    ).toHaveBeenCalledWith({
      owner: "test-owner",
      repo: "test-repo",
      path: "test-folder/tweets-1678886400000.md",
      message: "Automated update of tweets",
      content: expect.any(String),
      sha: "test-sha",
      branch: "main",
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("File uploaded successfully")
    );
  });

  it("should handle authentication error", async () => {
    const fileBuffer = Buffer.from("test markdown content");
    mockOctokit.rest.repos.createOrUpdateFileContents.mockRejectedValue({
      status: 401,
    });
    const result = await service.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    expect(result).toEqual({ success: false, message: "Unauthorized" });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error uploading file:")
    );
  });

  it("should handle rate limit exceeded error", async () => {
    const fileBuffer = Buffer.from("test markdown content");
    mockOctokit.rest.repos.createOrUpdateFileContents.mockRejectedValue({
      status: 429,
    });
    const result = await service.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    expect(result).toEqual({
      success: false,
      message: "GitHub API rate limit exceeded",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error uploading file:")
    );
  });

  it("should handle file not found error", async () => {
    const fileBuffer = Buffer.from("test markdown content");
    mockOctokit.rest.repos.getContent.mockRejectedValue({ status: 404 });
    const result = await service.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    expect(result).toEqual({
      success: true,
      message: "File uploaded successfully",
    });
    expect(
      mockOctokit.rest.repos.createOrUpdateFileContents
    ).toHaveBeenCalledWith(expect.objectContaining({ sha: null }));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("File uploaded successfully")
    );
  });

  it("should handle other errors", async () => {
    const fileBuffer = Buffer.from("test markdown content");
    mockOctokit.rest.repos.createOrUpdateFileContents.mockRejectedValue({
      status: 500,
    });
    const result = await service.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    expect(result).toEqual({
      success: false,
      message: "Internal Server Error",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error uploading file:")
    );
  });

  it("should handle invalid inputs", async () => {
    await expect(
      service.uploadMarkdownFile(null, config.github.repo, config.github.folder)
    ).rejects.toThrow();
    await expect(
      service.uploadMarkdownFile(
        Buffer.from("test"),
        null,
        config.github.folder
      )
    ).rejects.toThrow();
    await expect(
      service.uploadMarkdownFile(Buffer.from("test"), config.github.repo, null)
    ).rejects.toThrow();
  });

  it("should handle network errors", async () => {
    const fileBuffer = Buffer.from("test markdown content");
    mockOctokit.rest.repos.createOrUpdateFileContents.mockRejectedValue(
      new Error("Network error")
    );
    const result = await service.uploadMarkdownFile(
      fileBuffer,
      config.github.repo,
      config.github.folder
    );
    expect(result).toEqual({
      success: false,
      message: "Internal Server Error",
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Error uploading file:")
    );
  });
});
