# UI verification

`pnpm verify:ui` runs the built webviews in headless Chrome, asserts the DOM, and writes
screenshots to `.ui-verify/shots/`. It exists because the webviews only run inside a
`postMessage` bridge, so "looks right in the code" is not evidence — every change to a
viewer should be checked here before it ships.

## How it works

```
scripts/ui-verify/
├── runner.mjs    scenarios + assertions + CLI
├── harness.mjs   HTTP server: built HTML from out/webview + fake VS Code bridge + parquet bytes
├── cdp.mjs       minimal Chrome DevTools Protocol driver (no puppeteer)
├── fixtures.mjs  generates mixed/big parquet with hyparquet-writer, uses committed zstd sample
└── fixtures/zstd.parquet
```

The fake bridge posts the same messages the extension host does (`jsonlInfo`,
`jsonlEntries`, `jsonlSearchBatch`, `jsonlEntryData`, `open`), so the real React bundles
run unchanged. Parquet fixtures are served with `Range` support and every request is
counted in `/stats` — that counter is how lazy loading and the next-page prefetch are
asserted (`0` new range reads when paging forward).

## Commands

```bash
pnpm build            # required: the harness serves out/webview
pnpm verify:ui        # assert only
pnpm verify:ui -- --docs   # also refresh docs/screenshots
pnpm verify:ui -- --filter=parquet
pnpm verify:ui -- --headed # watch it run
```

Chrome or Edge is auto-detected; set `CHROME_PATH` to override. Node >= 22 is required
(global `WebSocket`). No network access is needed: the 4 KB ZSTD sample is committed and
the other fixtures are generated locally.

## Adding a scenario

Append to `scenarios` in `runner.mjs`:

```js
{
    name: 'viewer-what-it-proves',
    docs: 'optional-screenshot-name.png',   // copied to docs/screenshots with --docs
    async run({ page, base, stats }) {
        await openParquet(page, base, '?mixed=1')
        const state = json(await page.evaluate(`JSON.stringify({ /* read DOM */ })`))
        expect(state.range === '1–50 of 300', `unexpected range: ${state.range}`)
        return 'one line of evidence for the summary table'
    },
}
```

Rules that keep this suite useful:

- Assert on **user-visible facts** (text, ranges, counts, computed heights), not internals.
- One scenario per behaviour; name it after the fact it proves.
- A scenario must fail for a real regression: no screenshot-only checks.
- Colours are user-visible too: `parquet-theme-follows-vscode` asserts the _luminance_ of the
  native input and of the antd input under both themes, because the two used to be driven by
  different colour sources (a VS Code CSS variable and antd's default light tokens) and
  disagreed with the page whenever the theme did not match.

## Route smoke vs. real scenarios

`upstream-viewers-smoke` walks every **React** route (`image`, `svg`, `excel`, `zip`,
`word`, `ppt`, `font`, `epub`, `icns`, `psd`, `xmind`, `gitHistory`)
with a minimal `open` payload and asserts that something mounted and nothing threw. Its job
is to catch fork-wide breakage (entry, provider, shared utilities), **not** rendering
correctness.

It waits for the mount (`page.waitFor`) rather than sleeping a fixed delay: the excel and
epub chunks are ~1 MB, and a fixed 900 ms per route both flaked under load and wasted
~8 s per run.

Two routes are not in the smoke list because they have their own scenarios:
`parquet` (`parquet-*`) and `jsonl` (`jsonl-*`). `test/unit/viewer-registry.test.mjs`
asserts that every route in `main.tsx` is covered one way or the other, so adding a route
without coverage fails the build instead of silently shrinking the suite.

Three viewers are not React routes and are therefore not in the smoke list:

- `html` and `pdf` are served by the extension provider as standalone HTML documents
  (`loadWorkspaceHtml` / `loadPdfViewer`), so there is no bundle to mount.
- `markdown` ships its own Vditor-based editor bundle, not the `out/webview` entry.

If you touch those paths, verify them manually in VS Code; extending the harness to cover
them means faking their own host protocols, which is a separate piece of work.
