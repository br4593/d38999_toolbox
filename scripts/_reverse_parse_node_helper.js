// JSONL server: reads {"id":N,"pn":"..."} per line on stdin,
// writes {"id":N,"candidates":[...]} or {"id":N,"error":"..."} per line on stdout.
// Loads the real app/app-data.js + app/converter.js in a vm sandbox so we
// exercise the same reverse parser that ships in the browser.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const readline = require("readline");

const ROOT = process.argv[2];
if (!ROOT) {
  process.stderr.write("usage: node _reverse_parse_node_helper.js <app-root>\n");
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
  globalThis: {},
  window: {},
  document: {
    addEventListener() {},
    querySelector() { return stubEl; },
    querySelectorAll() { return []; },
    getElementById() { return stubEl; },
    createElement() { return stubEl; },
    readyState: "complete",
  },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, "app-data.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "converter.js"), "utf8"), sandbox);

const C = sandbox.globalThis.D38999Converter;
if (!C || typeof C.reverseParseManufacturerPin !== "function") {
  process.stderr.write("D38999Converter.reverseParseManufacturerPin not exposed\n");
  process.exit(2);
}

const rl = readline.createInterface({ input: process.stdin });
process.stdout.write(JSON.stringify({ ready: true }) + "\n");

rl.on("line", (line) => {
  if (!line) return;
  let req;
  try { req = JSON.parse(line); }
  catch (e) {
    process.stdout.write(JSON.stringify({ error: "bad_json: " + e.message }) + "\n");
    return;
  }
  try {
    const out = C.reverseParseManufacturerPin(req.pn) || [];
    process.stdout.write(JSON.stringify({ id: req.id, candidates: out }) + "\n");
  } catch (e) {
    process.stdout.write(JSON.stringify({ id: req.id, error: String(e && e.message || e) }) + "\n");
  }
});

rl.on("close", () => { process.exit(0); });
