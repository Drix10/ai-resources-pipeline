/**
 * Opus client for the content factory.
 *
 * Default backend: the LOCAL Claude Code CLI (`claude -p`), on the machine that runs `npm start`,
 * signed in with your Claude plan. No API key. Model and effort come from config
 * (FACTORY_OPUS_MODEL, FACTORY_CLAUDE_EFFORT=xhigh).
 *
 * Optional API backends for servers without Claude Code: FACTORY_OPUS_BACKEND=anthropic
 * (ANTHROPIC_API_KEY) or openrouter (OPENROUTER_API_KEY).
 *
 * Images (vision QA) are passed as file paths; Claude Code reads them with its Read tool,
 * the API backends get them inline as base64.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const config = require("../../config");
const { logger, sleep } = require("../utils/helpers");

const usage = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };

/**
 * @param {object} p
 * @param {string} p.system
 * @param {string} p.prompt
 * @param {string[]} [p.imageFiles] absolute paths of JPEG/PNG files to look at
 * @param {number} [p.maxTokens]  (API backends only)
 * @param {number} [p.temperature] (API backends only)
 */
async function ask({ system, prompt, imageFiles = [], maxTokens = 8000, temperature = 0.7 }) {
  const backend = config.factory.opusBackend;
  if (backend === "anthropic") return viaAnthropic({ system, prompt, imageFiles, maxTokens, temperature });
  if (backend === "openrouter") return viaOpenRouter({ system, prompt, imageFiles, maxTokens, temperature });
  return viaClaudeCode({ system, prompt, imageFiles });
}

// ---------------------------------------------------------------- Claude Code (default)

/**
 * On Windows an npm install puts `claude.cmd` on PATH, and spawn() cannot run a .cmd without a
 * shell (which would mangle long multi-line args). Resolve to the claude.exe the shim launches.
 */
function resolveBin(bin, { platform = process.platform, pathEnv = process.env.PATH } = {}) {
  if (platform !== "win32" || path.extname(bin)) return bin;
  for (const dir of String(pathEnv || "").split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, `${bin}.exe`);
    if (fs.existsSync(exe)) return exe;
    const cmd = path.join(dir, `${bin}.cmd`);
    if (!fs.existsSync(cmd)) continue;
    const m = fs.readFileSync(cmd, "utf8").match(/"%dp0%\\?([^"]+\.exe)"/i);
    if (m && fs.existsSync(path.join(dir, m[1]))) return path.join(dir, m[1]);
  }
  return bin;
}
let resolvedBin = null;
const claudeBin = () => (resolvedBin ??= resolveBin(config.factory.claudeBin));

/** Runs `claude -p` with the prompt on stdin. Resolves with the final text result. */
function runClaude(args, { input, cwd, timeoutMs, logFile = null, stream = false, env = {} }) {
  if (stream) {
    // Live transcript: one JSON event per line; the last "result" event carries the answer.
    const i = args.indexOf("--output-format");
    if (i >= 0) args = [...args.slice(0, i), "--output-format", "stream-json", "--verbose", ...args.slice(i + 2)];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(claudeBin(), args, { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const log = logFile ? fs.createWriteStream(logFile, { flags: "w" }) : null;
    child.stdout.on("data", (d) => { out += d; if (log) log.write(d); });
    child.stderr.on("data", (d) => { err += d; if (log) log.write(d); });
    child.on("close", () => log && log.end());
    const timer = setTimeout(() => { child.kill("SIGTERM"); reject(new Error(`claude -p timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      const error = new Error(`Could not start Claude Code ("${claudeBin()}"): ${e.message}. Install it and sign in: npm i -g @anthropic-ai/claude-code && claude`);
      error.code = "OPUS_UNAVAILABLE";
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let parsed = null;
      if (stream) {
        const lines = out.trim().split("\n").reverse();
        for (const l of lines) { try { const ev = JSON.parse(l); if (ev.type === "result") { parsed = ev; break; } } catch { /* partial line */ } }
      } else {
        try { parsed = JSON.parse(out); } catch { /* non-json output */ }
      }
      if (parsed) {
        usage.calls++;
        usage.inputTokens += parsed.usage?.input_tokens || 0;
        usage.outputTokens += parsed.usage?.output_tokens || 0;
        usage.costUsd += parsed.total_cost_usd || 0;
        if (parsed.is_error || code !== 0) return reject(new Error(`claude -p failed: ${String(parsed.result || err).slice(0, 400)}`));
        return resolve({ text: String(parsed.result || ""), raw: parsed, stdout: out, stderr: err });
      }
      if (code !== 0) return reject(new Error(`claude -p exited ${code}: ${(err || out).slice(-400)}`));
      resolve({ text: out, raw: null, stdout: out, stderr: err });
    });
    child.stdin.end(input);
  });
}

/** Common flags: model, effort, JSON envelope. */
function claudeArgs(extra = []) {
  return ["-p", "--model", config.factory.anthropic.model, "--effort", config.factory.claudeEffort, "--output-format", "json", ...extra];
}

async function viaClaudeCode({ system, prompt, imageFiles }) {
  // Director calls are pure text jobs: no tools except Read for the QA images.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "factory-opus-"));
  try {
    const files = imageFiles.map((f) => path.resolve(f));
    const look = files.length
      ? `\n\nFirst use the Read tool to look at each of these image files, in order:\n${files.map((f, i) => `${i + 1}. ${f}`).join("\n")}\n`
      : "";
    const extra = ["--append-system-prompt", system];
    if (files.length) extra.push("--allowedTools", "Read", "--add-dir", ...[...new Set(files.map((f) => path.dirname(f)))]);
    else extra.push("--disallowedTools", "Bash", "Edit", "Write", "WebFetch", "WebSearch");
    const { text } = await runClaude(claudeArgs(extra), { input: `${prompt}${look}`, cwd: dir, timeoutMs: config.factory.anthropic.requestTimeoutMs });
    return text;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- API fallbacks

const b64 = (f) => fs.readFileSync(f).toString("base64");
const mediaType = (f) => (/\.png$/i.test(f) ? "image/png" : "image/jpeg");

async function withRetry(label, fn) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e.status === 429 || e.status === 529 || (e.status >= 500 && e.status < 600) || e.name === "AbortError";
      if (!retryable || attempt === 3) break;
      logger.warn(`${label}: ${e.message}; retrying (${attempt}/3)...`);
      await sleep(4000 * attempt);
    }
  }
  throw last;
}

async function postJson(url, headers, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) {
      const err = new Error(`${res.status} ${(await res.text()).slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function viaAnthropic({ system, prompt, imageFiles, maxTokens, temperature }) {
  const { apiKey, baseUrl, model, requestTimeoutMs } = config.factory.anthropic;
  if (!apiKey) throw Object.assign(new Error("FACTORY_OPUS_BACKEND=anthropic needs ANTHROPIC_API_KEY."), { code: "OPUS_UNAVAILABLE" });
  const content = [
    ...imageFiles.map((f) => ({ type: "image", source: { type: "base64", media_type: mediaType(f), data: b64(f) } })),
    { type: "text", text: prompt },
  ];
  return withRetry("Opus (Anthropic API)", async () => {
    const data = await postJson(`${baseUrl}/v1/messages`, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model, max_tokens: maxTokens, temperature, system, messages: [{ role: "user", content }] }, requestTimeoutMs);
    usage.calls++;
    usage.inputTokens += data.usage?.input_tokens || 0;
    usage.outputTokens += data.usage?.output_tokens || 0;
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  });
}

async function viaOpenRouter({ system, prompt, imageFiles, maxTokens, temperature }) {
  const { apiKey, baseUrl } = config.llm.openrouter;
  if (!apiKey) throw Object.assign(new Error("FACTORY_OPUS_BACKEND=openrouter needs OPENROUTER_API_KEY."), { code: "OPUS_UNAVAILABLE" });
  const content = [
    ...imageFiles.map((f) => ({ type: "image_url", image_url: { url: `data:${mediaType(f)};base64,${b64(f)}` } })),
    { type: "text", text: prompt },
  ];
  return withRetry("Opus (OpenRouter)", async () => {
    const data = await postJson(`${baseUrl}/chat/completions`, { Authorization: `Bearer ${apiKey}`, "X-Title": "ai-resources-pipeline/factory" }, { model: config.factory.openrouterOpusModel, max_tokens: maxTokens, temperature, messages: [{ role: "system", content: system }, { role: "user", content }] }, config.factory.anthropic.requestTimeoutMs);
    usage.calls++;
    usage.inputTokens += data.usage?.prompt_tokens || 0;
    usage.outputTokens += data.usage?.completion_tokens || 0;
    return data.choices?.[0]?.message?.content || "";
  });
}

/** Pulls the first JSON object out of a reply (tolerates ```json fences and prose around it). */
function parseJson(text) {
  const t = String(text || "").replace(/```(?:json)?/gi, "");
  const start = t.indexOf("{");
  if (start < 0) throw new Error("Opus reply had no JSON object.");
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
  throw new Error("Opus reply had an unterminated JSON object.");
}

module.exports = { ask, parseJson, runClaude, claudeArgs, resolveBin, usage };
