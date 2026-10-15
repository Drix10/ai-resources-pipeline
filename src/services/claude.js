/**
 * claude.js
 *
 * One headless Claude Code call (`claude -p` on the account's Claude subscription): the prompt on
 * stdin, the reply text back. The LLM provider "claude" (config.llm.providers) runs on it.
 * A call is text only, or may Read copies of the given images and nothing else: no other tool, no MCP
 * server, no session kept, and none of the user's own Claude Code setup (CLAUDE.md, hooks, plugins,
 * skills: --safe-mode). The child gets an allow-listed environment: no posting, API or repo key
 * reaches it, and an Anthropic API key would bill the API instead of the plan.
 *
 * Errors carry a code a caller can act on:
 *  CLAUDE_UNAVAILABLE  the CLI is missing or not signed in (`claude` once, then /login)
 *  CLAUDE_LIMIT        the plan's usage limit is reached
 *  CLAUDE_TIMEOUT      the call ran past its time-out (the process tree is killed)
 *  CLAUDE_STOPPED      the pipeline is shutting down (killAll): no call starts, none is retried
 *  CLAUDE_FAILED       any other failed run
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DENY = ["Read", "Glob", "Grep", "Task", "Agent", "Skill", "WebFetch", "WebSearch", "Bash", "Edit", "Write", "NotebookEdit"];
const ENV_ALLOW = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "SYSTEMDRIVE", "COMSPEC", "OS", "TEMP", "TMP", "TMPDIR",
  "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "ALLUSERSPROFILE", "PUBLIC",
  "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432",
  "NUMBER_OF_PROCESSORS", "USERNAME", "USERDOMAIN", "COMPUTERNAME", "USER", "LOGNAME", "LANG", "LANGUAGE", "TERM", "TZ", "SHELL",
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR",
  // (CLAUDE_CODE_OAUTH_TOKEN: the subscription sign-in of `claude setup-token`, for headless machines)
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH", "CLAUDE_CODE_OAUTH_TOKEN",
]);
const childEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => ENV_ALLOW.has(k.toUpperCase())));

// How Claude Code words a plan limit, and a missing or expired sign-in.
const LIMIT_RE = /usage limit|limit reached|hit your limit|session limit|weekly limit|resets? (?:at )?\d|quota|429 too many|status:? 429|rate.?limit/i;
const AUTH_RE = /not logged in|please run \/login|\/login\b|invalid api key|authentication_error|oauth token|unauthori[sz]ed|status:? 401/i;
const withCode = (message, code) => Object.assign(new Error(message), { code });

/** A program's own name, without its folder, quotes or Windows extension ("C:/npm/claude.cmd" -> "claude"). */
const programName = (bin) => String(bin).trim().replace(/^"(.*)"$/, "$1").split(/[\\/]/).pop().replace(/\.(exe|cmd|bat|ps1|js|mjs|cjs)$/i, "").toLowerCase();

/**
 * On Windows an npm install puts `claude.cmd` on PATH, and spawn() cannot run a .cmd without a shell
 * (which would mangle a long prompt's arguments): resolve to what the shim launches, a claude.exe or
 * the package's cli.js (run on this node by ask()), never the node.exe a JS shim starts it with.
 */
function resolveBin(bin = "claude", { platform = process.platform, pathEnv = process.env.PATH } = {}) {
  bin = String(bin || "claude").trim().replace(/^"(.*)"$/, "$1");
  if (platform !== "win32") return bin;
  const fromShim = (cmd) => {
    if (!fs.existsSync(cmd)) return null;
    const targets = [...fs.readFileSync(cmd, "utf8").matchAll(/"%dp0%\\?([^"]+\.(?:exe|js|cjs|mjs))"/gi)]
      .map((m) => m[1]).filter((t) => !/(?:^|[\\/])node\.exe$/i.test(t))
      .map((t) => path.join(path.dirname(cmd), t)).filter((t) => fs.existsSync(t));
    return targets.length ? targets[targets.length - 1] : null;
  };
  const ext = path.extname(bin).toLowerCase();
  if ([".exe", ".js", ".mjs", ".cjs"].includes(ext)) return bin;
  if (ext === ".cmd") return fromShim(bin) || bin;
  if (path.isAbsolute(bin)) return (fs.existsSync(`${bin}.exe`) && `${bin}.exe`) || fromShim(`${bin}.cmd`) || bin;
  for (const raw of String(pathEnv || "").split(path.delimiter)) {
    const dir = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, `${bin}.exe`))) return path.join(dir, `${bin}.exe`);
    const viaShim = fromShim(path.join(dir, `${bin}.cmd`));
    if (viaShim) return viaShim;
  }
  return bin;
}

/** An absolute path as a Claude Code permission-rule path: C:\a\b -> //c/a/b, /home/a -> //home/a. */
function rulePath(abs) {
  const p = path.resolve(abs).split(path.sep).join("/").replace(/([*?[\]])/g, "\\$1");
  const m = /^([A-Za-z]):\/?(.*)$/.exec(p);
  return m ? `//${m[1].toLowerCase()}/${m[2]}`.replace(/\/$/, "") : `/${p}`.replace(/\/$/, "");
}

// The user's own Claude Code setup stays out of every call: --safe-mode, or on a CLI too old for it,
// only the (empty) working folder's project settings.
const ISOLATE = ["--safe-mode"];
const ISOLATE_OLD_CLI = ["--setting-sources", "project"];
let isolate = ISOLATE;
const NO_SAFE_MODE_RE = /unknown option[^\n]*--safe-mode|--safe-mode[^\n]*(?:unknown|not recogni[sz]ed|unrecogni[sz]ed)/i;

/** The arguments of one call: text only, or Read limited to the images' own folders. */
function claudeArgs({ model, effort, system = "", imageFiles = [], isolation = isolate }) {
  const dirs = [...new Set(imageFiles.map((f) => path.dirname(path.resolve(f))))];
  const out = ["-p", "--no-session-persistence", "--model", model, "--effort", effort, "--output-format", "json", ...isolation, "--strict-mcp-config"];
  if (system) out.push("--append-system-prompt", system);
  if (dirs.length) out.push("--tools", "Read", "--allowedTools", ...dirs.map((d) => `Read(${rulePath(d)}/**)`), "--disallowedTools", ...DENY.filter((t) => t !== "Read"), "--add-dir", ...dirs);
  else out.push("--tools", "", "--disallowedTools", ...DENY);
  return out;
}

// Every claude run still going: a stopped pipeline kills them (a hidden child outlives its parent on Windows).
const live = new Set();
const killTree = (child) => {
  if (!child || !child.pid) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 15000, windowsHide: true });
  else try { process.kill(-child.pid, "SIGKILL"); } catch (e) { try { child.kill("SIGKILL"); } catch (e2) { /* gone */ } }
};
/** Kills every running call and refuses new ones (the pipeline's shutdown). */
let stopped = false;
function killAll() {
  stopped = true;
  for (const child of live) killTree(child);
  live.clear();
}

/**
 * One call. Resolves with the reply text; rejects with a coded error (see the top of this file).
 * @param {{prompt: string, system?: string, imageFiles?: string[], model: string, effort: string, timeoutMs?: number, bin?: string}} p
 */
function ask({ prompt, system = "", imageFiles = [], model, effort, timeoutMs = 5 * 60 * 1000, bin = "claude" }) {
  // A test never starts the real Claude Code: a step it forgot to stub fails here (a test points
  // `bin` at a fake CLI script instead).
  if (process.env.NODE_TEST_CONTEXT && programName(bin) === "claude") {
    return Promise.reject(withCode("a test reached the real Claude Code: stub it, or point CLAUDE_BIN at a fake", "CLAUDE_UNAVAILABLE"));
  }
  if (stopped) return Promise.reject(withCode("the pipeline is stopping", "CLAUDE_STOPPED"));
  // The call's own empty folder is its working folder, and the only folder it may Read: each image
  // is copied in, so a prompt carrying untrusted page text cannot reach any other file.
  let cwd;
  const files = [];
  try {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-claude-"));
    imageFiles.forEach((f, i) => {
      const copy = path.join(cwd, `image-${i + 1}${path.extname(f).toLowerCase() || ".png"}`);
      fs.copyFileSync(path.resolve(f), copy);
      files.push(copy);
    });
  } catch (e) {
    if (cwd) try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e2) { /* left behind costs nothing */ }
    return Promise.reject(withCode(`${cwd ? "could not copy an image for claude" : "no temp folder for claude"}: ${e.message}`, "CLAUDE_FAILED"));
  }
  const look = files.length ? `\n\nFirst use the Read tool to look at each of these image files, in order:\n${files.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n` : "";
  const exe = resolveBin(bin);
  const run = () => new Promise((resolve, reject) => {
    // (the isolation this run used: a concurrent call may switch it while this one runs)
    const used = isolate;
    const args = claudeArgs({ model, effort, system, imageFiles: files, isolation: used });
    // A .js CLI (a test's fake, or a wrapper) runs on this node.
    const [cmd, argv] = /\.(?:m|c)?js$/i.test(exe) ? [process.execPath, [exe, ...args]] : [exe, args];
    let settled = false, out = "", err = "", child = null, timer = null;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) live.delete(child);
      fn(v);
    };
    try {
      child = spawn(cmd, argv, { cwd, env: childEnv(), stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" });
    } catch (e) {
      return finish(reject, withCode(`claude CLI could not start ("${exe}"): ${e.message}. Install it and sign in: npm i -g @anthropic-ai/claude-code && claude`, "CLAUDE_UNAVAILABLE"));
    }
    live.add(child);
    timer = setTimeout(() => { killTree(child); finish(reject, withCode(`claude -p timed out after ${Math.round(timeoutMs / 1000)}s`, "CLAUDE_TIMEOUT")); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => { if (out.length < 4e6) out += d; });
    child.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    child.stdin.on("error", () => {});
    child.on("error", (e) => finish(reject, withCode(`claude CLI could not start ("${exe}"): ${e.message}. Install it and sign in: npm i -g @anthropic-ai/claude-code && claude`, "CLAUDE_UNAVAILABLE")));
    child.on("close", (code) => {
      if (stopped) return finish(reject, withCode("the pipeline is stopping", "CLAUDE_STOPPED"));
      let parsed = null;
      try { parsed = JSON.parse(out); } catch (e) { /* not the JSON envelope */ }
      if (parsed && !parsed.is_error && code === 0 && String(parsed.result || "").trim()) return finish(resolve, String(parsed.result));
      const said = `${(parsed && parsed.result) || ""}\n${err}\n${parsed ? "" : out}`.trim();
      const code_ = LIMIT_RE.test(said) || Number(parsed && parsed.api_error_status) === 429 ? "CLAUDE_LIMIT"
        : AUTH_RE.test(said) || Number(parsed && parsed.api_error_status) === 401 ? "CLAUDE_UNAVAILABLE"
          // (a rejected option never gets as far as the JSON envelope)
          : used === ISOLATE && !parsed && NO_SAFE_MODE_RE.test(said) ? "CLAUDE_NO_SAFE_MODE" : "CLAUDE_FAILED";
      finish(reject, withCode(`claude -p failed (exit ${code}): ${said.slice(0, 300) || "an empty reply"}`, code_));
    });
    child.stdin.end(`${prompt}${look}`);
  });
  return run()
    .catch((e) => {
      if (e.code !== "CLAUDE_NO_SAFE_MODE") throw e;
      isolate = ISOLATE_OLD_CLI; // this CLI predates --safe-mode: every later call too
      return run();
    })
    .finally(() => {
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* a temp folder left behind costs nothing */ }
    });
}

/** The first JSON object in a reply (tolerates ```json fences and prose around it). */
function parseJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("the reply had no JSON object");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error("the reply had an unterminated JSON object");
}

// Tests only: a fresh module state (calls allowed again, --safe-mode assumed).
const _reset = () => { stopped = false; isolate = ISOLATE; };

module.exports = { ask, killAll, parseJson, claudeArgs, resolveBin, rulePath, programName, _reset };
