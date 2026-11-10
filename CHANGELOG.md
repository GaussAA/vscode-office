# Changelog

All notable changes to the "vscode-office" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Find in file in the parquet viewer now answers with a cell, not a row: the scan records the
  first matching column for every hit, so jumping to a match (or pressing `Enter` to walk them)
  scrolls that column into view as well. In a 60-column file a hit used to land off-screen with
  no marker anywhere.

### Fixed

- A scan that finds nothing now says `0 matches` instead of leaving the bar blank, which was
  indistinguishable from "you never searched".
- The match counter reads `1 match` / `N matches` instead of `1 row` / `N rows`, which collided
  with the row count in the status bar.
- Parquet row styling above the virtual threshold: the body renders `div` cells, but every
  row-level rule named `tr > td`, so alternating stripes, the 6px cell padding, the removal of
  row separators and the match/target-row tints were all silently dead on real files (rows
  measured 39px instead of the designed 34px). `verify:ui` now asserts the row height, the
  absent border, and that the alternate, match and target rows carry a different background.
- Find in file: `Enter` walks to the next hit the way VS Code's own find does, `Shift+Enter`
  to the previous one, and `Ctrl/Cmd+Enter` — or the button, whose icon no longer reads as
  "next" — re-runs the whole-file scan.

## [6.3.0] - 2026-11-10

### Added

- Legacy workbooks (`.xls`, `.ods`) now open in the same read-only windowed view as
  `.xlsx`/`.xlsm`: above 8 MB every workbook format is rendered as row text with a sheet
  picker and whole-file find, instead of a cell object per value.
- Parquet URL cells: a complete `http(s)` value is clickable and opens through the extension
  host after re-validation; unsafe schemes and URLs with credentials never reach the OS.
- Parquet schema field jump: clicking a field scrolls the table horizontally to its column and
  leaves a subtle column tint, without changing the selected row.

### Changed

- JSON arrays/objects in parquet cells — including Polars-style list fields stored as JSON
  strings — are token-coloured instead of rendered as one flat string.
- Parquet table rows are virtualised: only the viewport's rows are in the DOM, so a wide
  60-column page turn is roughly twice as fast (210 ms → 111 ms in the perf fixture).

### Fixed

- Tracked text files are checked out with LF on every platform (`.gitattributes` `eol=lf`), so
  `oxfmt --check` no longer reports false positives after a `git checkout` on Windows.

## [6.2.0] - 2026-11-09

### Added

- Configuration center for unified constant management (`src/config/constants.ts`).
- Event listener cleanup infrastructure, so webview views release their handlers on dispose.
- Standard project documentation (`.nvmrc`, `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md`)
  and a memory-leak fix guide.
- Test fixtures for the viewers (26 files).

### Fixed

- **[SECURITY]** The `xlsx` package is installed from npm 0.18.5 instead of a CDN tarball.
- **[CRITICAL]** Event listeners leaked on view teardown (cleanup coverage 3% → 85%) in the Git
  history, Excel, Parquet and JSONL views; the webview message handler gained `off()` and
  `removeAllListeners()`.

## [6.1.0] - 2026-11-09

### Added

- Large spreadsheets open in a read-only windowed view: CSV/TSV are read through a byte index and
  workbooks as row text, so a 21 MB file paints in ~0.5 s with ~33 MB of heap instead of seconds
  and hundreds of megabytes. The window supports whole-file find, "go to row" and a sheet
  picker; editing stays in the text editor. See ADR-0017.
- Spreadsheet size guard: files above 25 MB (virtual CSV/TSV) or 15 MB (workbooks) ask before
  loading, with an explicit "open anyway". See ADR-0016.
- Parquet virtual documents above 50 MB are refused before inlining, with an explicit
  "open anyway".
- Performance gate in CI (`pnpm verify:perf`) for first-paint bytes, search time and the
  windowed first paint.
- The parquet view shell was rebuilt around surfaces (toolbar, find bar, row jump, inspector)
  instead of free-floating rules.

### Changed

- Parquet first paint downloads 1.04x the file instead of 2.04x: in-flight range requests are
  deduplicated and overlapping ranges share a byte-bounded cache.
- Whole-file parquet search is a single pass (1M rows: 28 s → 2.8 s; 200k x 60 columns:
  40 s → 2.6 s).
- Parquet prefetch runs when the view is idle, so a wide page turn dropped from 1.2–1.9 s to
  ~0.2–0.5 s.
- Virtual documents cross the webview bridge as base64 (4/3 the bytes) instead of an inline
  number array (5–8x), in both the open and save directions.
- Local CSV/TSV files may be windowed up to 200 MB; virtual documents keep the 25 MB bridge
  guard.
- The JSONL detail bar moved into the bottom status bar.

### Fixed

- Empty, binary and light-theme edge cases in the parquet and JSONL views.

## [6.0.0] - 2024-XX-XX

### Breaking Changes

- Removed HTML preview panel
- Removed archive viewer
- Removed pdf.js integration

### Added

- Modern React-based UI
- Improved Excel viewer with better performance
- Parquet file support
- JSONL viewer

---

## How to Update This File

### For Maintainers

When preparing a release:

1. Move items from `[Unreleased]` to a new version section
2. Update the version number and date
3. Sort changes by type (Added, Changed, Deprecated, Removed, Fixed, Security)
4. Use clear, user-facing language
5. Link to issues/PRs when relevant

### For Contributors

When creating a PR:

1. Add your changes under `[Unreleased]`
2. Use the correct category (Added/Changed/Fixed/etc.)
3. Write from the user's perspective
4. Be concise but informative

### Categories

- **Added** - New features
- **Changed** - Changes in existing functionality
- **Deprecated** - Soon-to-be removed features
- **Removed** - Removed features
- **Fixed** - Bug fixes
- **Security** - Security-related changes (use `**[SECURITY]**` prefix)

### Example Entry

```markdown
### Added

- Excel auto-fit columns feature (Ctrl+Alt+0) (#123)
- Support for .ods files via SheetJS

### Fixed

- **[SECURITY]** Fixed XSS vulnerability in CSV parser (#456)
- Memory leak in Git history viewer when switching branches
```
