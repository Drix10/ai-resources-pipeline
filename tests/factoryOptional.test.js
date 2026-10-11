require("./_env"); // isolated even when run on its own
// The content factory is an optional add-on in its own repository. Without a checkout the
// pipeline must load, report the factory as requested-but-disabled, and never require it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "factory-optional-test-"));
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ } });

const CONFIG = require.resolve("../config");
const FACTORY = require.resolve("../src/utils/factory");

// src/utils/factory.js resolves FACTORY_DIR when it is required and config/index.js reads
// FACTORY_ENABLED when it loads, so each scenario gets fresh copies of both.
function load(factoryDir, enabled) {
  process.env.FACTORY_DIR = factoryDir;
  process.env.FACTORY_ENABLED = enabled;
  delete require.cache[CONFIG];
  delete require.cache[FACTORY];
  return { config: require(CONFIG), factory: require(FACTORY) };
}

test("FACTORY_ENABLED=true without a checkout: requested, not enabled, nothing to load", () => {
  const empty = fs.mkdtempSync(path.join(TMP, "empty-"));
  const { config, factory } = load(empty, "true");
  assert.equal(factory.FACTORY_DIR, empty);
  assert.equal(config.factory.requested, true);
  assert.equal(config.factory.enabled, false);
  assert.equal(factory.factoryInstalled(), false);
  assert.equal(factory.factoryModule(), null);
  assert.equal(factory.factoryModule("sources"), null);
});

test("with a checkout, factoryModule() returns the factory's entry point", () => {
  const checkout = fs.mkdtempSync(path.join(TMP, "checkout-"));
  fs.mkdirSync(path.join(checkout, "lib"));
  fs.writeFileSync(path.join(checkout, "lib", "index.js"),
    "module.exports = { stub: true, runCycle: async () => ({ ran: true }), stop: () => {} };\n");
  const { config, factory } = load(checkout, "true");
  assert.equal(factory.factoryInstalled(), true);
  assert.equal(config.factory.requested, true);
  assert.equal(config.factory.enabled, true);
  const mod = factory.factoryModule();
  assert.equal(mod, require(path.join(checkout, "lib", "index.js")));
  assert.equal(mod.stub, true);
  assert.equal(typeof mod.runCycle, "function");
  assert.equal(typeof mod.stop, "function");
});

test("a checkout without FACTORY_ENABLED=true stays off", () => {
  const checkout = fs.mkdtempSync(path.join(TMP, "checkout-off-"));
  fs.mkdirSync(path.join(checkout, "lib"));
  fs.writeFileSync(path.join(checkout, "lib", "index.js"), "module.exports = { runCycle: async () => {}, stop: () => {} };\n");
  const { config } = load(checkout, "false");
  assert.equal(config.factory.requested, false);
  assert.equal(config.factory.enabled, false);
});
