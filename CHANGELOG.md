# Changelog

All notable changes to the "vscode-office" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [6.4.1] - 2026-11-10

### Fixed

- Paging a large parquet file no longer re-reads a whole data page per turn. Decoding costs the
  same for 50 rows as for 20,000 (measured on a 202 MB / 1.1 M row / 49 column file: 22.6 MB and
  ~1.4 s either way), so the session now reads in 5,000-row chunks and a page is a slice of one.
  On that file a page turn went from 1.2–1.5 s to 0 ms, and the turn that crosses a chunk
  boundary is prefetched in idle time. `verify:perf` also gained a scroll-frame check: scrolling
  the 60-column fixture holds p95 16.8 ms (~60 fps).

### Changed

- A parquet page is one screenful. The viewer measures the body and pages by the rows that fit
  (8–200), so the pager's range describes what is on screen, `PageDown` moves exactly one page, and
  `1–50 of 300` no longer claims 50 rows in a table that shows 21. The position is remembered as a
  **row** instead of a page number, because a page number means a different row at a different
  window height.
- The ten parquet icon colours read six `--vscode-charts-*` variables between them, each duplicated
  two or three times. There is now one `--pv-chart-*` token per colour and the icons are aliases of
  it; `verify:ui` asserts the aliases resolve to the same value.

### Removed

- `viewerTheme.css` is gone. It declared a fourteen-variable `--viewer-*` token layer that looked
  like the shared theme for every viewer, but nothing imported it: it never reached the build, no
  component read a single one of its variables, and its `--viewer-accent` called the link colour
  "accent" while parquet's `--pv-accent` means the button colour.
- `src/vscode.css` is gone too: 503 lines spelling the host variables for standalone browsing,
  imported by nothing. Every `var(--vscode-…)` in the tree already carries its own fallback (289 of
  them), so the file never mattered to rendering.
- `test/unit/stylesheets.test.ts` fails on any stylesheet under `src` that nothing imports. It is
  what found both orphans; the first version stopped at `src/react` and would have kept the second
  one alive.

## [6.4.0] - 2026-11-10

Four rounds of design critique on the parquet viewer, plus the column work that came out of it.

### Added

- The parquet top bar names the file's compression codec and its size. Decoding ZSTD/GZIP/BROTLI/
  LZ4 is the reason this fork exists, and "how big is this file" is one of the four questions
  `PRODUCT.md` says the viewer is opened to answer — neither was on screen before.
- Parquet column widths can be dragged from the header edge, reset with a double-click, and
  adjusted with the arrow keys on the handle. Widths are remembered per column name, so a JSON
  column that needed 300 px stays wide the next time the file is opened.
- Spare width grows the columns up to 240 px and stops there, leaving the rest empty instead of
  stretching a four-column file into four broad panels.
- The schema sidebar can be filtered, and its field list is a single tab stop navigated with the
  arrow keys. Reaching the grid used to take one Tab press per column.
- The bottom bar shows `Page n / N` beside the row range, and the pager has first/last buttons.
- Search says what `Enter` does: a hint appears as soon as you type, the readout is
  `4 of 12 · stops at 5,000` instead of a bare total, and a running scan can be stopped from the
  button that started it.
- Copying a value answers: the button turns into a check and says `Copied`. `Ctrl+C` on the grid
  copies the selected value.
- The "this file is too large" panel offers a second way out — `Reveal in Explorer` — because
  opening it anyway is a bet on memory the file itself does not require.
- Clicking a link cell also selects it, so the URL lands in the inspector where it can be copied.

### Changed

- `PageDown`/`PageUp` step by the rows the viewport shows instead of by the 50-row page, which
  used to skip a third of the data unseen.
- Leaving the row-jump field no longer navigates; only `Enter` or the Go button acts on it.
- A matched row is visible again. Its tint was mixed from a colour that already carried 33 % alpha,
  so it landed at roughly 6 % effective opacity.
- The `#` column is right-aligned like every other number, and an empty file says "No rows" once
  instead of three times.

### Fixed

- Row numbers belong to the page whose rows are actually on screen. `page` changed on the click
  while the rows arrived up to 1.7 s later, so the `#` column, `aria-rowindex` and the inspector
  briefly described the wrong rows — the bottom bar could read "row 1" beside a value from row
  251, and screen readers announced it.
- The schema field jump measures the live column instead of assuming a fixed 120 px width (columns
  are stretched when a file has few of them), and keeps the header in step with the body. The
  header is a separate scroll surface, so a jump used to leave the column labels one or two
  columns away from the values underneath them.
- Editing the search needle invalidates the previous results, so `Enter` no longer jumps to a hit
  of the old query.
- The keyboard cursor and the inspector agree: every path that restores a cursor also fills the
  bottom bar, which used to say "Select a cell to inspect it" while a cell was focused.
- The error pane can copy its own message, and `Retry` is offered only where retrying could change
  the answer — an unsupported codec is a property of the file, not a transient failure.
- The parquet table exposes grid semantics: `role="grid"` with the file's row and column counts,
  `aria-rowindex`/`aria-colindex` on both header and cells, and a keyboard model that reaches the
  whole file (`PageDown`/`PageUp`, page-edge arrows, `Ctrl+Home`/`End`).
- The parquet error state names the file, explains the failure in a sentence and keeps the raw
  message behind a disclosure.
- The bottom bar is no longer an `aria-live` region; it updates on every arrow key, so it queued
  one announcement per keystroke. A settled selection is announced through a separate status
  region.
- Link cells advertise the key that opens them (`aria-keyshortcuts="Enter"`) while the anchor stays
  out of the tab order.
- Row styling reaches the virtual body: it renders `div` cells, so every `tr > td` rule was
  silently dead above the virtual threshold — stripes, cell padding and the match tint all
  vanished without a failing test.
- A scan that finds nothing says `0 matches`; the counter reads `1 match` / `N matches` instead of
  `1 row` / `N rows`, which collided with the table's own vocabulary.
- `Find in file`: `Enter` walks to the next hit the way VS Code's own find does, `Shift+Enter`
  walks back, and `Ctrl+Enter` re-runs the scan.

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

## [6.0.1] - 2026-11-09

### Fixed

- **All three viewers no longer open blank.** 6.0.0 inlined the webview config JSON into a
  double-quoted data-config attribute without escaping it, so the browser ended the attribute at
  the first JSON quote and the React root never mounted. The config is HTML-escaped before it
  enters the attribute.

## [6.0.0] - 2026-11-09

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
