// Integration smoke tests: they run inside a real VS Code Extension Development Host,
// which is the only place where "did VS Code actually activate the extension and route
// this file to our custom editor" can be observed. `verify:ui` covers the other half
// (the webview's DOM) in a plain browser.
//
// The order matters: extension.test.cjs starts with the "activation is still lazy" check,
// so it must run before hostCache.test.cjs, whose before() activates the extension and opens
// large fixtures. A plain glob is not ordered; list the two suites explicitly.
//
// Two configurations on purpose. `smoke-stable` is the everyday run; `smoke-min` runs
// against the oldest VS Code we claim to support, which turns the `engines.vscode` floor
// from a declaration into something that is actually tested.
//
// THE FLOOR LIVES IN THREE PLACES and all three must move together:
//   1. package.json#engines.vscode              -- what we promise
//   2. scripts/check-baseline.mjs#HOST_NODE_BY_MINOR -- the Node that promise implies
//   3. this file's `smoke-min` version          -- what is actually executed
// (2) asserting (1) only proves the declaration is self-consistent; only (3) proves the
// extension runs there. Raising the floor without touching (3) silently stops testing it.
import { defineConfig } from "@vscode/test-cli";

const files = ["out/test/smoke/extension.test.cjs", "out/test/smoke/hostCache.test.cjs"];
const workspaceFolder = "./test/fixtures/workspace";
const mocha = {
  ui: "bdd",
  // Opening five webview-backed editors in a cold host is slower than a browser
  // render; the default 2s would be flaky.
  timeout: 120000,
};

// The extension API cannot reach into a webview, and the host-side save rules
// (test/smoke/saveHostSuite.ts) are only reachable through the webview's message channel.
// Chromium's remote-debugging port is the one way in that needs no hook in `src/`: it lets
// the test post the same messages the Excel viewer posts and record what the host posts
// back. Keep this number in step with DEBUG_PORT in test/smoke/webviewBridge.ts. The port is
// fixed, so smoke runs must be sequential (they already share one `.vscode-test` install).
const launchArgs = ["--remote-debugging-port=9339"];

export default defineConfig([
  { label: "smoke-stable", files, version: "stable", workspaceFolder, mocha, launchArgs },
  { label: "smoke-min", files, version: "1.125.0", workspaceFolder, mocha, launchArgs },
]);
