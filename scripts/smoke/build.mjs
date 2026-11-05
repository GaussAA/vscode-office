/**
 * Bundle the integration smoke tests for `vscode-test`.
 *
 * Same reasoning as scripts/unit-tests/build.mjs: the tests are TypeScript and the host
 * only loads CommonJS, so esbuild (already a dependency) emits plain CJS into
 * `out/test/smoke/`. `.vscodeignore` already excludes `out/test/**` from the vsix.
 *
 * `pnpm build` wipes `out/`, so this must run *after* it — `pnpm test:smoke` does.
 */
import { build } from 'esbuild'
import { mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outdir = join(root, 'out', 'test', 'smoke')
const testRoot = join(root, 'test', 'smoke')

function findTests(dir) {
    let found = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) found = found.concat(findTests(full))
        else if (entry.name.endsWith('.test.ts')) found.push(full)
    }
    return found
}

mkdirSync(outdir, { recursive: true })

const entryPoints = findTests(testRoot)

if (entryPoints.length === 0) {
    console.error('smoke: no test files found under test/smoke/')
    process.exit(1)
}

await build({
    entryPoints,
    outdir,
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: true,
    // Provided by the host at runtime, never bundled.
    external: ['vscode'],
    alias: { '@': join(root, 'src') },
    logLevel: 'warning',
})

console.log(`bundled ${entryPoints.length} smoke suite(s) into ${outdir}`)
