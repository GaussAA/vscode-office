# NOTICE

This project is a fork of [Office Viewer](https://github.com/cweijan/vscode-office) by
Weijan Chen (@cweijan), licensed under the MIT License. The original copyright notice is
preserved in [LICENSE](./LICENSE).

Fork identity: `GaussAA.office-viewer-plus` (display name "Data File Viewer (Parquet, JSONL, Excel)", formerly "Office Viewer Plus", which the Marketplace rejected as taken).

## What this fork changed

- **Narrowed to three viewers (6.0.0).** Only spreadsheets (`.xls`, `.xlsx`, `.xlsm`, `.csv`,
  `.tsv`, `.ods`), parquet and JSONL remain. Word, PowerPoint, PDF, ePub, fonts, images, PSD,
  ICNS, XMind, HTML, Java `.class` and archives were removed: VS Code covers some of them and a
  dedicated reader covers the rest. See [ADR-0015](docs/adr/0015-narrow-to-three-viewers.md).
- **Parquet: compressed columns actually decode.** Upstream bundles `hyparquet` without
  `hyparquet-compressors`, so only SNAPPY works and ZSTD files fail with
  `parquet unsupported compression codec: ZSTD`. This fork passes `compressors` from
  `hyparquet-compressors`, covering SNAPPY, GZIP, BROTLI, ZSTD, LZ4 and LZ4_RAW.
- **Parquet cells are rendered by type.** Numbers are right-aligned with tabular figures and
  coloured, strings/booleans/timestamps get their own colours from the VS Code chart palette,
  nulls show an explicit italic `NULL`, and clicking a cell opens the full value (copyable)
  below the table. The next page is prefetched and the last six pages are cached, so paging
  forward needs no extra reads. The viewer is read-only — the writer was removed in 6.0.0.
- **Parquet has whole-file search.** The box in the toolbar scans the file in 5 000-row
  batches (cancelled by a newer query), shows progress, marks matching rows, highlights the
  matching text inside cells, and jumps to the first match. It reads every row group it
  visits, so on a very large file the scan is I/O bound — that is the stated trade-off:
  display stays lazy, an explicit search is allowed to be expensive.
- **Parquet rows are read one page at a time.** Upstream reads every row into memory and
  slices 50 per page; this fork reads only the visible page with `rowStart`/`rowEnd`, so a
  huge file no longer materialises its whole table.
- **Every parquet page is reachable by row number.** The footer takes a row number (`Go`) and
  shows the visible range (`239,951–240,000 of 250,000`), which is the only usable navigation
  on a multi-million-row file.
- **Parquet bytes are fetched by range when the host allows it.** Before loading, the
  viewer probes the resource with a 2-byte `Range` request. If the host answers `206`,
  hyparquet is backed by a lazy buffer and only the footer plus the needed pages are
  downloaded (LRU-cached, 64 MB cap). If the host ignores `Range`, the probe response is
  reused as the full buffer, i.e. exactly the old behaviour. Whether `vscode-webview://`
  honours `Range` depends on the VS Code version and host, so the viewer detects it
  instead of assuming — the console logs `[parquet] source: ranged|full`.
- **JSONL viewer** (`*.jsonl`, `*.ndjson`): a two-pane layout — a directory of entries on the
  left, the full tree (or raw text) of the selected entry on the right. One line is one
  self-describing JSON document, so heterogeneous keys are natural instead of being forced
  into a fake schema; a table would have to invent one. The extension host keeps the line
  index and reads one byte window per request, so opening a 500 MB log costs a few megabytes
  rather than its own size; the webview receives parsed summaries and, for the selected entry
  only, its full value. The directory pane can search the whole file: the scan runs in the
  extension host in cancellable batches, streams matches as it finds them (200 per message,
  hard stop at 10 000), and shows a snippet centred on the match with the term highlighted.
  Read-only.
- **Telemetry removed** (`src/service/telemetryService.ts`, `telemetry.json`,
  `docs/telemetry.md`). Upstream reported anonymous usage to its own Azure Application
  Insights resource; none of that remains.
- **Identity renamed** — publisher, extension name, view types and command IDs — so this
  fork can be installed next to the original instead of replacing it.
- **Parquet viewer is `priority: default`**, so `.parquet` opens in the viewer directly.

## Third-party code in this repository

Not all of it is installed from npm, and the two kinds are different things (see
[docs/adr/0009](docs/adr/0009-vendored-copy-vs-fork.md)):

- **Copy** — a project we host almost unchanged. Its delta against upstream is far smaller
  than upstream itself. We owe attribution and nothing else.
- **Fork** — a project we have written a lot of our own code into, so that it now evolves
  independently. Upstream may have moved on; we owe attribution _and_ maintenance.

Licenses require attribution, which this section provides. Copyright remains with the
original authors.

### Copies

| Path                                            | Project                                                                                     | License | Upstream                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------- |
| `icons/` (8 SVGs) + `theme/material-icons.json` | Derived from `vscode-material-icon-theme`, reduced to the file formats this extension opens | MIT     | https://github.com/PKief/vscode-material-icon-theme |

### Forks

| Path                                  | Project                                                                                                                 | License | Upstream                                 | Our delta                                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/react/view/excel/x-spreadsheet/` | `x-data-spreadsheet` — the spreadsheet engine behind the `.xlsx/.csv/.ods` viewer (patch applied upstream in `48b10e4`) | MIT     | https://github.com/myliang/x-spreadsheet | ~+3.2k/−1k lines over 45 files: toolbar icons, hyperlink/formula bar/sheet images, clipboard, find |

## Working with upstream

This fork evolves independently. `upstream` is a read-only reference: when we need a fix from
it, we read the diff and reimplement it rather than merging its history. Upstream files may be
rewritten; the discipline that replaces "keep it mergeable" is "one change per commit, and each
commit can be reverted on its own". See
[docs/adr/0002-independent-evolution.md](./docs/adr/0002-independent-evolution.md).
