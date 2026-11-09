# Office Viewer Plus

English | [简体中文](README-CN.md) | [繁體中文](README-TW.md)

## Introduction

This extension previews **three things** in VS Code:

| Format                                                         | What you get                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Spreadsheets: `.xls`, `.xlsx`, `.xlsm`, `.csv`, `.tsv`, `.ods` | A grid you can edit and save back, plus find/replace                         |
| Parquet: `.parquet`                                            | ZSTD/GZIP/BROTLI/LZ4 columns, lazy paging, whole-file search, read-only      |
| JSONL / NDJSON: `.jsonl`, `.ndjson`                            | A directory of entries on the left, the selected entry as a tree or raw text |

That is the whole list. Everything else this fork inherited — Word, PowerPoint, PDF, ePub,
fonts, images, PSD, ICNS, XMind, HTML, Java `.class`, archives — was removed in **6.0.0**:
VS Code already covers some of them, and the rest have better dedicated readers. The rationale
is in [ADR-0015](docs/adr/0015-narrow-to-three-viewers.md); the upgrade notes are in
[CHANGELOG.md](CHANGELOG.md).

## This fork

This repository is a fork of [cweijan/vscode-office](https://github.com/cweijan/vscode-office)
(MIT, see [NOTICE.md](NOTICE.md)). It builds as `GaussAA.office-viewer-plus` and installs
alongside the original. The fork is maintained for one person's data work, which is why it only
keeps the formats that work involves.

### Parquet: the files upstream cannot open

Upstream bundles `hyparquet` without its decompressors, so a ZSTD-compressed file fails with
`parquet unsupported compression codec: ZSTD`. This fork passes `compressors` from
`hyparquet-compressors`, so SNAPPY, GZIP, BROTLI, ZSTD and LZ4 all decode.

![ZSTD-compressed parquet](docs/screenshots/parquet-zstd.png)

Reading is lazy and stays usable on big files:

- **One page at a time.** Only the visible 50 rows are decoded, so a 377 MB file no longer
  materialises its whole table.
- **Range requests when the host supports them.** A 2-byte probe decides between ranged
  reads (footer plus the pages you look at) and a single full fetch; the console logs
  `[parquet] source: ranged|full`.
- **Navigation for millions of rows.** Jump to any row number; the footer shows the visible
  range (`239,951–240,000 of 250,000`).
- **Type-aware cells.** Numbers are right-aligned with tabular figures, strings, booleans and
  timestamps are coloured from the theme, nulls render as `NULL`, and clicking a cell opens
  its full value.

![Parquet types](docs/screenshots/parquet-types.png)

**Find in file** scans in 5,000-row batches with progress, marks matching rows, highlights
the matching text inside cells, and jumps to the first hit.

The viewer follows the VS Code theme — including the antd widgets, which used to stay light
under a dark view. There is no separate light/dark switch.

![Parquet in a light theme](docs/screenshots/parquet-light.png)

### JSONL / NDJSON: a directory, not a grid

One JSON value per line is not a table, so the fork ships a two-pane viewer: the left pane
lists entries, the right pane renders the selected entry as a tree (or as raw text).

![JSONL two-pane viewer](docs/screenshots/jsonl-two-pane.png)

- **Bytes stay in the extension host.** The webview receives summaries for the visible
  entries and one full value for the selected entry — never the file.
- **Search across the whole file**, streamed in batches with a snippet around the match and
  the term highlighted.
- **Long values wrap** instead of being clipped, and entries above 500 nodes fall back to a
  fixed-height virtual list so a pathological line cannot freeze the UI.
- Keyboard: `←`/`→` collapse/expand, `Space` toggles, `Enter` copies the value,
  `Ctrl+Shift+C` copies the path.

### Verification

```bash
pnpm test        # unit tests for the parsing logic (node:test, no extra framework)
pnpm verify:ui   # headless DOM scenarios; screenshots land in .ui-verify/shots
```

CI runs both on every push, together with `pnpm build` and `pnpm run package`. Add
`-- --docs` to `verify:ui` to refresh the screenshots above.

### Known limits

- Whole-file parquet search on a very large file is I/O bound because it reads every row
  group it visits.
- Parquet is read-only; there is no writer.
- JSONL search matches raw text, not JSON paths.
- Upstream telemetry has been removed entirely.

## Git History

The extension still ships the Git History workspace (it is a commit browser, not a file
preview, so the 6.0.0 narrowing did not touch it). Open it from the Source Control view, the
editor title bar, the editor context menu, or the file explorer context menu.

![Git history](image/README/1783342874748.png)

## Other features

- YAML: document outline and anchor navigation (Go to Definition for alias references)
- XML: document formatting
- Icon theme: 8 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) icons for spreadsheets, parquet and JSONL

## Development

```bash
pnpm install
pnpm build        # production build into out/
pnpm run package  # create the .vsix (build first)
pnpm check        # format + lint + baseline + typecheck + unit tests
pnpm check:full   # check + build + smoke + verify:ui
```

Press `F5` in VS Code and choose **Extension** to run the local build.

## Credits

- Spreadsheet parsing: [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs)
- Spreadsheet rendering: [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet)
- Parquet: [hyparquet](https://github.com/hyparam/hyparquet) and
  [hyparquet-compressors](https://github.com/hyparam/hyparquet-compressors)
- Material Icon theme: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)

## Sponsor

[![Database Client](https://doc.database-client.com/public/logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

Database Client for Visual Studio Code, supporting **MySQL/MariaDB, PostgreSQL, SQLite, Redis**
and **ElasticSearch**, and working as an **SSH** client.
[Get it now](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2).
