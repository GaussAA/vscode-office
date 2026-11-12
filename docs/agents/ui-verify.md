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
├── browser.mjs   Puppeteer driver (puppeteer-core + @puppeteer/browsers) + a CDP session for CSP logs
├── fixtures.mjs  generates mixed/big parquet with hyparquet-writer, uses committed zstd sample
└── fixtures/zstd.parquet
```

The fake bridge posts the same messages the extension host does (`jsonlInfo`,
`jsonlEntries`, `jsonlSearchBatch`, `jsonlEntryData`, `jsonInfo`, `jsonRecordsData`,
`jsonRecordData`, `jsonSearchBatch`, `jsonRoot`, `open`), so the real React bundles
run unchanged. Parquet fixtures are served with `Range` support and every request is
counted in `/stats` — that counter is how lazy loading and the next-page prefetch are
asserted (`0` new range reads when paging forward).

## Commands

```bash
pnpm build            # required: the harness serves out/webview
pnpm verify:ui                  # assert only
pnpm verify:ui --docs           # also refresh docs/screenshots
pnpm verify:ui --filter=parquet # only matching scenarios (pnpm forwards args directly)
pnpm verify:ui --headed         # watch it run
```

Chrome or Edge is auto-detected; set `CHROME_PATH` to override. Node >= 22 is required
(global `WebSocket`). No network access is needed: the 4 KB ZSTD sample is committed and
the other fixtures are generated locally.

### Reproducing a CI-only flake

A scenario that passes locally and fails in CI is almost always a timing difference, and
re-running it locally proves nothing. `UI_VERIFY_CPU=8` throttles the browser through
`Emulation.setCPUThrottlingRate`, which makes the machine behave like a loaded runner:

```bash
UI_VERIFY_CPU=8 node scripts/ui-verify/runner.mjs --filter=parquet-json-links-column-jump
```

Note what it does _not_ prove: at high rates an unrelated earlier wait (mounting the table)
times out first, so a failure under throttling is not automatically the same failure you saw
in CI. Read the message — `table did not render` and `did not bring the column into view` are
different bugs. Prefer making the scenario wait for the _precondition_ its assertion needs
("the table can scroll sideways") over adding a retry: a retry hides the next real regression.

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

`remaining-routes-smoke` walks the **React** routes without a behavioural scenario of their
own — `excel` since the Git History panel was removed in 6.8.0 — with a minimal `open`
payload and asserts that
something mounted and nothing threw. Its job is to catch fork-wide breakage (entry, provider,
shared utilities), **not** rendering correctness. It polls for the mount (`page.waitFor`)
rather than sleeping a fixed delay: the excel chunk is ~1.3 MB and mounts slower on a loaded
machine than any fixed delay we would pick.

`parquet` (`parquet-*`), `jsonl` (`jsonl-*`) and `json` (`json-*`) have their own scenarios instead.
`test/unit/viewer-registry.test.ts` asserts that every route in `main.tsx` is covered one way
or the other, so adding a route without coverage fails the build instead of silently shrinking
the suite.

No viewer is served outside the React route table anymore: the HTML preview panel and the PDF
viewer were the last two, and both were removed in 6.0.0.
