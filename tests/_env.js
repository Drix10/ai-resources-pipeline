// Preloaded by `npm test` (node --require). config/index.js refuses to load without GitHub
// settings, and tests must not depend on a developer's real .env, so supply inert placeholders
// only where nothing is set. Nothing here ever reaches the network.
process.env.GITHUB_PAT = process.env.GITHUB_PAT || "test-token-not-real";
process.env.GITHUB_USERNAME = process.env.GITHUB_USERNAME || "test-owner";
process.env.GITHUB_REPONAME = process.env.GITHUB_REPONAME || "test-repo";
// Keep a real OpenRouter key from being picked up, so a stray network call cannot spend money.
process.env.OPENROUTER_API_KEY = "";
