/**
 * The Instagram content factory is an optional add-on, kept in its own private repository and
 * checked out at ./factory (or FACTORY_DIR). The pipeline runs without it; with FACTORY_ENABLED=true
 * and a checkout present, each run ends with a factory pass.
 */
const fs = require("fs");
const path = require("path");

const FACTORY_DIR = path.resolve(__dirname, "..", "..", process.env.FACTORY_DIR || "factory");

/** True when the factory's code is checked out where the pipeline expects it. */
const factoryInstalled = () => fs.existsSync(path.join(FACTORY_DIR, "lib", "index.js"));

/** A factory module ("" for its entry point, or e.g. "sources"); null when the factory is not installed. */
function factoryModule(name = "") {
  if (!factoryInstalled()) return null;
  return require(path.join(FACTORY_DIR, "lib", name));
}

module.exports = { FACTORY_DIR, factoryInstalled, factoryModule };
