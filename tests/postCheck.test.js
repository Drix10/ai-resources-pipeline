require("./_env"); // isolated even when run on its own
const test = require("node:test");
const assert = require("node:assert/strict");
const { checkPost, postHook } = require("../src/utils/postCheck");

test("post check: a link, a hashtag stack, bait and an announcement opener are fixes; a clean post has none", () => {
  const draft = "Excited to share agent-flow v1.1.0!\n\nIt keeps agent context honest.\n👉 https://github.com/Drix10/agent-flow\n\nWhat keeps you up at night? 👇\n\n#AI #CodingAgents #DevTools #ClaudeCode #CodeReview #OpenSource";
  const msgs = checkPost(draft).filter((f) => f.level === "fix").map((f) => f.msg).join("\n");
  assert.match(msgs, /A link in the post/);
  assert.match(msgs, /6 hashtags/);
  assert.match(msgs, /Engagement bait/);
  assert.match(msgs, /announcement opener/);
  const clean = "Our coding agents shipped a fix built on docs that changed two commits earlier.\n\nThe agent was confident, the tests passed, and the bug reached production anyway. Stale context is the failure nobody logs: the agent read the right file at the wrong time. So we built a small layer that checks what the agent read against what changed since, before it writes anything. Context drift now blocks the change instead of shipping it. How do you catch stale context in your own agent setup?";
  assert.deepEqual(checkPost(clean).filter((f) => f.level === "fix"), []);
  assert.equal(postHook(clean).length <= 210, true);
});
