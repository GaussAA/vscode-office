// Integration smoke tests: they run inside a real VS Code Extension Development Host,
// which is the only place where "did VS Code actually activate the extension and route
// this file to our custom editor" can be observed. `verify:ui` covers the other half
// (the webview's DOM) in a plain browser.
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
import { defineConfig } from '@vscode/test-cli'

const files = 'out/test/smoke/**/*.test.cjs'
const workspaceFolder = './test/fixtures/workspace'
const mocha = {
	ui: 'bdd',
	// Opening five webview-backed editors in a cold host is slower than a browser
	// render; the default 2s would be flaky.
	timeout: 120000,
}

export default defineConfig([
	{ label: 'smoke-stable', files, version: 'stable', workspaceFolder, mocha },
	{ label: 'smoke-min', files, version: '1.125.0', workspaceFolder, mocha },
])
