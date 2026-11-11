# Performance gate

`pnpm verify:perf` runs the built viewers in headless Chrome **and the JSONL host services in
Node** and asserts seven numbers that used to be catastrophic and invisible:

| invariant                                  | budget                                    | why it exists                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| first paint reads at most 1.25x the file   | measured ~1.04x (1M rows), ~1.10x (small) | the viewer issues the visible page and its prefetch back to back; without in-flight deduplication in the range cache that is 2.04x the file                                                                                                 |
| a whole-file search is one pass            | 1M rows < 12 s, 200k x 60 cols < 12 s     | the old per-5000-row-batch loop re-decoded the data page containing each batch: ~28 s for 1M rows, ~40 s for 200k x 60                                                                                                                      |
| a 21 MB CSV paints its windowed view       | < 2 s, heap < 200 MB, < 100 DOM rows      | the read-only window scans bytes for record starts instead of building a cell object per value: measured 477 ms / 33 MB / 42 rows                                                                                                           |
| a page turn on 60 columns stays usable     | best of 3: warm < 2 s, cold < 5 s         | idle: 210 ms warm (render of 3,000 cells), 520 ms cold (one decoded data page per column). Loose on purpose — load inflates samples 2-4x, and the regression this catches is 5-10x                                                          |
| a JSONL directory window stays in budget   | 80 MB / 40 lines: ≤ 3 rows, < 1.5 s       | a 500-line request without the 4 MB byte budget parses all 40 × 2 MB lines before the first row; measured 15 ms / 1 row                                                                                                                     |
| a whole-file JSONL search is one pass      | 200k lines < 5 s, `scanned == total`      | the line window per turn must stay byte-bounded; a per-batch re-read or an unbounded window shows up as an order-of-magnitude jump. Measured 0.3–0.5 s                                                                                      |
| a 100 MB JSON array is indexed, not parsed | index < 6 s, window < 2 s, search < 8 s   | a `JSON.parse` of the whole file would allocate hundreds of MB and block the host; the scanner must only record boundaries and parse the 100 records in the requested window. Measured 1.37 s / 3 ms / 114 ms on 91.6 MB and 50,000 records |

It is separate from `pnpm verify:ui` on purpose: that suite answers "does the DOM look
right" with small fixtures; this one answers "what did it cost" with large files, and byte
counts — not DOM assertions — are the evidence.

## How it works

```
scripts/perf/
├── runner.mjs    scenarios + budgets + CLI (exit code is the gate)
├── jsonl.mjs     the two JSONL Node-only checks; bundles the host services with esbuild
├── json.mjs      the JSON array index/window/search check; bundles jsonPreview.ts
├── expect.mjs    the assertion primitive shared by both scenario modules
├── harness.mjs   HTTP server: built HTML from out/webview, fake bridge, Range + byte counting
└── fixtures.mjs  generates two ONE-ROW-GROUP parquet files with hyparquet-writer, plus the
                  JSONL fixtures (40 × 2 MB lines, 200k log lines) and the 100 MB JSON array
                  into .perf/
```

Both fixtures are written with a single row group, which is what PyArrow produces by default
(`_DEFAULT_ROW_GROUP_SIZE = 1024 * 1024` rows). That shape is where the difference between
"read the pages you need" and "read the row group" is largest, so it is the shape the gate
measures. The server counts **bytes served**, which is the number that matters for a remote
workspace; the in-page stopwatch (`window.__bench.t0` → `ready`, two frames after the first
row paints) keeps DevTools round-trip time out of the duration.

The JSONL checks are host-side on purpose: indexing, window parsing and the whole-file scan
happen in the extension host, so the browser harness cannot see them. The JSONL module bundles
`jsonlFile.ts`, `jsonlSession.ts` and `jsonlFormat.ts` with esbuild into a temp directory and
imports the ESM output. The window check asserts the **returned row count** (≤3 for 2 MB
lines), not only time: that is the deterministic proof that the 4 MB budget is applied.

The JSON check bundles `jsonPreview.ts` and reads the 91.6 MB fixture once. It asserts the
record count, the 100-record window size, the last-record match and the scanned character
count, so a whole-file `JSON.parse` or a per-record re-scan fails on both time and result
shape, not only on a stopwatch.

## Commands

```bash
pnpm build             # required: the harness serves out/webview
pnpm verify:perf       # assert
pnpm verify:perf --all           # also print fixture sizes
pnpm verify:perf --filter=search # only matching scenarios
pnpm verify:perf --headed        # watch it run
```

Fixtures are cached in `.perf/` (gitignored), so a warm run costs nothing.

## Reading a failure

The message names the usual cause, because both budgets fail for exactly one reason:

- **first paint over budget** → duplicate in-flight range requests. Check that
  `rangeBackedBuffer`'s `inFlight` map is still consulted before `fetch`, and that the viewer
  still opens one source per document rather than two.
- **search over budget** → something is reading per batch again. `parquetSearch.ts` must walk
  each column once via `parquetRead`'s `onPage`; a `parquetReadObjects` call inside a row loop
  is the regression.
- **JSONL window over rows** → the byte budget stopped being applied. Check
  `JsonlSession.readRange`'s `advance(from, lines, bytes)` call and `JsonlFile.advance`: a
  request for 500 lines must still return only what fits in 4 MB (one line here).
- **JSONL search over budget** → the per-turn window grew back to a line count with no byte
  bound, or a batch re-decodes the same lines. Check `JSONL_SEARCH_BYTE_BUDGET` and
  `JsonlSession.search`'s `advance` call.
- **JSON index/window/search over budget** → the top-level array is being parsed whole, or
  `recordsInWindow`/`search` is re-parsing records. Check that `indexJsonArray` only records
  boundaries, and that `JsonPreviewSession.recordsInWindow` parses at most 100 records.

Both were verified by mutation: deleting the `inFlight` lookup takes first paint to 2.10x
(FAIL), and restoring the per-batch search takes the 1M-row scan to ~28 s (FAIL, budget
12 s). The timing budgets are deliberately loose — search time on one machine varies by ~2x
run to run — because the regression being guarded is an order of magnitude, not a few
percent. If a change makes a scan legitimately slower (more columns decoded per row, say),
raise the budget in the same commit and say why.

## What is not gated

- **Page turns on wide tables (~0.5 s after the fix).** Prefetching the next page used to
  start in the same tick as the visible page, so a cache hit on a 60-column file took 1.2-1.9 s
  instead of 0.5 s: decoding the next page (one data page per column, ~1.2 s) ran on the same
  thread as the render of the current one. The prefetch is idle-scheduled now
  (`requestIdleCallback`, 1.5 s timeout) and the measured turn drops to ~0.5 s. The remaining
  half-second is antd rendering 50 x 60 cells; a virtual table would cut it further, at the
  cost of the DOM shape several UI scenarios assert on. Not gated because a budget there sits
  inside run-to-run noise (~2x on a loaded machine) while the regression it would guard is
  only 2-3x.
- **The editable spreadsheet path below 8 MB** is still all-at-once, so it has no budget: the
  numbers move with the grid implementation, not with us. Above 8 MB the windowed view is
  gated (row above); above 25 MB (CSV/TSV) the size guard asks first
  ([ADR-0016](../adr/0016-preview-size-guard.md)).
- **Parquet row virtualisation: shipped, after moving the suite with it.** antd's `virtual`
  table renders the ~22 rows the viewport holds instead of all 50, which halved the warm page
  turn (210 → 111 ms) and left the cold one decode-bound (632 ms, unchanged). The price was a
  DOM shape change — a div-based list instead of `<tr>/<td>` — so the nine UI assertions that
  indexed `tbody tr:nth-child(2) td` were rewritten against `.ant-table-row` / `.ant-table-cell`
  first, in its own commit, and the two that depended on "the first rendered row is the page's
  first row" now assert on the target row instead.
- **Page-turn timing varies 2-4x with machine load**, so `parquet-wide-page-turn` asserts the
  best of three samples and reports all of them: 210-915 ms warm and 520-1,850 ms cold were all
  observed on the same build and hardware.
- **Two spreadsheet micro-optimisations that were measured and dropped** (on the 152 MB CSV):
  the double UTF-8 decode is 108 ms of a 9.7 s load, and the extra JSZip pass for a workbook's
  sort state is 15-41 ms of a 10 s load — about 1% each. The time is in `parseCsv` (1.5 s) and
  then in one object per cell plus the grid; windowing is the only fix that moves it. The
  decode is still worth collapsing for the transient allocation, but it is not a performance
  project.
- **Inline bytes over the bridge** are base64 now, not a `number[]` (5-8x the file on a JSON
  message vs 4/3). `parquet-inline-buffer` renders a virtual document from a base64 payload, so
  the decode path is covered; nothing measures the message size itself.
- **JSONL open latency** (the 80 MB index scan, ~0.3 s here) is not gated; the window and
  search checks above catch the shape regressions, and the index scan is linear by design.
- **Open latency itself** (1-3 s for 1M rows x 5 columns, dominated by decoding the first data
  page per column plus loading the ~430 KB parquet bundle) is not asserted either: it moves
  with bundle size, and the byte budget above already catches the failure mode that mattered.
- Nothing here asserts smoothness of scrolling; only the numbers above are enforced.
