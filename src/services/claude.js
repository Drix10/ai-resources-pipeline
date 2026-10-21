/**
 * claude.js
 *
 * One headless Claude Code call (`claude -p` on the account's Claude subscription): the prompt on
 * stdin, the reply text back. The LLM provider "claude" (config.llm.providers) runs on it.
 * A call is text only, or may Read copies of the given images and nothing else: no other tool, no MCP
 * server, no session kept, and none of the user's own Claude Code setup (CLAUDE.md, hooks, plugins,
 * skills: --safe-mode). A browser call (`chrome`) is a Claude in Chrome session (`claude -p --chrome`)
 * on the owner's own default Chrome and the logins it already has: only the Chrome tools of
 * CHROME_TOOLS, no file, shell or web tool. Its prompt keeps it to the sites and steps it is given, and
 * anything it may do in public waits for a GO from a one-shot local gate (gate()), decided in Node. The child gets an allow-listed environment: no posting, API or repo key
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
// A browser call's tools: tabs, reading and clicking a page, and the page's JavaScript (each prompt gives the
// exact scripts it may run); never a form filler, a file upload, a batch that runs the others unseen, the
// network or console logs, or another browser.
const CHROME = "mcp__claude-in-chrome__";
const CHROME_TOOLS = ["list_connected_browsers", "select_browser", "tabs_context_mcp", "tabs_create_mcp", "tabs_close_mcp", "navigate", "read_page", "get_page_text", "find", "computer", "javascript_tool"].map((t) => CHROME + t);
const CHROME_DENY = ["form_input", "file_upload", "upload_image", "browser_batch", "shortcuts_execute", "shortcuts_list", "gif_creator", "read_network_requests", "read_console_messages", "switch_browser", "resize_window"].map((t) => CHROME + t);
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

/** The arguments of one call: text only, Read limited to the images' own folders, or a browser session (`chrome`). */
function claudeArgs({ model, effort, system = "", imageFiles = [], chrome = false, isolation = isolate }) {
  const dirs = [...new Set(imageFiles.map((f) => path.dirname(path.resolve(f))))];
  // (a browser call keeps the Claude in Chrome server: --strict-mcp-config would leave it out)
  const out = ["-p", "--no-session-persistence", "--model", model, "--effort", effort, "--output-format", "json", ...isolation, ...(chrome ? ["--chrome"] : ["--strict-mcp-config"])];
  if (system) out.push("--append-system-prompt", system);
  if (chrome) out.push("--tools", "", "--allowedTools", ...CHROME_TOOLS, "--disallowedTools", ...DENY, ...CHROME_DENY);
  else if (dirs.length) out.push("--tools", "Read", "--allowedTools", ...dirs.map((d) => `Read(${rulePath(d)}/**)`), "--disallowedTools", ...DENY.filter((t) => t !== "Read"), "--add-dir", ...dirs);
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
 * @param {{prompt: string, system?: string, imageFiles?: string[], chrome?: boolean, model: string, effort: string, timeoutMs?: number, bin?: string}} p
 */
function ask({ prompt, system = "", imageFiles = [], chrome = false, model, effort, timeoutMs = 5 * 60 * 1000, bin = "claude" }) {
  if (chrome && imageFiles.length) return Promise.reject(withCode("a claude call gets a browser or images, never both", "CLAUDE_FAILED"));
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
    const args = claudeArgs({ model, effort, system, imageFiles: files, chrome, isolation: used });
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

/** A text as two of the same are compared: its spacing and zero-width characters aside. Self-contained (runs in a page too). */
const normText = (s) => String(s || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/\s+/g, " ").trim();
/** A 53-bit hash of a text (cyrb53), as base-36. Self-contained (runs in a page too). */
const textHash = (s) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};
/** A function's source on one line, for a browser session to hand to javascript_tool as given. */
const oneLine = (fn) => String(fn).replace(/\/\*.*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s+/g, " ");
/**
 * The CHECK one-liner a browser session runs before an action: the gate's address for action `id`, ending in the
 * hash of the text the page holds in `selector` ("none" when it holds none, "-" when `selector` is "").
 */
const checkScript = (gateUrl, id, selector = "") => `(() => { const norm = ${oneLine(normText)}; const hash = ${oneLine(textHash)}; const sel = ${JSON.stringify(selector)}; const el = sel ? [...document.querySelectorAll(sel)].pop() : null; const t = el ? norm(el.innerText) : ""; return ${JSON.stringify(`${gateUrl}/${id}/`)} + (sel ? (t ? hash(t) : "none") : "-"); })()`;

/**
 * The KEEP one-liner wrapping a page read (`expr`: an object, or its JSON): it keeps the read, with the tab's MARK and
 * address, in the tab's sessionStorage for SEND, and returns only its outline (a list as its length, the rest cut).
 * A read never passes through the model: javascript_tool shows it about 1000 characters of a result, and blocks
 * one that carries a query string (so the outline leaves every "?..." out).
 */
const keepScript = (expr) => `(() => { let v = ${expr}; if (typeof v === "string") { try { v = JSON.parse(v); } catch (e) {} } const all = JSON.parse(sessionStorage.getItem("cc:kept") || "[]"); all.push({ at: sessionStorage.getItem("cc:at") || "", url: location.href, v }); sessionStorage.setItem("cc:kept", JSON.stringify(all)); const cut = (s, n) => String(s).replace(/\\?[^\\s"]*/g, "?").slice(0, n); const o = {}; for (const [f, x] of Object.entries(v && typeof v === "object" ? v : { value: v })) o[f] = Array.isArray(x) ? x.length : typeof x === "string" ? cut(x, 400) : x && typeof x === "object" ? cut(JSON.stringify(x), 300) : x; return JSON.stringify(o); })()`;
/** The MARK one-liner: the label the tab's next reads are kept under. */
const markScript = (label) => `sessionStorage.setItem("cc:at", ${JSON.stringify(String(label))})`;
/**
 * The SEND one-liner: the tab's kept reads go to the gate (`gateUrl`/in) as one address, which the tab then opens; the
 * gate sends the tab back to its page, with "#gate=RECEIVED" (GATE_SAYS reads it).
 * shortcut: Chrome caps an address near 2 MB, so the oldest reads are dropped past 1.9 MB; send twice if reads ever grow that big.
 */
const sendScript = (gateUrl) => `(() => { let all = JSON.parse(sessionStorage.getItem("cc:kept") || "[]"); let u = ""; for (;;) { u = ${JSON.stringify(`${gateUrl}/in?d=`)} + encodeURIComponent(JSON.stringify(all)); if (u.length < 1900000 || !all.length) break; all = all.slice(1); } setTimeout(() => { location.href = u + "&back=" + encodeURIComponent(location.href.split("#")[0]); }, 100); return "sending " + all.length + " reads"; })()`;

/** The GATE_SAYS one-liner: what the gate said, from the address it sent the tab back to ("" before it has). */
const GATE_SAYS = `decodeURIComponent((location.hash.match(/^#gate=(.*)$/) || ["", ""])[1])`;

/**
 * A one-shot local gate a browser session must open before each public action: GET <url>/<id>/<hash> answers
 * decide(id, hash) ("GO: ...", "DRY RUN: ..." or "STOP: ..."), once per id: a second visit hears the first answer,
 * so a STOP never turns into a GO. GET <url>/in?d=<JSON> is where SEND delivers a session's kept reads (`got`, in
 * arrival order). Only 127.0.0.1, behind a random path. Resolves { url, close, said, got }.
 */
async function gate(decide) {
  const http = require("http");
  const nonce = require("crypto").randomBytes(16).toString("hex");
  const said = new Map();
  const got = [];
  // A SEND address runs to ~2 MB, past Node's 16 KB default.
  const server = http.createServer({ maxHeaderSize: 4 * 1024 * 1024 }, (req, res) => {
    const u = new URL(req.url, "http://gate.invalid");
    // Claude in Chrome reads no 127.0.0.1 page (nor closes its tab): with an https `back`, the answer goes back there as #gate=<answer>.
    const back = /^https:\/\/[^\s#]+$/.test(u.searchParams.get("back") || "") ? u.searchParams.get("back") : "";
    const answer = (text) => {
      if (back) res.writeHead(302, { location: `${back}#gate=${encodeURIComponent(text)}`, "cache-control": "no-store" });
      else res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      res.end(back ? "" : text);
    };
    if (u.pathname === `/gate/${nonce}/in`) {
      try { got.push(JSON.parse(u.searchParams.get("d"))); } catch { return answer("NOT RECEIVED"); }
      return answer("RECEIVED");
    }
    const m = new RegExp(`^/gate/${nonce}/([\\w-]{1,40})/([0-9a-z-]{1,20})/?$`).exec(u.pathname);
    if (!m) { res.writeHead(404); return res.end(); }
    if (!said.has(m[1])) {
      let answer;
      try { answer = String(decide(m[1], m[2])); } catch (e) { answer = `STOP: ${e.message}`; }
      said.set(m[1], answer);
    }
    answer(said.get(m[1]));
  });
  await new Promise((ok, fail) => { server.once("error", fail); server.listen(0, "127.0.0.1", ok); });
  return { url: `http://127.0.0.1:${server.address().port}/gate/${nonce}`, close: () => server.close(), said, got };
}

// Tests only: a fresh module state (calls allowed again, --safe-mode assumed).
const _reset = () => { stopped = false; isolate = ISOLATE; };

module.exports = { ask, killAll, parseJson, claudeArgs, resolveBin, rulePath, programName, gate, checkScript, keepScript, markScript, sendScript, GATE_SAYS, oneLine, textHash, normText, CHROME_TOOLS, CHROME_DENY, _reset };
