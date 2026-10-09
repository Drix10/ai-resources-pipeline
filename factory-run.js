#!/usr/bin/env node
/**
 * Content factory CLI (nothing is posted to Instagram unless --publish AND IG_POST=true).
 *
 *   node factory-run.js --sample                      render the bundled sample reel + carousel (no keys, no Claude)
 *   node factory-run.js --list                        list candidate sources, best first
 *   node factory-run.js --sync-library                clone/update the reference repos the library links to
 *   node factory-run.js --source "LinkedIn Insights/<file>.md" [--format reel|carousel] [--mode agent|template]
 *                                                   (--force re-makes a piece already in the ledger, never a posted one)
 *   node factory-run.js --cycle [--publish [--dry]]   one full factory pass: pick, research, make; posts only with --publish
 *                                                   (the cron hook posts when IG_POST=true)
 *   node factory-run.js --queue                       show the ledger
 *   node factory-run.js --publish [--id <id>] [--dry] post (or dry-run) the next rendered piece
 */
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { logger } = require("./src/utils/helpers");

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

async function sample() {
  const { renderReel, renderCarousel, contactSheet } = require("./src/factory/render");
  const sb = JSON.parse(fs.readFileSync(path.join(__dirname, "factory/fixtures/struct-padding.json"), "utf8"));
  const out = path.join(__dirname, "factory/state/jobs/sample");
  const reel = await renderReel(sb, out);
  const car = await renderCarousel({ ...sb, format: "carousel" }, path.join(out, "carousel"));
  contactSheet(car.slides, path.join(out, "carousel/contact.jpg"));
  logger.info(`Sample: ${reel.video} (${reel.seconds}s) and ${car.slides.length} slides in ${out}`);
}

async function main() {
  const factory = require("./src/factory");
  const sources = require("./src/factory/sources");
  const queue = require("./src/factory/queue");

  if (flag("sample")) return sample();

  if (flag("sync-library")) {
    const library = require("./src/factory/library");
    for (const r of library.syncRepos()) console.log(`${r.ok ? "ok    " : "FAILED"} ${r.url}${r.error ? `\n       ${r.error}` : ""}`);
    console.log(`${library.videos().length} library entries; the film agent sees all of them.`);
    return;
  }

  if (flag("list")) {
    for (const a of sources.rankSources(sources.listInsights()).slice(0, 25)) console.log(`${a.origin}\n   ${a.title}`);
    return;
  }

  if (flag("queue")) {
    for (const it of queue.load().items) console.log(`${it.status.padEnd(9)} ${String(it.format).padEnd(8)} ${String(it.mode || "").padEnd(8)} ${it.id || it.key}${it.dir ? `\n          ${it.dir}` : ""}${it.error ? `\n          ${it.error}` : ""}`);
    return;
  }

  if (opt("source")) {
    const format = opt("format");
    const mode = opt("mode");
    if (format && !["reel", "carousel"].includes(format)) throw new Error(`--format must be reel or carousel (got "${format}")`);
    if (mode && !["agent", "template"].includes(mode)) throw new Error(`--mode must be agent or template (got "${mode}")`);
    const file = path.resolve(opt("source"));
    const base = sources.fromInsight(file);
    const formats = (format ? [format] : config.factory.formats).filter((f) => {
      const entry = queue.entryFor(base, f);
      // Something that may be on Instagram is never made again: refuse before spending an hour on it.
      if (entry && queue.LIVE.has(entry.status)) {
        logger.warn(`${f} of "${base.title}" is ${entry.status} on Instagram; it is never made again.`);
        return false;
      }
      if (!queue.has(base, f) || flag("force")) return true;
      logger.warn(`${f} of "${base.title}" is already in the ledger; pass --force to make it again.`);
      return false;
    });
    if (!formats.length) return;
    await require("./src/factory/lock").withFactoryLock("source", async () => {
      const article = await require("./src/factory/editor").deepDive(base);
      for (const f of formats) await factory.produce(article, f, { mode: mode || undefined });
    }, { logger });
    return;
  }

  if (flag("cycle")) return void (await factory.runCycle({ publish: flag("publish"), dryRun: flag("dry") || !config.instagram.post }));

  if (flag("publish")) return void (await factory.publishDue({ dryRun: flag("dry") || !config.instagram.post, id: opt("id") }));

  console.log(fs.readFileSync(__filename, "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*?/, "").replace(/^ \* ?/gm, ""));
}

main().then(() => process.exit(0)).catch((e) => {
  logger.error(`factory-run failed: ${e.stack || e.message}`);
  process.exit(1);
});
