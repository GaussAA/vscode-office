/**
 * Typecheck gate.
 *
 * Runs tsc over the whole `src` tree (extension host + every webview) with
 * `tsconfig.check.json`, then compares the errors against a checked-in baseline.
 *
 * The baseline is a ratchet, not an allowlist of paths:
 *  - every error is identified by file + code + message (line numbers excluded, so
 *    moving code does not invalidate it);
 *  - an error that is not in the baseline fails the build;
 *  - an error that disappears only produces a reminder to regenerate the baseline.
 *
 * `pnpm typecheck:update` rewrites the baseline. Review the diff: it must only ever
 * shrink.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const baselinePath = join(here, 'typecheck-baseline.json')
const update = process.argv.includes('--update')
const verbose = process.argv.includes('--verbose')

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const result = spawnSync(
    process.execPath,
    [tsc, '-p', join(root, 'tsconfig.check.json'), '--pretty', 'false'],
    { cwd: root, encoding: 'utf8' },
)

if (result.error) {
    console.error(`typecheck: failed to start tsc — ${result.error.message}`)
    process.exit(1)
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/
const errors = []
for (const line of output.split(/\r?\n/)) {
    const match = ERROR_LINE.exec(line)
    if (!match) continue
    const [, file, , , code, message] = match
    errors.push({ file: file.replace(/\\/g, '/'), code, message: message.trim() })
}

if (errors.length === 0 && result.status !== 0) {
    // tsc failed without emitting a single parseable error: configuration problem.
    console.error('typecheck: tsc exited non-zero without a recognisable diagnostic')
    console.error(output.trim() || '(no output)')
    process.exit(1)
}

const keyOf = error => `${error.file}|${error.code}|${error.message}`

if (update) {
    const sorted = errors
        .slice()
        .sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
        .map(({ file, code, message }) => ({ file, code, message }))
    writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
    console.log(`typecheck: baseline rewritten with ${sorted.length} known error(s)`)
    process.exit(0)
}

let baseline = []
try {
    baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
} catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.error(`typecheck: ${baselinePath} is missing — run 'pnpm typecheck:update' once`)
    process.exit(1)
}

// Multiset comparison: the same file may legitimately repeat an identical message.
const remaining = new Map()
for (const entry of baseline) {
    const key = keyOf(entry)
    remaining.set(key, (remaining.get(key) ?? 0) + 1)
}

const introduced = []
for (const error of errors) {
    const key = keyOf(error)
    const count = remaining.get(key) ?? 0
    if (count > 0) {
        remaining.set(key, count - 1)
    } else {
        introduced.push(error)
    }
}

const fixed = [...remaining.values()].reduce((sum, count) => sum + count, 0)

if (introduced.length > 0) {
    console.error(`\ntypecheck: ${introduced.length} new error(s) — not in the baseline\n`)
    for (const error of introduced) {
        console.error(`  ${error.file}  ${error.code}  ${error.message}`)
    }
    console.error('\nFix them, or (only if genuinely inherited debt) run `pnpm typecheck:update` and review the diff.')
    process.exit(1)
}

if (verbose) {
    for (const error of errors) console.log(`  ${error.file}  ${error.code}  ${error.message}`)
}

const hint = fixed > 0 ? " — run 'pnpm typecheck:update' to shrink the baseline" : ''
console.log(`typecheck: 0 new error(s) · baseline ${baseline.length} known · ${fixed} fixed${hint}`)
