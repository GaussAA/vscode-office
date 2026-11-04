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
- **New JSONL viewer** (`*.jsonl`, `*.ndjson`): a tree surface, not a table. One line is
  one self-describing JSON document, so heterogeneous keys are natural instead of being
  forced into a fake schema. The file's bytes and line index stay in the extension host;
  the webview receives parsed lines only. Read-only in this version.
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
