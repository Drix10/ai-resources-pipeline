require("./_env"); // isolated even when run on its own
// The LLM provider switch (config.llm.providers) and the claude CLI provider (src/services/claude.js).
// No real model is called: fetch, NVIDIA, Ollama and claude.ask are stubbed, and the CLI tests run a
// fake claude script.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const config = require("../config");
const llm = require("../src/services/llm");
const claude = require("../src/services/claude");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "providers-test-"));
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

// Loads config/index.js in a fresh node with these env vars: its llm block, or the error it throws.
function loadConfig(env) {
  const r = spawnSync(process.execPath, ["-e", `
    try { const c = require(${JSON.stringify(path.join(__dirname, "..", "config"))}); console.log(JSON.stringify({ provider: c.llm.provider, providers: c.llm.providers })); }
    catch (e) { console.log(JSON.stringify({ error: e.message })); }
  `], { env: { ...process.env, LLM_PROVIDER: "", LLM_ARTICLE_PROVIDER: "", LLM_COMMENT_PROVIDER: "", LLM_VIRAL_PROVIDER: "", ...env }, encoding: "utf8" });
  return JSON.parse(String(r.stdout).trim().split("\n").pop());
}

test("config: LLM_PROVIDER sets every job, the per-job settings override it, and a typo stops the start", () => {
  assert.deepEqual(loadConfig({}).providers, { article: "openrouter", comment: "openrouter", viral: "openrouter" });
  assert.deepEqual(loadConfig({ LLM_PROVIDER: "claude" }).providers, { article: "claude", comment: "claude", viral: "claude" });
  assert.deepEqual(loadConfig({ LLM_PROVIDER: "openrouter", LLM_VIRAL_PROVIDER: "Claude" }).providers, { article: "openrouter", comment: "openrouter", viral: "claude" });
  assert.deepEqual(loadConfig({ LLM_COMMENT_PROVIDER: "local" }).providers, { article: "openrouter", comment: "local", viral: "local" }, "the viral pass follows the comment provider");
  assert.match(loadConfig({ LLM_PROVIDER: "claud" }).error, /LLM_PROVIDER="claud" is not an LLM provider/);
  assert.match(loadConfig({ LLM_ARTICLE_PROVIDER: "gpt" }).error, /LLM_ARTICLE_PROVIDER/);
});

// Every route stubbed; `calls` records which one ran with what.
async function withRoutes(providers, fn, { openrouterKey = "", nvidiaKey = "" } = {}) {
  const saved = {
    providers: { ...config.llm.providers }, orKey: config.llm.openrouter.apiKey, nvKey: config.llm.nvidia.apiKey,
    ask: claude.ask, or: llm.generateTextViaOpenRouter, nv: llm.generateTextViaNvidia, ol: llm.generateTextViaOllama, rest: llm._claudeRestUntil,
  };
  const calls = [];
  Object.assign(config.llm.providers, providers);
  config.llm.openrouter.apiKey = openrouterKey;
  config.llm.nvidia.apiKey = nvidiaKey;
  llm._claudeRestUntil = 0;
  claude.ask = async (o) => { calls.push({ via: "claude", ...o }); return "claude text"; };
  llm.generateTextViaOpenRouter = async (p, o) => { calls.push({ via: "openrouter", ...o }); return "openrouter text"; };
  llm.generateTextViaNvidia = async (p, o) => { calls.push({ via: "nvidia", ...o }); return "nvidia text"; };
  llm.generateTextViaOllama = async (p, o) => { calls.push({ via: "local", ...o }); return "local text"; };
  try {
    await fn(calls);
  } finally {
    Object.assign(config.llm.providers, saved.providers);
    config.llm.openrouter.apiKey = saved.orKey; config.llm.nvidia.apiKey = saved.nvKey;
    claude.ask = saved.ask; llm.generateTextViaOpenRouter = saved.or; llm.generateTextViaNvidia = saved.nv; llm.generateTextViaOllama = saved.ol;
    llm._claudeRestUntil = saved.rest;
  }
}

test("comments: each provider runs its own route; claude takes the comment model, the viral pass the strong one and the image", () => withRoutes(
  { comment: "claude", viral: "claude" }, async (calls) => {
    assert.equal(await llm.generateCommentText("p", { system: "s" }), "claude text");
    assert.equal(calls[0].model, config.llm.claude.model);
    assert.equal(calls[0].effort, config.llm.claude.effort);
    assert.equal(calls[0].system, "s");
    await llm.generateCommentText("p", { noReasoning: true });
    assert.equal(calls[1].effort, "low", "a critic verdict needs no long thinking");
    await llm.generateCommentText("p", { role: "viral", imageFiles: ["shot.png"] });
    assert.equal(calls[2].model, config.llm.claude.viralModel);
    assert.equal(calls[2].effort, config.llm.claude.viralEffort);
    assert.deepEqual(calls[2].imageFiles, ["shot.png"]);
    Object.assign(config.llm.providers, { comment: "local", viral: "nvidia" });
    assert.equal(await llm.generateCommentText("p", {}), "local text");
    assert.equal(await llm.generateCommentText("p", { role: "viral", imageFiles: ["x.png"] }), "nvidia text");
    assert.equal("imageFiles" in calls[4], false, "no image reaches a provider that cannot read it");
  }));

test("comments: a failed claude call falls back to OpenRouter when it has a key, and throws when nothing can take over", async () => {
  await withRoutes({ comment: "claude" }, async (calls) => {
    claude.ask = async () => { throw Object.assign(new Error("boom"), { code: "CLAUDE_FAILED" }); };
    assert.equal(await llm.generateCommentText("p", {}), "openrouter text");
    assert.equal(calls.at(-1).via, "openrouter");
  }, { openrouterKey: "k" });
  await withRoutes({ comment: "claude" }, async () => {
    claude.ask = async () => { throw Object.assign(new Error("boom"), { code: "CLAUDE_FAILED" }); };
    await assert.rejects(llm.generateCommentText("p", {}), /boom/);
  });
});

test("articles: claude writes; a usage limit or a signed-out CLI hands over to OpenRouter, else the writer is down; a time-out is the article's", async () => {
  await withRoutes({ article: "claude" }, async (calls) => {
    assert.equal(await llm.generateArticleText("p"), "claude text");
    assert.equal(calls[0].via, "claude");
  });
  await withRoutes({ article: "claude" }, async () => {
    claude.ask = async () => { throw Object.assign(new Error("You've hit your limit"), { code: "CLAUDE_LIMIT" }); };
    const e = await llm.generateArticleText("p").catch((x) => x);
    assert.equal(e.providerDown, true, "no API key: the run stops writing");
  });
  await withRoutes({ article: "claude" }, async (calls) => {
    claude.ask = async () => { throw Object.assign(new Error("not logged in"), { code: "CLAUDE_UNAVAILABLE" }); };
    assert.equal(await llm.generateArticleText("p"), "openrouter text");
    assert.equal(calls.at(-1).via, "openrouter");
  }, { openrouterKey: "k" });
  await withRoutes({ article: "claude" }, async () => {
    claude.ask = async () => { throw Object.assign(new Error("claude -p timed out"), { code: "CLAUDE_TIMEOUT" }); };
    const e = await llm.generateArticleText("p").catch((x) => x);
    assert.equal(e.code, "CLAUDE_TIMEOUT");
    assert.equal(e.providerDown, undefined, "one slow article is not a dead writer");
  }, { openrouterKey: "k" });
  await withRoutes({ article: "local" }, async (calls) => {
    assert.equal(await llm.generateArticleText("p"), "local text");
    Object.assign(config.llm.providers, { article: "nvidia" });
    assert.equal(await llm.generateArticleText("p"), "nvidia text");
    assert.deepEqual(calls.map((c) => c.via), ["local", "nvidia"]);
  }, { openrouterKey: "k" });
});

test("after a usage limit Claude rests: the next calls go straight to the fallback without starting the CLI", () => withRoutes({ comment: "claude" }, async (calls) => {
  let asked = 0;
  claude.ask = async () => { asked++; throw Object.assign(new Error("usage limit reached"), { code: "CLAUDE_LIMIT" }); };
  assert.equal(await llm.generateCommentText("p", {}), "openrouter text");
  assert.equal(await llm.generateCommentText("p", {}), "openrouter text");
  assert.equal(asked, 1, "the second call never started claude");
  llm._claudeRestUntil = 0;
  await llm.generateCommentText("p", {});
  assert.equal(asked, 2, "after the rest it is tried again");
}, { openrouterKey: "k" }));

test("viral drafter: a banned word fails a candidate (never laundered by the sanitizer)", async () => {
  const saved = llm.generateCommentText;
  const replies = [
    JSON.stringify({ candidates: [{ angle: "detail", comment: "Releasing the weights will supercharge every small team." }] }),
  ];
  llm.generateCommentText = async () => replies.shift();
  try {
    const r = await llm.draftViralComment({ post: { author: "Ada", text: "We are releasing our open model weights today for every developer to build on.", ageH: 1 } });
    assert.equal(r.isValid, false);
    assert.match(r.errors.join(" "), /Banned word/);
  } finally {
    llm.generateCommentText = saved;
  }
});

// ---- the claude CLI wrapper ----
test("claude CLI arguments: text calls get no tool at all; image calls may Read only the images' folder", () => {
  const text = claude.claudeArgs({ model: "m", effort: "low", system: "s" });
  assert.deepEqual(text.slice(0, 10), ["-p", "--no-session-persistence", "--model", "m", "--effort", "low", "--output-format", "json", "--safe-mode", "--strict-mcp-config"], "none of the user's own CLAUDE.md, hooks or plugins");
  assert.equal(text[text.indexOf("--tools") + 1], "", "no tool");
  assert.ok(text.includes("Bash") && text.includes("WebFetch") && text.includes("Read"), "denied as a second lock");
  assert.equal(text[text.indexOf("--append-system-prompt") + 1], "s");
  const img = path.join(TMP, "shots", "card.png");
  const withImg = claude.claudeArgs({ model: "m", effort: "high", imageFiles: [img] });
  assert.equal(withImg[withImg.indexOf("--tools") + 1], "Read");
  assert.equal(withImg[withImg.indexOf("--allowedTools") + 1], `Read(${claude.rulePath(path.dirname(img))}/**)`);
  assert.equal(withImg[withImg.indexOf("--add-dir") + 1], path.dirname(img));
  assert.ok(!withImg.slice(withImg.indexOf("--disallowedTools") + 1).includes("Read"));
  if (process.platform === "win32") assert.equal(claude.rulePath("C:\\a\\b"), "//c/a/b");
  else assert.equal(claude.rulePath("/home/a/"), "//home/a");
});

test("claude CLI: an npm .cmd shim resolves to the claude.exe it launches; programName ignores folders and extensions", () => {
  const dir = path.join(TMP, "bin");
  fs.mkdirSync(path.join(dir, "node_modules", "pkg", "bin"), { recursive: true });
  const exe = path.join(dir, "node_modules", "pkg", "bin", "claude.exe");
  fs.writeFileSync(exe, "");
  fs.writeFileSync(path.join(dir, "claude.cmd"), '@ECHO off\r\n"%dp0%\\node_modules\\pkg\\bin\\claude.exe"   %*\r\n');
  assert.equal(claude.resolveBin("claude", { platform: "win32", pathEnv: dir }), exe);
  assert.equal(claude.resolveBin("claude", { platform: "linux", pathEnv: dir }), "claude");
  // A JS-target shim: the cli.js it launches (run on this node), never the node.exe beside it.
  const js = path.join(TMP, "jsbin");
  fs.mkdirSync(path.join(js, "node_modules", "pkg"), { recursive: true });
  fs.writeFileSync(path.join(js, "node.exe"), "");
  fs.writeFileSync(path.join(js, "node_modules", "pkg", "cli.js"), "");
  fs.writeFileSync(path.join(js, "claude.cmd"), '@IF EXIST "%dp0%\\node.exe" (\r\n  "%dp0%\\node.exe"  "%dp0%\\node_modules\\pkg\\cli.js" %*\r\n) ELSE (\r\n  node  "%dp0%\\node_modules\\pkg\\cli.js" %*\r\n)\r\n');
  assert.equal(claude.resolveBin("claude", { platform: "win32", pathEnv: js }), path.join(js, "node_modules", "pkg", "cli.js"));
  assert.equal(claude.programName("C:/npm/claude.cmd"), "claude");
  assert.equal(claude.programName("/tmp/fake-claude.js"), "fake-claude");
});

// A fake claude CLI: it answers by what the prompt asks for (the child gets no custom env vars).
const FAKE = path.join(TMP, "fake-claude.js");
fs.writeFileSync(FAKE, `
let input = "";
process.stdin.on("data", (d) => (input += d)).on("end", () => {
  const say = (o, code = 0) => { process.stdout.write(JSON.stringify(o)); process.exitCode = code; };
  if (input.includes("MODE=limit")) return say({ type: "result", is_error: true, result: "You've hit your session limit · resets 9:10pm" }, 1);
  if (input.includes("MODE=auth")) return say({ type: "result", is_error: true, result: "Invalid API key · Please run /login" }, 1);
  if (input.includes("MODE=garbage")) { process.stdout.write("not json"); process.exitCode = 2; return; }
  if (input.includes("MODE=empty")) return say({ type: "result", is_error: false, result: "" });
  if (input.includes("MODE=hang")) return setTimeout(() => {}, 60000);
  if (input.includes("MODE=oldcli") && process.argv.includes("--safe-mode")) { process.stderr.write("error: unknown option '--safe-mode'"); process.exitCode = 1; return; }
  if (input.includes("MODE=echo")) return say({ type: "result", is_error: false, result: JSON.stringify({ input, argv: process.argv.slice(2), cwd: process.cwd(), files: require("fs").readdirSync(process.cwd()) }) });
  say({ type: "result", is_error: false, result: "ARGS " + JSON.stringify(process.argv.slice(2)) + " ENV " + Object.keys(process.env).filter((k) => /API_?KEY|_KEY$|TOKEN|SECRET|^GITHUB_PAT$/i.test(k)).join(",") });
});
`);

test("claude CLI: the reply comes back, the prompt goes on stdin, and no key from the parent reaches the child", async () => {
  process.env.SOME_API_KEY_FOR_TEST = "secret";
  try {
    const out = await claude.ask({ prompt: "hello", model: "m", effort: "low", bin: FAKE, timeoutMs: 20000 });
    assert.match(out, /^ARGS \[/);
    assert.match(out, /"--model","m"/);
    assert.match(out, /ENV $/, "no key, token or secret in the child's environment");
  } finally {
    delete process.env.SOME_API_KEY_FOR_TEST;
  }
});

test("claude CLI: a usage limit, a missing sign-in, a broken or empty reply and a hang each fail with their own code", async () => {
  const run = (mode, timeoutMs = 20000) => claude.ask({ prompt: `MODE=${mode}`, model: "m", effort: "low", bin: FAKE, timeoutMs }).catch((e) => e);
  assert.equal((await run("limit")).code, "CLAUDE_LIMIT");
  assert.equal((await run("auth")).code, "CLAUDE_UNAVAILABLE");
  assert.equal((await run("garbage")).code, "CLAUDE_FAILED");
  assert.equal((await run("empty")).code, "CLAUDE_FAILED", "an empty reply is not an answer");
  const started = Date.now();
  assert.equal((await run("hang", 1500)).code, "CLAUDE_TIMEOUT");
  assert.ok(Date.now() - started < 15000, "the hung call is killed at its time-out");
  assert.equal((await claude.ask({ prompt: "x", model: "m", effort: "low", bin: path.join(TMP, "nope", "claude-missing.exe"), timeoutMs: 5000 }).catch((e) => e)).code, "CLAUDE_UNAVAILABLE");
});

test("claude CLI: a test can never start the real claude", async () => {
  const e = await claude.ask({ prompt: "x", model: "m", effort: "low", bin: "claude" }).catch((x) => x);
  assert.equal(e.code, "CLAUDE_UNAVAILABLE");
  assert.match(e.message, /a test reached the real Claude Code/);
});

test("claude CLI: an image is copied into the call's own folder, the only one it may Read, and removed with it", async () => {
  const src = path.join(TMP, "shots-elsewhere", "card.png");
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, "png");
  const r = JSON.parse(await claude.ask({ prompt: "MODE=echo", imageFiles: [src], model: "m", effort: "low", bin: FAKE, timeoutMs: 20000 }));
  assert.deepEqual(r.files, ["image-1.png"], "the copy, in the call's own folder");
  assert.match(path.basename(r.cwd), /^pipeline-claude-/);
  const allowed = r.argv[r.argv.indexOf("--allowedTools") + 1];
  assert.equal(allowed, `Read(${claude.rulePath(r.cwd)}/**)`, "Read reaches that folder only, not the temp folder the image came from");
  assert.ok(!r.input.includes(src) && r.input.includes(path.join(r.cwd, "image-1.png")), "the prompt names the copy");
  assert.equal(fs.existsSync(r.cwd), false, "the folder is gone after the call");
  assert.ok(fs.existsSync(src), "the caller's file is left alone");
});

test("claude CLI: a CLI without --safe-mode is asked again with only project settings, and every later call too", async () => {
  try {
    const first = JSON.parse(await claude.ask({ prompt: "MODE=oldcli MODE=echo", model: "m", effort: "low", bin: FAKE, timeoutMs: 20000 }));
    assert.ok(!first.argv.includes("--safe-mode"));
    assert.equal(first.argv[first.argv.indexOf("--setting-sources") + 1], "project");
    assert.ok(claude.claudeArgs({ model: "m", effort: "low" }).includes("--setting-sources"), "remembered");
  } finally {
    claude._reset();
  }
  assert.ok(claude.claudeArgs({ model: "m", effort: "low" }).includes("--safe-mode"));
  try {
    // Calls started together: each one refused --safe-mode is asked again, not only the first to fail.
    const all = await Promise.all([1, 2, 3].map(() => claude.ask({ prompt: "MODE=oldcli MODE=echo", model: "m", effort: "low", bin: FAKE, timeoutMs: 20000 }).catch((e) => e)));
    assert.deepEqual(all.map((r) => typeof r === "string" && JSON.parse(r).argv.includes("--setting-sources")), [true, true, true]);
  } finally {
    claude._reset();
  }
});

test("claude CLI: a stop kills the running calls and refuses new ones (CLAUDE_STOPPED), which no fallback answers", async () => {
  try {
    const hung = claude.ask({ prompt: "MODE=hang", model: "m", effort: "low", bin: FAKE, timeoutMs: 20000 }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 1500));
    claude.killAll();
    assert.equal((await hung).code, "CLAUDE_STOPPED");
    assert.equal((await claude.ask({ prompt: "x", model: "m", effort: "low", bin: FAKE }).catch((e) => e)).code, "CLAUDE_STOPPED");
  } finally {
    claude._reset();
  }
  await withRoutes({ comment: "claude", article: "claude" }, async (calls) => {
    claude.ask = async () => { throw Object.assign(new Error("the pipeline is stopping"), { code: "CLAUDE_STOPPED" }); };
    assert.equal((await llm.generateCommentText("p", {}).catch((e) => e)).code, "CLAUDE_STOPPED");
    assert.equal((await llm.generateArticleText("p").catch((e) => e)).code, "CLAUDE_STOPPED");
    assert.ok(!calls.some((c) => c.via !== "claude"), "no paid fallback after a stop");
    const run = llm.beginRun();
    const e = await llm.generateArticle([{ text: "Acme released Fooql 2.0 with 3x faster joins on TPC-H, from 360 ms to 120 ms per query, under the MIT license.", url: "https://x.com/acme/status/1", links: [], images: [] }], { run }).catch((x) => x);
    assert.equal(e.code, "CLAUDE_STOPPED", "the writer stops instead of counting a transport failure");
    assert.equal(run.transportFailures, 0);
    let asked = 0;
    claude.ask = async () => { asked++; throw Object.assign(new Error("the pipeline is stopping"), { code: "CLAUDE_STOPPED" }); };
    const post = "Acme released Fooql 2.0 today with 3x faster joins on TPC-H, from 360 ms to 120 ms per query, under the MIT license, after two years of work.";
    assert.equal((await llm.draftFeedComment({ postAuthor: "Acme", postText: post }).catch((x) => x)).code, "CLAUDE_STOPPED");
    assert.equal(asked, 1, "a stopped comment draft is not retried");
    // A stop that reaches the critic ends the draft too, after one draft and one critic call.
    const seen = [];
    claude.ask = async ({ prompt }) => {
      const critic = /strict judge of LinkedIn replies/.test(prompt);
      seen.push(critic ? "critic" : "draft");
      if (critic) throw Object.assign(new Error("the pipeline is stopping"), { code: "CLAUDE_STOPPED" });
      return "MODE: REACT\nREPLY: Two years for a third of the query time sounds about right for join work.";
    };
    assert.equal((await llm.draftFeedComment({ postAuthor: "Acme", postText: post }).catch((x) => x)).code, "CLAUDE_STOPPED");
    assert.deepEqual(seen, ["draft", "critic"]);
  }, { openrouterKey: "k" });
  await withRoutes({ viral: "claude" }, async () => {
    claude.ask = async () => { throw Object.assign(new Error("the pipeline is stopping"), { code: "CLAUDE_STOPPED" }); };
    const post = { text: "Acme released Fooql 2.0 today with 3x faster joins on TPC-H, under the MIT license.", author: "Acme", ageH: 2, reactions: 5000, comments: 100 };
    assert.equal((await llm.draftViralComment({ post, comments: "" }).catch((x) => x)).code, "CLAUDE_STOPPED", "the viral draft keeps the stop's code");
  }, { openrouterKey: "k" });
});

test("comments: a LinkedIn pass's deadline cuts a Claude call to what is left, and no call starts without 20 s of it", () => withRoutes({ comment: "claude" }, async () => {
  const asked = [];
  claude.ask = async (o) => { asked.push(o.timeoutMs); return "ok"; };
  try {
    llm.commentDeadline = Date.now() + 60000;
    const before = llm.commentCalls || 0;
    assert.equal(await llm.generateCommentText("p", {}), "ok");
    assert.ok(asked[0] <= 60000 && asked[0] > 50000, String(asked[0]));
    assert.equal(llm.commentCalls, before + 1, "each call is counted");
    llm.commentDeadline = Date.now() + 10000;
    assert.equal((await llm.generateCommentText("p", {}).catch((e) => e)).code, "PASS_TIME_UP");
    assert.equal(asked.length, 1, "nothing was asked");
    llm.commentDeadline = 0;
    assert.equal(await llm.generateCommentText("p", {}), "ok");
    assert.equal(asked[1], config.llm.claude.requestTimeoutMs, "no pass: the configured time-out");
  } finally {
    llm.commentDeadline = 0;
  }
}, { openrouterKey: "k" }));

test("comments: an image call never falls back to a model that cannot see the image", () => withRoutes({ viral: "claude" }, async (calls) => {
  claude.ask = async () => { throw Object.assign(new Error("boom"), { code: "CLAUDE_FAILED" }); };
  assert.match((await llm.generateCommentText("p", { role: "viral", imageFiles: ["shot.png"] }).catch((e) => e)).message, /boom/);
  assert.equal(calls.length, 0);
  assert.equal(await llm.generateCommentText("p", { role: "viral" }), "openrouter text", "a text call still falls back");
}, { openrouterKey: "k" }));
