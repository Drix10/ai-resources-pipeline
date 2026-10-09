#!/usr/bin/env node
/**
 * Screenshot tool for the film agent:
 *   node shot.js <url> <out.jpg> [--mobile] [--card] [--light]
 * --mobile captures a tall phone-width page to scroll through, --card a 900-wide close-up;
 * default is a desktop viewport. Only http(s) on 80/443, only hosts in FACTORY_SHOT_HOSTS
 * (the article's own links, set by hero.js), and only into the current workspace, so every
 * capture is of something the article actually points to.
 */
const path = require("path");
const { shootOne } = require("./assets");

const normHost = (h) => String(h || "").trim().toLowerCase().replace(/\.+$/, "");

async function main() {
  const args = process.argv.slice(2);
  const [url, out] = args.filter((a) => !a.startsWith("--"));
  if (!url || !out) throw new Error("usage: node shot.js <url> <out.jpg> [--mobile] [--card] [--light]");
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error(`only http(s) URLs (got ${u.protocol})`);
  const host = normHost(u.hostname);
  const allowed = String(process.env.FACTORY_SHOT_HOSTS || "").split(",").map(normHost).filter(Boolean);
  if (!allowed.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error(`${host} is not linked from the article (allowed: ${allowed.join(", ") || "none"})`);
  const file = path.resolve(out);
  const root = path.resolve(process.cwd());
  if (!/\.jpe?g$/i.test(file) || /:.*:/.test(file.slice(2))) throw new Error("output must be a .jpg path");
  if (path.relative(root, file).startsWith("..") || path.isAbsolute(path.relative(root, file))) throw new Error("output must be inside the workspace");
  const kind = args.includes("--mobile") ? "mobile" : args.includes("--card") ? "card" : "desktop";
  const info = await shootOne(url, file, { kind, dark: !args.includes("--light") });
  console.log(JSON.stringify({ file, title: info.title, url: info.url, width: info.width, height: info.height }));
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`shot failed: ${e.message}`);
    process.exit(1);
  },
);
