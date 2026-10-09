/**
 * One factory at a time: the cron pipeline and a manual factory-run.js share the ledger, the
 * job dirs and the Instagram tab, so overlapping runs could clobber files or post twice.
 * The lock is a file created atomically (O_EXCL) holding the owner's pid and a heartbeat that
 * the owner refreshes while it works. It is taken over only when its owner is gone or its
 * heartbeat has stopped (a crashed run, or Windows reusing a dead run's pid), never just
 * because a legitimate run is long: a cycle with a director's prompt and an agent film can
 * run for hours.
 */
const fs = require("fs");
const path = require("path");
const { STATE_DIR } = require("./queue");

const FILE = path.join(STATE_DIR, "factory.lock");
const BEAT_MS = 2 * 60 * 1000;
const STALE_MS = 20 * 60 * 1000;

const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
};

const readOwner = () => {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return null; }
};

const write = (label, flag) => fs.writeFileSync(FILE, JSON.stringify({ pid: process.pid, label, at: Date.now(), beat: Date.now() }), { flag });
/** Rewrites the lock atomically, so a reader never sees it half-written. */
const rewrite = (data) => {
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, FILE);
};
const ageMs = () => { try { return Date.now() - fs.statSync(FILE).mtimeMs; } catch { return Infinity; } };

function tryAcquire(label, { now = Date.now() } = {}) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  try {
    write(label, "wx");
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const owner = readOwner();
  const lastBeat = owner ? Number(owner.beat || owner.at) || 0 : 0;
  // An unreadable lock is only stale when the file itself is old (it may be mid-write).
  const stale = !owner ? ageMs() > STALE_MS : owner.pid === process.pid || !alive(owner.pid) || now - lastBeat > STALE_MS;
  if (!stale) return false;
  fs.rmSync(FILE, { force: true });
  try {
    write(label, "wx");
    return true;
  } catch {
    return false; // someone else took it over first
  }
}

/** Runs fn under the factory lock; returns null (and logs) when another run holds it. */
async function withFactoryLock(label, fn, { logger = console } = {}) {
  if (!tryAcquire(label)) {
    const owner = readOwner() || {};
    logger.warn(`Factory: another run (${owner.label || "?"}, pid ${owner.pid || "?"}) is in progress; skipping ${label}.`);
    return null;
  }
  // Heartbeat: proves this run is alive however long it takes.
  const beat = setInterval(() => {
    const owner = readOwner();
    if (owner && owner.pid === process.pid) {
      try { rewrite({ ...owner, beat: Date.now() }); } catch { /* next beat */ }
    }
  }, BEAT_MS);
  beat.unref();
  try {
    return await fn();
  } finally {
    clearInterval(beat);
    const owner = readOwner();
    if (owner && owner.pid === process.pid) fs.rmSync(FILE, { force: true });
  }
}

module.exports = { withFactoryLock, tryAcquire, FILE, STALE_MS };
