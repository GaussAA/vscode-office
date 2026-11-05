/**
 * Integration smoke tests — the layer between `node --test` (pure logic) and
 * `verify:ui` (webview DOM in a plain browser).
 *
 * What only this layer can catch: the extension failing to activate, a contributed
 * command disappearing after activation is made lazy, and VS Code no longer routing a
 * file to our `viewType`. Those are precisely the failure modes of the platform-baseline
 * work (engines bump, dropping `onStartupFinished`, adding CSP), none of which a browser
 * test can see.
 *
 * Console-error capture from inside a webview is *not* attempted here: the API does not
 * expose it. `verify:ui` already asserts that.
 */
import * as assert from 'node:assert'
import * as os from 'node:os'
import * as path from 'node:path'
import * as vscode from 'vscode'
import { parquetWriteBuffer } from 'hyparquet-writer'

const EXTENSION_ID = 'chaowu21.office-viewer-plus'

function workspaceRoot(): vscode.Uri {
	const folder = vscode.workspace.workspaceFolders?.[0]
	assert.ok(folder, 'the smoke workspace is not open')
	return folder.uri
}

/** Open `uri` with `viewType`, then wait until a tab actually reports that input. */
async function openWithAndWait(viewType: string, uri: vscode.Uri, timeoutMs = 30000): Promise<vscode.Tab> {
	await vscode.commands.executeCommand('vscode.openWith', uri, viewType)
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		for (const group of vscode.window.tabGroups.all) {
			for (const tab of group.tabs) {
				const input = tab.input
				if (input instanceof vscode.TabInputCustom && input.viewType === viewType) {
					return tab
				}
			}
		}
		await new Promise(resolve => setTimeout(resolve, 100))
	}
	throw new Error(`no custom editor tab appeared for viewType "${viewType}"`)
}

async function closeAllEditors(): Promise<void> {
	await vscode.commands.executeCommand('workbench.action.closeAllEditors')
}

async function parquetFixture(): Promise<vscode.Uri> {
	const dir = vscode.Uri.file(path.join(os.tmpdir(), 'office-viewer-smoke'))
	await vscode.workspace.fs.createDirectory(dir)
	const uri = vscode.Uri.joinPath(dir, 'fixture.parquet')
	const buffer = parquetWriteBuffer({
		columnData: [
			{ name: 'id', data: [1, 2, 3], type: 'INT32' },
			{ name: 'name', data: ['alpha', 'beta', 'gamma'], type: 'STRING' },
		],
	})
	await vscode.workspace.fs.writeFile(uri, new Uint8Array(buffer))
	return uri
}

describe('extension activation', () => {
	it('is installed and activates without throwing', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID)
		assert.ok(extension, `${EXTENSION_ID} is not installed in the development host`)

		await extension.activate()
		assert.strictEqual(extension.isActive, true)
	})
})

describe('contributed commands', () => {
	it('every command declared in package.json is registered after activation', async () => {
		const extension = vscode.extensions.getExtension(EXTENSION_ID)!
		await extension.activate()

		const declared: string[] = (extension.packageJSON?.contributes?.commands ?? []).map(
			(entry: { command: string }) => entry.command,
		)
		assert.ok(declared.length > 0, 'package.json declares no commands')

		const available = new Set(await vscode.commands.getCommands(true))
		const missing = declared.filter(command => !available.has(command))
		assert.deepStrictEqual(missing, [], `commands not registered: ${missing.join(', ')}`)
	})
})

describe('custom editors', () => {
	afterEach(async () => {
		await closeAllEditors()
	})

	const cases: Array<{ viewType: string; fixture: () => Promise<vscode.Uri> }> = [
		{
			viewType: 'chaowu21.markdownViewer',
			fixture: async () => vscode.Uri.joinPath(workspaceRoot(), 'sample.md'),
		},
		{
			viewType: 'chaowu21.htmlViewer',
			fixture: async () => vscode.Uri.joinPath(workspaceRoot(), 'sample.html'),
		},
		{
			viewType: 'chaowu21.officeViewer',
			fixture: async () => vscode.Uri.joinPath(workspaceRoot(), 'sample.csv'),
		},
		{
			viewType: 'chaowu21.jsonlViewer',
			fixture: async () => vscode.Uri.joinPath(workspaceRoot(), 'sample.jsonl'),
		},
		{
			viewType: 'chaowu21.parquetViewer',
			fixture: parquetFixture,
		},
	]

	for (const { viewType, fixture } of cases) {
		it(`routes files to ${viewType}`, async () => {
			const uri = await fixture()
			const tab = await openWithAndWait(viewType, uri)
			assert.strictEqual((tab.input as vscode.TabInputCustom).uri.toString(), uri.toString())
		})
	}
})
