# NOTICE

This project is a fork of [Office Viewer](https://github.com/cweijan/vscode-office) by
Weijan Chen (@cweijan), licensed under the MIT License. The original copyright notice is
preserved in [LICENSE](./LICENSE).

Fork identity: `GaussAA.office-viewer-plus` (display name "Office Viewer Plus").

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
  The extension host keeps the line index and reads one byte window per request, so
  opening a 500 MB log costs a few megabytes rather than its own size; the webview
  receives parsed summaries and, for the selected entry only, its full value. The
  directory pane can search the whole file: the scan runs in the extension host in
  cancellable batches, streams matches as it finds them (200 per message, hard stop at
  10 000), and shows a snippet centred on the match with the term highlighted. Read-only.
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

| Path                                             | Project                                                                                          | License    | Upstream                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------- | --------------------------------------------------- |
| `resource/pdf/`                                  | `pdf.js` 3.1.81 — a prebuilt `pdfjs-dist` web viewer plus `cmaps/` and `standard_fonts/`         | Apache-2.0 | https://github.com/mozilla/pdf.js                   |
| `icons/` (26 SVGs) + `theme/material-icons.json` | Derived from `vscode-material-icon-theme`, reduced to the file formats this extension opens      | MIT        | https://github.com/PKief/vscode-material-icon-theme |
| `public/woff2_decompress_binding.js`             | `woff2` compiled to JavaScript with Emscripten; decodes fonts for the font viewer                | MIT        | https://github.com/google/woff2                     |
| `resource/java-decompiler.jar`                   | `java-decompiler` — the IntelliJ Platform's Java decompiler, run headless by the `.class` viewer | Apache-2.0 | https://github.com/JetBrains/intellij-community     |

(`pretty-bytes` used to be copied in; it is now the npm dependency it always was.)

### Forks

| Path                                  | Project                                                                                                                                                                                                                     | License | Upstream                                 | Our delta                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `vditor/`                             | `Vditor` — the Markdown editor the webview runs. Its own pnpm workspace package with its own build (`vite/vditorPlugin.ts`). Forked once by upstream Office Viewer (`vscode-ext-studio/vditor`), then heavily modified here | MIT     | https://github.com/Vanessa219/vditor     | ~+12k lines: CodeMirror 6 code blocks, wikilinks, editor theming, find bar, VS Code glue           |
| `src/react/view/excel/x-spreadsheet/` | `x-data-spreadsheet` — the spreadsheet engine behind the `.xlsx/.csv/.ods` viewer (patch applied upstream in `48b10e4`)                                                                                                     | MIT     | https://github.com/myliang/x-spreadsheet | ~+3.2k/−1k lines over 45 files: toolbar icons, hyperlink/formula bar/sheet images, clipboard, find |

`vditor/src/js/` also carries prebuilt third-party runtimes that Vditor ships and loads at
runtime rather than importing: **Lute** (the Go markdown engine, `lute.min.js` 3.5 MB),
**Mermaid** (`mermaid.min.js` 3.3 MB), **KaTeX** (JS + fonts) and `plantuml-encoder`. They are
inside the fork because Vditor's `cdn` loading model expects files next to the bundle; they are
not built from this repository.

## Working with upstream

This fork evolves independently. `upstream` is a read-only reference: when we need a fix from
it, we read the diff and reimplement it rather than merging its history. Upstream files may be
rewritten; the discipline that replaces "keep it mergeable" is "one change per commit, and each
commit can be reverted on its own". See
[docs/adr/0002-independent-evolution.md](./docs/adr/0002-independent-evolution.md).
