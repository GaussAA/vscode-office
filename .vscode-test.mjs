// Integration smoke tests: they run inside a real VS Code Extension Development Host,
// which is the only place where "did VS Code actually activate the extension and route
// this file to our custom editor" can be observed. `verify:ui` covers the other half
// (the webview's DOM) in a plain browser.
import { defineConfig } from '@vscode/test-cli'

export default defineConfig({
	label: 'smoke',
	files: 'out/test/smoke/**/*.test.cjs',
	version: 'stable',
	workspaceFolder: './test/fixtures/workspace',
	mocha: {
		ui: 'bdd',
		// Opening five webview-backed editors in a cold host is slower than a browser
		// render; the default 2s would be flaky.
		timeout: 120000,
	},
})
