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

/**
 * What people search for, from the factory's daily Search Console read (state/demand.json: the site's top, rising
 * and gap queries), lowercased. Read-only; [] when the factory, the file or a Search Console read is missing.
 */
function searchedQueries() {
  try {
    const site = JSON.parse(fs.readFileSync(path.join(FACTORY_DIR, "state", "demand.json"), "utf8"))?.demand?.site || {};
    return ["top", "rising", "gaps"].flatMap((k) => (Array.isArray(site[k]) ? site[k] : []))
      .map((x) => String(x?.query || "").toLowerCase().trim()).filter(Boolean);
  } catch {
    return [];
  }
}

module.exports = { FACTORY_DIR, factoryInstalled, factoryModule, searchedQueries };
