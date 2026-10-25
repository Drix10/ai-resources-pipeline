// What LinkedIn's 2026 ranking holds against a post, checked in code before it is published
// (scripts/post-check.js). Each finding: { level: "fix" | "note", msg }.

// What a reader sees before "...more": about 210 characters or 3 lines on desktop, less on a phone.
const HOOK_CHARS = 210;

function postHook(text) {
  const lines = String(text || "").trim().split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(0, 3).join("\n").slice(0, HOOK_CHARS);
}

function checkPost(text) {
  const t = String(text || "").trim();
  const out = [];
  if (/https?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|io|ai|dev|org|net|co|app|so)\b(?:\/\S*)?/i.test(t)) {
    out.push({ level: "fix", msg: "A link in the post: LinkedIn shows a post with an outside link to far fewer people. Put it in the first comment and say \"link in the first comment\"." });
  }
  const tags = t.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > 3) out.push({ level: "fix", msg: `${tags.length} hashtags: a stack reads as spam and no longer brings reach. Keep 0 to 3.` });
  if (/👇|comment below|drop (?:a|your) comment|let me know in the comments|\bagree\?|\bthoughts\?|like if|repost if|follow (?:me )?for more/i.test(t)) {
    out.push({ level: "fix", msg: "Engagement bait (\"👇\", \"Agree?\", \"comment below\"): LinkedIn demotes it. End on a real, specific question or none." });
  }
  const mentions = t.match(/@[\p{L}][\p{L}\p{N}_.-]*/gu) || [];
  if (mentions.length > 5) out.push({ level: "fix", msg: `${mentions.length} people tagged: tag only people who are in the post's story.` });
  const emoji = t.match(/\p{Extended_Pictographic}/gu) || [];
  if (emoji.length > 6) out.push({ level: "note", msg: `${emoji.length} emojis: they cut the time people spend reading.` });
  const first = (t.split(/\r?\n/).find((l) => l.trim()) || "").trim();
  if (/^(?:excited|thrilled|happy|proud|delighted|pleased|honou?red) to\b|^i(?:'m| am) (?:excited|thrilled|happy|proud)/i.test(first)) {
    out.push({ level: "fix", msg: `The first line ("${first.slice(0, 60)}") is an announcement opener: lead with the most surprising fact or result instead.` });
  }
  if (first.length > 140) out.push({ level: "note", msg: "The first line runs past what a phone shows before \"...more\": make it one short line." });
  if (t.length < 300) out.push({ level: "note", msg: "Under 300 characters: time spent reading is what widens a post; a little more substance helps." });
  return out;
}

module.exports = { checkPost, postHook, HOOK_CHARS };
