# Changelog

All notable changes to the "vscode-office" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The parquet "this file is too large" panel offers a second way out: `Reveal in Explorer`.
  Opening an 80 MB file anyway is a bet on memory; the file is on disk regardless, and looking at
  it where it lives costs nothing.- Parquet column widths can be dragged from the header edge, reset with a double-click, and
  adjusted with the arrow keys on the handle. Widths are remembered per column name, so a JSON
  column that needed 300 px stays wide the next time the file is opened. The row-number column
  keeps its width.- An empty parquet file says "No rows" once, in the body; the footer no longer repeats it, and the
  pager hides its position label when there are no rows to be positioned in.
- The row-number column is right-aligned like every other number on the surface.
- `DESIGN.md` now matches the implementation: the thin-mix rule is stated in terms of final
  opacity (a mix source with its own alpha is not the same as a plain percentage), and the colour
  inventory lists the light-theme muted override and the two JSON token colours.- Copying a parquet value now answers: the copy button turns into a check for a moment and its
  label says `Copied`. `Ctrl+C` on the grid copies the selected value, which previously only
  selected the page text.
- The top bar shows the file's size. `PRODUCT.md` lists "how big is this file" as one of the four
  questions the viewer is opened to answer, and it was the only one never displayed. The pager
  also shows `Page n / N` beside the row range.
- The schema field filter has a clear button, so restoring the full list no longer means
  selecting the text and deleting it.- The parquet schema sidebar can be filtered, and the field list is a single tab stop navigated
  with the arrow keys. With 60 columns, reaching the grid used to take 60 presses of Tab, and
  finding a field meant scanning a list of truncated names. Type badges wrap to two lines so
  `TIMESTAMP_MILLIS` and `TIMESTAMP_MICROS` no longer render identically.- The parquet command bar now names the file's compression codec. Decoding ZSTD/GZIP/BROTLI/LZ4
  is the reason this fork exists, and until now the surface said nothing about it.
- Search says what Enter does: a hint appears as soon as you type, the readout is
  `4 of 12 · stops at 5,000` instead of a bare total, and a running scan can be stopped from
  the same button that started it.
- `PageDown`/`PageUp` step by the rows the viewport shows instead of by the 50-row page, which
  used to skip a third of the rows unseen. The pager also gained first/last buttons.- Find in file in the parquet viewer now answers with a cell, not a row: the scan records the
  first matching column for every hit, so jumping to a match (or pressing `Enter` to walk them)
  scrolls that column into view as well. In a 60-column file a hit used to land off-screen with
  no marker anywhere.

### Changed

- The parquet table now exposes grid semantics: `role="grid"` with the **file's** row and column
  counts (not the rendered window), `row` / `gridcell` / `rowheader` / `columnheader` roles,
  absolute `aria-rowindex` that stays continuous across pages, and `aria-colindex` on both the
  header and the cells — the header is a separate scroll surface, so a cell can only be mapped
  to its column when both sides carry the ordinal. The header's own `<table>` shell became
  `role="presentation"`, since a table is not a valid child of a grid.
- The parquet error state now names the file, explains the failure in a sentence and keeps two
  ways out — `Retry` and `Edit In VS Code`. The library's own message
  (`parquet file invalid (footer != PAR1)`) moved into a collapsed "Technical detail": someone
  who opened a broken file previously got one line of parser output and a retry button, with no
  indication of which file it was.

### Fixed

- Columns in a narrow parquet file no longer stretch to fill the window. Spare width grows them
  up to 240 px and the rest is left empty, so a four-column file is four readable columns instead
  of five broad panels — and a dragged width now lands where it was dropped.- Leaving the parquet row-jump field no longer navigates. The jump fires on `Enter` (or the Go
  button) only, so looking at the table mid-edit no longer moves the page out from under you.
- The parquet error pane can copy its own message, and `Retry` is offered only where retrying
  could change the answer: an unsupported compression codec is a property of the file, so the
  codec branch shows the way out and the details instead of a button that loops.- Row numbers now belong to the page whose rows are actually on screen. `page` changed on the
  click while the rows arrived up to 1.7 s later, so the `#` column, `aria-rowindex` and the
  inspector briefly described the wrong rows — the bottom bar could read "row 1" beside a value
  from row 251, and screen readers announced it.- The keyboard cursor and the bottom bar now agree: every path that restores a cursor (the first
  arrow of a cold start, a page turn, `PageDown`) also fills the inspector, which used to say
  "Select a cell to inspect it" while a cell was clearly focused.
- A matched row is visible again. The tint was mixed from a colour that already had 33% alpha,
  so it landed at roughly 6% effective opacity; it now uses the opaque find-match colour.- The parquet bottom bar keeps its selection together: the copy and close buttons sit next to
  the value instead of being pushed to the far end against the pager, and a container value is
  previewed with the same 320-character cap the cells use (copy still takes the whole value).
- Clicking a link cell now also selects it, so the URL lands in the inspector where it can be
  copied; the click still opens the link.- Parquet search results now belong to the text in the box: editing the needle clears the
  previous counts, marks and column hits, and `Enter` searches the new text instead of jumping
  to a hit of the old one.
- The parquet grid is keyboard-navigable across the whole file: `PageDown`/`PageUp` turn a page,
  the arrow keys walk off a page edge into the next one, and `Ctrl/Cmd+Home`/`End` jump to the
  first and last row. The column is kept across a page turn. The first arrow of a cold start now
  lands on the first cell instead of the second row.- The parquet schema field jump now measures the live column instead of assuming a fixed
  120 px width — columns are stretched to fill the viewport when a file has few of them — drags
  the horizontal scrollbar instead of clicking it, and keeps the header in step with the body.
  The header is a separate scroll surface, so a jump used to leave the column labels one or two
  columns away from the values underneath them.
- The parquet error state's primary action is `Reveal in Explorer` rather than opening the file
  as a binary in the editor, which for a broken file leads straight to a VS Code warning page.
  `Retry` stays, as the secondary action.
- The parquet bottom bar is no longer an `aria-live` region. It updates on every arrow key, so a
  screen reader queued one announcement per keystroke; a visually hidden status region now
  announces the selection once it has settled for 600 ms.
- Link cells advertise the key that opens them (`aria-keyshortcuts="Enter"`) while the anchor
  stays out of the tab order — the grid keeps a single tab stop by design, so Enter on the cell
  is the keyboard path and now it says so.
- Clicking a schema field could silently fail to scroll the table: the jump dispatched one
  synthetic scrollbar event and assumed it worked, but the virtual table ignores a dispatch that
  lands on the thumb while its track is still unmeasured. The scroll is now verified against the
  target column being in view and retried for a few frames.
- The parquet error state is a live region (`role="alert"`). That state replaces the entire
  chrome with one message, so a screen-reader user previously received no announcement at all.
- The label layer — 10px table headers, 9.5px type badges, the `SCHEMA` section title — gets a
  darker muted foreground under a light theme, because the theme's `descriptionForeground` is
  tuned for 13px body text and measured 3.5–4.0:1 at these sizes. The UI contrast gate now
  covers those three selectors as well, so the declared values cannot drift back down.
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
