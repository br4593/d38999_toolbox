// Dumps the canonical rugged-I/O SVG tables straight out of the shipping
// app/converter.js so the Python SVG smoke test consumes the real source of
// truth (no regex re-implementation drift).
//
// Loads converter.js inside a vm sandbox with a minimal DOM stub. Setting
// document.readyState = "loading" makes the IIFE register a DOMContentLoaded
// listener instead of running initUi(), so nothing touches a real DOM.
//
// Usage:  node _io_svg_tables.js <app-root>   ->   JSON on stdout
//   { "families": RUGGED_IO_FAMILIES, "familySvgMap": FAMILY_SVG_MAP }

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = process.argv[2];
if (!ROOT) {
  process.stderr.write("usage: node _io_svg_tables.js <app-root>\n");
  process.exit(2);
}

const stubEl = new Proxy({}, {
  get(t, k) {
    if (k === "addEventListener") return () => {};
    if (k === "appendChild") return () => stubEl;
    if (k === "querySelector") return () => stubEl;
    if (k === "querySelectorAll") return () => [];
    if (k === "classList") return { add() {}, remove() {}, toggle() {} };
    if (k === "dataset") return {};
    if (k === "style") return {};
    return undefined;
  },
  set() { return true; },
});

const sandbox = {
  console: { log() {}, error() {}, warn() {} },
  window: { D38999_TOOLBOX_DATA: { converter: {} } },
  document: {
    readyState: "loading", // -> converter.js waits, never calls initUi()
    addEventListener() {},
    querySelector() { return stubEl; },
    querySelectorAll() { return []; },
    getElementById() { return stubEl; },
    createElement() { return stubEl; },
    dispatchEvent() { return true; },
  },
};
sandbox.globalThis = sandbox;
sandbox.window.document = sandbox.document;

const ctx = vm.createContext(sandbox);
const file = path.join(ROOT, "app", "converter.js");
vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });

const api = sandbox.D38999Converter;
if (!api || !api.RUGGED_IO_FAMILIES || !api.FAMILY_SVG_MAP) {
  process.stderr.write("converter.js did not expose RUGGED_IO_FAMILIES / FAMILY_SVG_MAP\n");
  process.exit(3);
}
process.stdout.write(JSON.stringify({
  families: api.RUGGED_IO_FAMILIES,
  familySvgMap: api.FAMILY_SVG_MAP,
}));
