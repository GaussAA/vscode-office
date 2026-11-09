# Performance gate

`pnpm verify:perf` runs the built parquet viewer in headless Chrome and asserts two numbers
that used to be catastrophic and invisible:

| invariant                                | budget                                    | why it exists                                                                                                                               |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| first paint reads at most 1.25x the file | measured ~1.04x (1M rows), ~1.10x (small) | the viewer issues the visible page and its prefetch back to back; without in-flight deduplication in the range cache that is 2.04x the file |
| a whole-file search is one pass          | 1M rows < 12 s, 200k x 60 cols < 12 s     | the old per-5000-row-batch loop re-decoded the data page containing each batch: ~28 s for 1M rows, ~40 s for 200k x 60                      |

It is separate from `pnpm verify:ui` on purpose: that suite answers "does the DOM look
right" with small fixtures; this one answers "what did it cost" with large files, and byte
counts — not DOM assertions — are the evidence.

## How it works

```
scripts/perf/
├── runner.mjs    scenarios + budgets + CLI (exit code is the gate)
├── harness.mjs   HTTP server: built HTML from out/webview, fake bridge, Range + byte counting
└── fixtures.mjs  generates two ONE-ROW-GROUP files with hyparquet-writer into .perf/
```

Both fixtures are written with a single row group, which is what PyArrow produces by default
(`_DEFAULT_ROW_GROUP_SIZE = 1024 * 1024` rows). That shape is where the difference between
"read the pages you need" and "read the row group" is largest, so it is the shape the gate
measures. The server counts **bytes served**, which is the number that matters for a remote
workspace; the in-page stopwatch (`window.__bench.t0` → `ready`, two frames after the first
row paints) keeps DevTools round-trip time out of the duration.

## Commands

```bash
pnpm build             # required: the harness serves out/webview
pnpm verify:perf       # assert
pnpm verify:perf -- --all                 # also print fixture sizes
pnpm verify:perf -- --filter=search       # only matching scenarios
pnpm verify:perf -- --headed              # watch it run
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

Both were verified by mutation: deleting the `inFlight` lookup takes first paint to 2.10x
(FAIL), and restoring the per-batch search takes the 1M-row scan to ~28 s (FAIL, budget
12 s). The timing budgets are deliberately loose — search time on one machine varies by ~2x
run to run — because the regression being guarded is an order of magnitude, not a few
percent. If a change makes a scan legitimately slower (more columns decoded per row, say),
raise the budget in the same commit and say why.

## What is not gated

- Spreadsheet (CSV/XLSX) cost: a 19 MB workbook took 10 s and a 152 MB CSV held 1.36 GB of
  heap. A budget there needs a size guard first (ADR or feature), not a threshold.
- Wide-table page turns (60 columns, ~1.4 s): dominated by decoding one data page per column
  plus rendering 3,000 antd cells. Fix is a decoded-row cache and/or a virtual table.
- Nothing here asserts smoothness of scrolling; only the two numbers above are enforced.
