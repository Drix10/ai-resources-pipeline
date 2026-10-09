#!/usr/bin/env node
/**
 * Screenshot tool for the film agent:
 *   node shot.js <url> <out.jpg> [--mobile] [--light]
 * --mobile captures a tall phone-width page to scroll through; default is a desktop viewport.
 * Only hosts in FACTORY_SHOT_HOSTS (the article's own links, set by hero.js) are allowed, so
 * every capture is of something the article actually points to.
 */
const path = require("path");
const { shootOne } = require("./assets");

async function main() {
  const args = process.argv.slice(2);
  const [url, out] = args.filter((a) => !a.startsWith("--"));
  if (!url || !out) throw new Error("usage: node shot.js <url> <out.jpg> [--mobile] [--light]");
  const host = new URL(url).hostname.toLowerCase();
  const allowed = String(process.env.FACTORY_SHOT_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!allowed.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error(`${host} is not linked from the article (allowed: ${allowed.join(", ") || "none"})`);
  if (!/\.(jpe?g)$/i.test(out)) throw new Error("output must be a .jpg path");
  const info = await shootOne(url, path.resolve(out), { kind: args.includes("--mobile") ? "mobile" : "desktop", dark: !args.includes("--light") });
  console.log(JSON.stringify({ file: path.resolve(out), title: info.title, url: info.url, width: info.width, height: info.height }));
}

main().catch((e) => {
  console.error(`shot failed: ${e.message}`);
  process.exit(1);
});
