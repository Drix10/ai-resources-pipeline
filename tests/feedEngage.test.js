const test = require("node:test");
const assert = require("node:assert/strict");
const { scorePost, _tracker } = require("../src/services/feedEngage");
const { shouldSkipTracked, entryOfPost } = _tracker;

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

test("a post commented under its old key is still recognised after keys became text-based", () => {
  const track = { oldkey: { ts: ago(1), status: "commented" } };
  assert.equal(shouldSkipTracked(track, "newkey", "oldkey"), true);
  assert.equal(shouldSkipTracked(track, "newkey", "otherkey"), false);
});

test("an entry under the new key wins over a stale one under the old key", () => {
  const track = { newkey: { ts: ago(1), status: "liked" }, oldkey: { ts: ago(1), status: "commented" } };
  assert.equal(shouldSkipTracked(track, "newkey", "oldkey"), false, "the new entry is the source of truth");
});

test("commented posts are never repeated; rejected posts rest 3 days, skipped posts 30", () => {
  assert.equal(shouldSkipTracked({ k: { ts: ago(20), status: "commented" } }, "k"), true);
  assert.equal(shouldSkipTracked({ k: { ts: ago(1), status: "rejected" } }, "k"), true);
  assert.equal(shouldSkipTracked({ k: { ts: ago(1), status: "skipped" } }, "k"), true);
  assert.equal(shouldSkipTracked({ k: { ts: ago(4), status: "rejected" } }, "k"), false, "eligible again after the rest period");
  assert.equal(shouldSkipTracked({ k: { ts: ago(4), status: "skipped" } }, "k"), true, "an LLM SKIP is about the post: remembered 30 days");
  assert.equal(shouldSkipTracked({ k: { ts: ago(0.1), status: "liked" } }, "k"), false, "a like alone does not block a comment");
  assert.equal(shouldSkipTracked({}, "k"), false);
  assert.equal(shouldSkipTracked({ k: "2026-01-01T00:00:00Z" }, "k"), true, "legacy plain-string entries count as commented");
});

test("entryOfPost reads the new key first, then the old one, and tolerates both missing", () => {
  assert.equal(entryOfPost({ a: { ts: ago(0), status: "liked", likedAt: "x" } }, { key: "a", legacyKey: "b" }).likedAt, "x");
  assert.equal(entryOfPost({ b: { ts: ago(0), status: "liked", likedAt: "y" } }, { key: "a", legacyKey: "b" }).likedAt, "y");
  assert.equal(entryOfPost({}, { key: "a" }).likedAt, undefined);
});

test("audience scoring: finance + fresh + US outranks generic, and promo is penalised", () => {
  const finance = scorePost({ head: "VC partner, New York", text: "The Fed held rates while venture funding for AI startups rose; investors price equity differently now.", ageH: 2 });
  const generic = scorePost({ head: "someone", text: "Had a great weekend with the family and the dog at the lake.", ageH: 2 });
  const promo = scorePost({ head: "", text: "We're hiring! Join us for our fintech webinar, register now, link in bio.", ageH: 1 });
  assert.ok(finance >= 6, `finance ${finance}`);
  assert.ok(generic < 3, `generic ${generic}`);
  assert.ok(promo < finance && promo < 4, `promo ${promo}`);
});
