/**
 * claude.js
 *
 * One headless Claude Code call (`claude -p` on the account's Claude subscription): the prompt on
 * stdin, the reply text back. The LLM provider "claude" (config.llm.providers) runs on it.
 * A call is text only, or may Read the given images and nothing else: no other tool, no MCP server,
 * no session kept. The child gets an allow-listed environment: no posting, API or repo key reaches
 * it, and an Anthropic API key would bill the API instead of the plan.
 *
 * Errors carry a code a caller can act on:
 *  CLAUDE_UNAVAILABLE  the CLI is missing or not signed in (`claude` once, then /login)
 *  CLAUDE_LIMIT        the plan's usage limit is reached
 *  CLAUDE_TIMEOUT      the call ran past its time-out (the process tree is killed)
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
  "CLAUDE_CONFIG_DIR", "CLAUDE_CODE_GIT_BASH_PATH",
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
 * (which would mangle a long prompt's arguments): resolve to the claude.exe the shim launches.
 */
function resolveBin(bin = "claude", { platform = process.platform, pathEnv = process.env.PATH } = {}) {
  bin = String(bin || "claude").trim().replace(/^"(.*)"$/, "$1");
  if (platform !== "win32") return bin;
  const fromShim = (cmd) => {
    if (!fs.existsSync(cmd)) return null;
    const m = fs.readFileSync(cmd, "utf8").match(/"%dp0%\\?([^"]+\.exe)"/i);
    const exe = m && path.join(path.dirname(cmd), m[1]);
    return exe && fs.existsSync(exe) ? exe : null;
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

/** The arguments of one call: text only, or Read limited to the images' own folders. */
function claudeArgs({ model, effort, system = "", imageFiles = [] }) {
  const dirs = [...new Set(imageFiles.map((f) => path.dirname(path.resolve(f))))];
  const out = ["-p", "--no-session-persistence", "--model", model, "--effort", effort, "--output-format", "json", "--strict-mcp-config"];
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
/** Kills every running call (the pipeline's shutdown). */
function killAll() {
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
  const files = imageFiles.map((f) => path.resolve(f));
  const look = files.length ? `\n\nFirst use the Read tool to look at each of these image files, in order:\n${files.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n` : "";
  const exe = resolveBin(bin);
  const args = claudeArgs({ model, effort, system, imageFiles: files });
  // A .js CLI (a test's fake, or a wrapper) runs on this node.
  const [cmd, argv] = /\.(?:m|c)?js$/i.test(exe) ? [process.execPath, [exe, ...args]] : [exe, args];
  let cwd;
  try { cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-claude-")); } catch (e) { return Promise.reject(withCode(`no temp folder for claude: ${e.message}`, "CLAUDE_FAILED")); }
  return new Promise((resolve, reject) => {
    let settled = false, out = "", err = "", child = null, timer = null;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child) live.delete(child);
      try { fs.rmSync(cwd, { recursive: true, force: true }); } catch (e) { /* a temp folder left behind costs nothing */ }
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
      let parsed = null;
      try { parsed = JSON.parse(out); } catch (e) { /* not the JSON envelope */ }
      if (parsed && !parsed.is_error && code === 0 && String(parsed.result || "").trim()) return finish(resolve, String(parsed.result));
      const said = `${(parsed && parsed.result) || ""}\n${err}\n${parsed ? "" : out}`.trim();
      const code_ = LIMIT_RE.test(said) || Number(parsed && parsed.api_error_status) === 429 ? "CLAUDE_LIMIT"
        : AUTH_RE.test(said) || Number(parsed && parsed.api_error_status) === 401 ? "CLAUDE_UNAVAILABLE" : "CLAUDE_FAILED";
      finish(reject, withCode(`claude -p failed (exit ${code}): ${said.slice(0, 300) || "an empty reply"}`, code_));
    });
    child.stdin.end(`${prompt}${look}`);
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

module.exports = { ask, killAll, parseJson, claudeArgs, resolveBin, rulePath, programName, LIMIT_RE, AUTH_RE };
