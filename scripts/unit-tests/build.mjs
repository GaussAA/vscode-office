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
    jsonlFile: 'src/service/jsonlFile.ts',
    jsonlSession: 'src/service/jsonlSession.ts',
    jsonlSource: 'src/service/jsonlSource.ts',
    jsonlHandlers: 'src/provider/jsonlHandlers.ts',
    jsonlFormat: 'src/react/view/jsonl/jsonlFormat.ts',
    parquetParser: 'src/react/view/parquet/parquetParser.ts',
    parquetSession: 'src/react/view/parquet/parquetSession.ts',
    excelFind: 'src/react/view/excel/excel_find.ts',
    highlight: 'src/react/common/highlight.ts',
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

// The message catalogs live in one file each; bundle them behind a single entry so the
// parity test can compare them without importing ten paths. Export names stay identifier
// safe; the test maps them back to locale codes.
const locales = {
    en: 'en',
    zhCn: 'zh-cn',
    zhTw: 'zh-tw',
    ja: 'ja',
    de: 'de',
    fr: 'fr',
    es: 'es',
    ptBr: 'pt-br',
    ko: 'ko',
    ru: 'ru',
}
const catalogSource = Object.entries(locales)
    .map(([identifier, file]) => `export { default as ${identifier} } from './src/react/i18n/messages/${file}'`)
    .join('\n')

await build({
    stdin: {
        contents: catalogSource,
        resolveDir: root,
        sourcefile: 'i18n-catalog.ts',
        loader: 'ts',
    },
    outfile: join(outdir, 'i18nCatalog.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    alias: { '@': join(root, 'src') },
    logLevel: 'warning',
})

console.log(`bundled ${Object.keys(entries).length} modules into ${outdir}`)
