/**
 * Typecheck gate.
 *
 * Runs tsc over the whole `src` tree (extension host + every webview) with
 * `tsconfig.json`, then compares the errors against a checked-in baseline.
 *
 * The baseline is a ratchet, not an allowlist of paths:
 *  - every error is identified by file + code + message (line numbers excluded, so
 *    moving code does not invalidate it);
 *  - an error that is not in the baseline fails the build;
 *  - an error that disappears only produces a reminder to regenerate the baseline.
 *
 * `pnpm typecheck:update` rewrites the baseline. Review the diff: it must only ever shrink.
 *
 * ## Why `--self-test` exists
 *
 * This gate reads tsc's *human-readable* text output with a regular expression, because
 * TypeScript 7 has no machine-readable diagnostics: `tsc --json` is `error TS5023`, and the
 * only structured exit (`typescript/unstable/sync`) is explicitly unstable. A regex over
 * text has one catastrophic failure mode — if the format shifts, zero errors are parsed,
 * tsc exits 0, and the gate reports success while checking nothing.
 *
 * `pnpm typecheck:self-test` writes a file with a known type error, asserts the gate sees
 * it, and deletes it. It is the only thing that can tell "no errors" apart from
 * "no errors *found*". Run it after upgrading TypeScript.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const baselinePath = join(here, 'typecheck-baseline.json')
const update = process.argv.includes('--update')
const verbose = process.argv.includes('--verbose')
const selfTest = process.argv.includes('--self-test')

const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

function runTsc() {
    const result = spawnSync(
        process.execPath,
        [tsc, '-p', join(root, 'tsconfig.json'), '--pretty', 'false'],
        { cwd: root, encoding: 'utf8' },
    )
    if (result.error) {
        console.error(`typecheck: failed to start tsc — ${result.error.message}`)
        process.exit(1)
    }
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function parseErrors(output) {
    const errors = []
    for (const line of output.split(/\r?\n/)) {
        const match = ERROR_LINE.exec(line)
        if (!match) continue
        const [, file, , , code, message] = match
        errors.push({ file: file.replace(/\\/g, '/'), code, message: message.trim() })
    }
    return errors
}

if (selfTest) {
    const probe = join(root, 'src', '__typecheck_self_test__.ts')
    const relativeProbe = 'src/__typecheck_self_test__.ts'
    const body = [
        '// Written by `pnpm typecheck:self-test`. Deleted by that command before it returns.',
        "export const probe: number = 'this is not a number'",
        '',
    ].join('\n')

    let failure
    try {
        writeFileSync(probe, body, 'utf8')
        const { output } = runTsc()
        // tsc reports paths relative to the -p cwd, with no leading slash.
        const caught = parseErrors(output).find(error => error.file.endsWith(relativeProbe))
        if (!caught) {
            failure = [
                '\ntypecheck self-test: FAILED — the gate did not see the injected error,',
                'so a green `pnpm typecheck` would prove nothing. tsc said:\n',
                output.trim().split(/\r?\n/).slice(0, 20).join('\n') || '(no output)',
            ].join('\n')
        } else {
            console.log(`typecheck self-test: injected an error, the gate reported ${caught.code} ✓`)
        }
    } finally {
        rmSync(probe, { force: true })
    }

    // `process.exit()` skips `finally`, so the probe is cleaned up before either exit below.
    if (failure) {
        console.error(failure)
        process.exit(1)
    }
    process.exit(0)
}

const { status, output } = runTsc()
const errors = parseErrors(output)

if (errors.length === 0 && status !== 0) {
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
