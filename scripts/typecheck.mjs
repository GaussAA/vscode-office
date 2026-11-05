/**
 * Typecheck gate for the fork.
 *
 * Upstream's tsconfig pairs `resolveJsonModule` with `moduleResolution: "classic"`, which
 * TypeScript rejects outright (TS5070), and the upstream sources still carry ~57 real type
 * errors in gitHistory / vditor / zip code. Rewriting all of that is not this fork's job,
 * so the gate runs tsc with a working configuration and fails only on errors in **files
 * this fork owns**. That way our own code cannot regress while upstream debt stays visible
 * in the output instead of blocking every commit.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Paths whose type errors are ours to fix. Everything else is inherited debt. */
const OWNED = [
    'src/react/view/jsonl/',
    'src/react/view/parquet/',
    'src/react/util/',
    'src/service/jsonlDocument.ts',
    'src/provider/jsonlViewerProvider.ts',
    'src/common/jsonlTypes.ts',
    'scripts/',
    'test/unit/',
]

// Run tsc directly: `pnpm exec` needs a shell on Windows, which Node's spawn warns about.
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
const result = spawnSync(
    process.execPath,
    [
        tsc,
        '--noEmit',
        '--moduleResolution', 'bundler',
        '--module', 'preserve',
        '--skipLibCheck',
        '--lib', 'es2019,dom,dom.iterable',
    ],
    { cwd: root, encoding: 'utf8' },
)

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
const errors = output
    .split(/\r?\n/)
    .filter(line => /error TS\d+/.test(line))

const ownedErrors = errors.filter(line => OWNED.some(prefix => line.includes(prefix)))
const ignored = errors.length - ownedErrors.length

if (ownedErrors.length > 0) {
    console.error(`typecheck: ${ownedErrors.length} error(s) in fork-owned files`)
    for (const line of ownedErrors) console.error(`  ${line}`)
    if (ignored > 0) console.error(`(${ignored} upstream error(s) ignored)`)
    process.exit(1)
}

if (result.status !== 0 && errors.length === 0) {
    // tsc failed for a reason that did not produce a TS error line (bad flag, crash).
    console.error(output.trim() || `typecheck: tsc exited with ${result.status}`)
    process.exit(1)
}

console.log(`typecheck: 0 errors in fork-owned files (${ignored} upstream error(s) ignored)`)

