# NOTICE

This project is a fork of [Office Viewer](https://github.com/cweijan/vscode-office) by
Weijan Chen (@cweijan), licensed under the MIT License. The original copyright notice is
preserved in [LICENSE](./LICENSE).

Fork identity: `chaowu21.office-viewer-plus` (display name "Office Viewer Plus").

## What this fork changed

- **Parquet: compressed columns actually decode.** Upstream bundles `hyparquet` without
  `hyparquet-compressors`, so only SNAPPY works and ZSTD files fail with
  `parquet unsupported compression codec: ZSTD`. This fork passes `compressors` from
  `hyparquet-compressors`, covering SNAPPY, GZIP, BROTLI, ZSTD, LZ4 and LZ4_RAW.
  Because the writer can only encode SNAPPY, saving a non-SNAPPY file now warns that the
  codec will change before writing.
- **Parquet cells are rendered by type.** Numbers are right-aligned with tabular figures and
  coloured, strings/booleans/timestamps get their own colours from the VS Code chart palette,
  nulls show an explicit italic `NULL`, edited cells carry a marker, and clicking a cell opens
  the full value (copyable) below the table. The next page is prefetched and the last six pages
  are cached, so paging forward needs no extra reads.
- **JSONL long values wrap.** Entries with up to 500 nodes render with wrapping (the virtual
  list is switched off, since rows are no longer fixed height); bigger entries stay on one
  line with an ellipsis and remain copyable.- **Parquet has whole-file search.** The box in the toolbar scans the file in 5 000-row
  batches (cancelled by a newer query), shows progress, marks matching rows, highlights the
  matching text inside cells, and jumps to the first match. It reads every row group it
  visits, so on a very large file the scan is I/O bound — that is the stated trade-off:
  display stays lazy, an explicit search is allowed to be expensive.- **Parquet rows are read one page at a time.** Upstream reads every row into memory and
  slices 50 per page; this fork reads only the visible page with `rowStart`/`rowEnd` and
  keeps edits in an absolute-row patch map, so a huge file no longer materialises its
  whole table. Saving re-reads the file, re-applies the patches and writes it back.
- **Large parquet files open read-only, and every page is reachable by row number.** Editing
  re-reads and rewrites the whole file, so above 200 000 rows the viewer disables editing and
  says why. The footer takes a row number (`Go`) and shows the visible range
  (`239,951–240,000 of 250,000`), which is the only usable navigation on a multi-million-row file.- **Parquet bytes are fetched by range when the host allows it.** Before loading, the
  viewer probes the resource with a 2-byte `Range` request. If the host answers `206`,
  hyparquet is backed by a lazy buffer and only the footer plus the needed pages are
  downloaded (LRU-cached, 64 MB cap). If the host ignores `Range`, the probe response is
  reused as the full buffer, i.e. exactly the old behaviour. Whether `vscode-webview://`
  honours `Range` depends on the VS Code version and host, so the viewer detects it
  instead of assuming — the console logs `[parquet] source: ranged|full`.
- **New JSONL viewer** (`*.jsonl`, `*.ndjson`): a two-pane layout — a directory of
  entries on the left, the full tree (or raw text) of the selected entry on the right.
  One line is one self-describing JSON document, so heterogeneous keys are natural
  instead of being forced into a fake schema; a table would have to invent one.
  The file's bytes and line index stay in the extension host; the webview receives
  parsed summaries and, for the selected entry only, its full value. The directory pane
  can search the whole file: the scan runs in the extension host in cancellable batches,
  streams matches as it finds them (200 per message, hard stop at 10 000), and shows a
  snippet centred on the match with the term highlighted. Read-only.
- **Telemetry removed** (`src/service/telemetryService.ts`, `telemetry.json`,
  `docs/telemetry.md`). Upstream reported anonymous usage to its own Azure Application
  Insights resource; none of that remains.
- **Identity renamed** — publisher, extension name, view types and command IDs — so this
  fork can be installed next to the original instead of replacing it.
- **Parquet viewer is `priority: default`**, so `.parquet` opens in the viewer directly.

## Kept as-is on purpose

Upstream source files keep their original style (4-space indent, single quotes) and are
excluded from this repo's auto-formatting, so `git merge upstream/main` stays cheap. Decisions
behind that choice are recorded in [docs/adr/0001-fork-office-viewer.md](./docs/adr/0001-fork-office-viewer.md).



