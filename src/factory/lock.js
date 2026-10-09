/**
 * One factory at a time: the cron pipeline and a manual factory-run.js share the ledger, the
 * job dirs and the Instagram tab, so overlapping runs could clobber files or post twice.
 * The lock is a file created atomically (O_EXCL) holding the owner's pid; a lock whose owner
 * is no longer running, or that is older than STALE_MS, is taken over.
 */
const fs = require("fs");
const path = require("path");
const { STATE_DIR } = require("./queue");

const FILE = path.join(STATE_DIR, "factory.lock");
const STALE_MS = 3 * 3600 * 1000; // a film is time-boxed to 1 h; nothing legitimate holds it this long

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};

function tryAcquire(label) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, label, at: Date.now() }), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  let owner = null;
  try { owner = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* unreadable: treat as stale */ }
  const stale = !owner || owner.pid === process.pid || !alive(owner.pid) || Date.now() - owner.at > STALE_MS;
  if (!stale) return false;
  fs.rmSync(FILE, { force: true });
  try {
    fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, label, at: Date.now() }), { flag: "wx" });
    return true;
  } catch {
    return false; // someone else took it over first
  }
}

/** Runs fn under the factory lock; returns null (and logs) when another run holds it. */
async function withFactoryLock(label, fn, { logger = console } = {}) {
  if (!tryAcquire(label)) {
    let owner = {};
    try { owner = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* gone */ }
    logger.warn(`Factory: another run (${owner.label || "?"}, pid ${owner.pid || "?"}) is in progress; skipping ${label}.`);
    return null;
  }
  try {
    return await fn();
  } finally {
    try {
      const owner = JSON.parse(fs.readFileSync(FILE, "utf8"));
      if (owner.pid === process.pid) fs.rmSync(FILE, { force: true });
    } catch { /* already gone */ }
  }
}

module.exports = { withFactoryLock, FILE };
