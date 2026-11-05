/**
 * Bundle the pure-logic modules for `node --test`.
 *
 * Node cannot import `.ts`/`.tsx` directly, and we do not want to add vitest/jest, so
 * esbuild (already a dependency) produces plain ESM in `out/unit-tests/`. Tests import
 * those bundles; `pnpm test` rebuilds them first.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outdir = join(root, 'out', 'unit-tests')

mkdirSync(outdir, { recursive: true })

const entries = {
    jsonlDocument: 'src/service/jsonlDocument.ts',
    jsonlFormat: 'src/react/view/jsonl/jsonlFormat.tsx',
    parquetParser: 'src/react/view/parquet/parquetParser.ts',
}

for (const [name, entry] of Object.entries(entries)) {
    await build({
        entryPoints: [join(root, entry)],
        outfile: join(outdir, `${name}.mjs`),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node20',
        alias: { '@': join(root, 'src') },
        logLevel: 'warning',
    })
}

console.log(`bundled ${Object.keys(entries).length} modules into ${outdir}`)
