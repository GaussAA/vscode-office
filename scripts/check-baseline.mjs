/**
 * Platform baseline gate.
 *
 * `engines.vscode`, `@types/vscode` and `@types/node` describe three different things but
 * are read as one promise: "the API surface this extension may use, and the host it will
 * actually run on". When they drift apart the promise becomes a lie -- the code compiles
 * against 2026 APIs while claiming to support a 2022 host, and `vsce` only compares the
 * *declared* major.minor, so nothing catches it.
 *
 * That is exactly what had happened here (`^1.64.0` declared, 1.144.0 installed), so this
 * gate checks both the declaration and the install. See docs/adr/0003-platform-baseline.md.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/**
 * Node.js major bundled with the *minimum* supported VS Code, by release line.
 * The floor matters, not the current stable: `@types/node` newer than the oldest host
 * lets the code call APIs that do not exist for the users most likely to break.
 * Data: Electron release notes per VS Code release (`releases.electronjs.org`).
 */
const HOST_NODE_BY_MINOR = [
	[64, 14],
	[70, 16],
	[82, 18],
	[90, 20],
	[105, 22],
	[125, 24],
]

const problems = []

function fail(message) {
	problems.push(message)
}

function majorMinor(version) {
	const match = /^(\d+)\.(\d+)/.exec(version)
	return match ? [Number(match[1]), Number(match[2])] : undefined
}

function format([major, minor]) {
	return `${major}.${minor}`
}

function hostNodeFor([major, minor]) {
	if (major !== 1) return undefined
	let result
	for (const [line, node] of HOST_NODE_BY_MINOR) {
		if (minor >= line) result = node
	}
	return result
}

function installedVersion(name) {
	try {
		return JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')).version
	} catch {
		return undefined
	}
}

const engines = manifest.engines?.vscode
const vscodeRange = manifest.devDependencies?.['@types/vscode']
const nodeRange = manifest.devDependencies?.['@types/node']

if (!engines) fail('package.json has no engines.vscode')
if (!vscodeRange) fail('package.json has no devDependency on @types/vscode')
if (!nodeRange) fail('package.json has no devDependency on @types/node')

if (problems.length === 0) {
	const enginesLine = majorMinor(engines.replace(/^[\^~>=<\s]+/, ''))
	const declaredVscodeLine = majorMinor(vscodeRange.replace(/^[\^~>=<\s]+/, ''))

	if (!enginesLine) fail(`engines.vscode "${engines}" is not a plain version range`)
	if (!declaredVscodeLine) fail(`@types/vscode "${vscodeRange}" is not a plain version range`)

	if (enginesLine && declaredVscodeLine && format(enginesLine) !== format(declaredVscodeLine)) {
		fail(
			`engines.vscode is ${format(enginesLine)} but @types/vscode declares ${format(declaredVscodeLine)}` +
				' -- they must be the same major.minor',
		)
	}

	// The installed tree is what tsc actually reads. A caret range makes the declaration
	// look fine while resolving to a much newer API surface, which is the bug this gate
	// exists to prevent.
	const installedVscode = installedVersion('@types/vscode')
	const installedVscodeLine = installedVscode && majorMinor(installedVscode)
	if (!installedVscodeLine) {
		fail('@types/vscode is not installed -- run pnpm install')
	} else if (enginesLine && format(installedVscodeLine) !== format(enginesLine)) {
		fail(
			`@types/vscode resolves to ${installedVscode} but engines.vscode is ${format(enginesLine)}` +
				' -- pin it with ~ so the two cannot drift',
		)
	}

	const hostNode = enginesLine && hostNodeFor(enginesLine)
	if (enginesLine && hostNode === undefined) {
		fail(`no Node.js mapping for VS Code ${format(enginesLine)} -- extend HOST_NODE_BY_MINOR`)
	}

	const nodeMajor = majorMinor(nodeRange.replace(/^[\^~>=<\s]+/, ''))?.[0]
	const installedNode = installedVersion('@types/node')
	const installedNodeMajor = installedNode && majorMinor(installedNode)?.[0]

	for (const [label, major] of [
		['@types/node (declared)', nodeMajor],
		['@types/node (installed)', installedNodeMajor],
	]) {
		if (major === undefined) {
			fail(`${label} is missing or unparsable`)
		} else if (hostNode !== undefined && major > hostNode) {
			fail(
				`${label} targets Node ${major} but the minimum supported VS Code ` +
					`(${format(enginesLine)}) hosts Node ${hostNode}` +
					' -- raise engines.vscode or lower @types/node',
			)
		}
	}

	if (problems.length === 0) {
		console.log(
			`baseline: engines ${format(enginesLine)} ≡ @types/vscode ${installedVscode} → host Node ${hostNode}; ` +
				`@types/node ${installedNode} ✓`,
		)
	}
}

if (problems.length > 0) {
	console.error('\nbaseline: the platform baseline is inconsistent\n')
	for (const problem of problems) console.error(`  ${problem}`)
	console.error('\nFix package.json, or update the mapping in scripts/check-baseline.mjs.')
	process.exit(1)
}
