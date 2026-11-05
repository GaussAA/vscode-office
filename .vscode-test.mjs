// Integration smoke tests: they run inside a real VS Code Extension Development Host,
// which is the only place where "did VS Code actually activate the extension and route
// this file to our custom editor" can be observed. `verify:ui` covers the other half
// (the webview's DOM) in a plain browser.
//
// Two configurations on purpose. `smoke-stable` is the everyday run; `smoke-min` runs
// against the oldest VS Code we claim to support, which turns the `engines.vscode` floor
// from a declaration into something that is actually tested. The floor is mirrored in
// scripts/check-baseline.mjs, so raising it means updating both.
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
	{ label: 'smoke-min', files, version: '1.100.0', workspaceFolder, mocha },
])
