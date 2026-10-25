const fs = require("fs");
const path = require("path");
const { REPO_ROOT } = require("../src/utils/helpers");

// A running pipeline owns the LinkedIn tab and the tracker file: a script would drive the same Chrome and
// two writers would lose tracker entries. A lock whose pid is gone is stale.
function pipelineRunning() {
  const lockPath = process.env.PIPELINE_LOCK_PATH || path.join(REPO_ROOT, ".pipeline.lock");
  if (!fs.existsSync(lockPath)) return false;
  try {
    const { pid } = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    process.kill(pid, 0); // throws ESRCH when the process is gone
    return true;
  } catch (e) {
    return e.code === "EPERM" || e instanceof SyntaxError; // alive but not ours / lock mid-write
  }
}

module.exports = { pipelineRunning };
