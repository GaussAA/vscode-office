# Changelog

All notable changes to the "vscode-office" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [6.11.0] - 2026-11-13

### Added

- Parquet: turning a page and running a search are now **spoken** as well as drawn. A screen
  reader hears `22–42 of 300` after a page turn and `3 matches` when a search finishes, through
  one polite live region. Results are announced, not progress: the scan updates a visible
  progress bar without queueing a message per batch.

### Changed

- Excel: its animations now follow `prefers-reduced-motion` like the other two viewers do. The
  last eleven hard-coded durations are gone, and a unit test fails the build if one comes back —
  a literal duration is one the preference cannot zero.

## [6.10.0] - 2026-11-13

### Changed

- Parquet: the viewer's chrome and its docked panels now sit on three named surface levels
  (`canvas` / `surface` / `raised`) instead of a mix of ad-hoc tokens, so the command bar, the
  schema sidebar, the header, the bottom bar and the panels that cover the table read as one
  hierarchy in both themes. The docked panels lost their 1px top divider and their shadow — both
  were against `DESIGN.md`, and the raised tint is what separates them now.
- Parquet: motion is state feedback only — 120–180 ms, one easing, all of it behind
  `prefers-reduced-motion` (which zeroes the durations rather than removing them, so every
  element still lands in its final state). antd's own widget animations follow the same
  preference. Before this, 32 of 34 transitions in the webview ignored it.

### Fixed

- Parquet: clicking a field in the schema sidebar now reliably scrolls its column into view.
  The jump retried only while a synthetic scrollbar drag was in flight, so a drag that did
  nothing (the virtual table rebuilds its scrollbar when the active column changes) ended the
  retry chain and left the viewport where it was. Reproduced on a Linux CI runner, fixed, and
  verified with 20 consecutive runs in the environment that failed.

## [6.9.0] - 2026-11-12

### Added

- Parquet: the schema sidebar reports each column's null share, read from row-group statistics —
  footer metadata, never a column decode. A file whose writer omitted statistics says so instead
  of showing `0%`; an answer that covers only some row groups is labelled partial; nested columns
  are not profiled, because leaf statistics do not describe a row. The field row's accessible
  name carries the same sentence, so the percentage is never a bare number.
- Parquet: a column's top values and counts are one click away (or `i` on the focused field). The
  panel docks above the bottom bar without re-paging the table, and it states the coverage it
  actually got (`Scanned 200,000 of 1,000,000 rows · 500 distinct values`) instead of implying a
  total. The scan decodes only that column; a column whose writer omitted statistics is not
  scanned until you ask, because a scan is the half that costs something.
- Parquet: two files can be compared from the command palette. The panel shows each column's null
  share and range on both sides, grouped into added, removed, type changed, changed, cannot
  compare and same. It reads only each file's footer — no column is decoded — so a pair of 377 MB
  files opens instantly. A row-count difference is reported as a finding rather than an error,
  and a side written without statistics says so instead of counting as unchanged.

## [6.8.0] - 2026-11-12

### Added

- Parquet values can be read in full. Clicking the value in the bottom bar opens a panel anchored
  above the bar: it wraps, scrolls after a few lines, switches between formatted and raw (indented
  versus compact JSON for a LIST/STRUCT, literal versus escaped for a string), reports the row,
  character count and UTF-8 byte count, and copies the untruncated value. The panel overlays the
  grid instead of shrinking it, so opening it does not re-page the table. Rendering is capped at
  20 000 characters; copy is not.
- JSONL search marks each hit as `key`, `value` or `key+value`. The substring scan reports a row
  for both cases identically, so "is `status` a field here, or does some value contain the word"
  had no answer short of opening the entry. The matched line is parsed anyway to derive its label,
  so the distinction costs nothing extra; a hit that lives only in JSON punctuation carries no
  badge rather than a guessed one. `key`/`value` are structure, like `LIST`, and stay untranslated.

### Changed

- Excel: the windowed preview now freezes the file's first row as a column header, fills the
  viewport width, and adds a selectable cell value bar, grid semantics with keyboard navigation
  and copy, a live match count and a compact instrument-scale toolbar. The large-file guard
  makes **Open in VS Code** the safe primary action, requires a second confirmation for
  **Open anyway** and names the full-grid / ≈9× memory cost. The floating theme toggle is hidden
  in the windowed and guard views, and Ctrl+F now focuses the inline Find.
- Excel: the editable read-only banner is now in flow instead of covering the spreadsheet
  toolbar; the documented guard, workbook and find screenshots show the state they name.

### Removed

- The native `title` on parquet cells and on the bottom-bar value. A tooltip cannot be wrapped,
  selected or copied, and DESIGN.md forbids it as the only way to read a value.
- The legacy Git History viewer, its commands, status-bar entry and preferences, and its README
  references. The extension now ships only the three documented surfaces: Excel, Parquet and
  JSONL.

### Fixed

- Excel: windowed files above Chromium's scroll-height limit no longer lose their final rows.
  The scrollbar becomes a proportional seek bar over a capped 30M-px surface while the visible
  block stays mounted; the 1.6M-row UI scenario reaches the last row.
- Excel: CSV/TSV files are decoded once and the detected encoding is reused on save; TSV encoding
  detection now follows the same rules as CSV.
- Excel: the size guard traps focus and returns it to the safe action after the second-step
  confirmation is cancelled, and the windowed grid exposes accurate ARIA row counts.
- JSON/JSONL: search runs in cancellable batches, so a new query or a closed view does not leave
  an unresponsive scan running.

## [6.7.0] - 2026-11-11

### Added

- JSON: a command-opened read-only JSON inspector for `.json` files. It does not register
  `.json`, does not take over the default editor and does not appear in
  `contributes.customEditors`; the three entry points are the command palette
  (`Data File Viewer: Preview JSON`), the Explorer context menu and the JSON editor title.
  A top-level array up to 100 MB is scanned for record boundaries instead of being parsed
  whole; the left rail is virtual and shows `[index]` plus a top-level identity label
  (`deriveLabel`, raw-JSON fallback), and the right pane reuses the JSONL Splitter, tree,
  value panel, keyboard and bottom bar. Object roots up to 20 MB are parsed whole. Whole-file
  search returns matching records with snippets and counts; selecting one loads that record
  and expands/highlights the first matching key, while object-root results are paths. Strict
  JSON only: comments and trailing commas produce a line/column error and an **Open in Text
  Editor** exit; an unsaved editor buffer is the source and is labelled. Single records above
  8 MB are raw text, and search stops at 10,000 matches. The JSONL shell and detail gained
  optional entry labels, highlight marks and reveal-key expansion for this surface.
- JSON: `verify:perf` gains a host-side 100 MB array invariant (index in < 6 s, a 100-record
  window in < 2 s, a whole-file search in < 8 s, and no whole-document parse); measured
  0.49–1.37 s / 1–3 ms / 63–114 ms on a 91.6 MB, 50,000-record fixture. `verify:ui` gains the JSON
  record rail, virtual list, record search, object-root search, buffer label, invalid,
  too-large and empty-array scenarios.

### Fixed

- JSONL: entries above 500 nodes were forced into the fixed-height virtual list, so a long
  `description`, `message` or prompt showed only its 120-character single-line preview and
  the rest was silently clipped. The wrap threshold is now 2,000 nodes: the reported 8.2 MB
  `codex-现网.jsonl` has 520–1,934-node entries whose initial expanded tree is at most 305
  rows, and all of them now wrap. Entries above 2,000 nodes keep the virtual list and the
  value panel, and the 2,000-character per-string wrap cap is unchanged.

## [6.6.0] - 2026-11-11

### Fixed

- The parquet grid now reaches the bottom bar. antd 6 renders its loading wrapper as `.ant-spin`,
  while the stylesheet still named antd 4/5's `.ant-spin-nested-loading`; the mismatched selector
  broke the height chain, so the table stopped at its content height and the bare editor
  background showed below it — 23px short on a full page and 703px short on a six-row page, which
  reads as one extra empty row. `verify:ui` now asserts the geometry on both a full and a short
  page.

### Removed

- The floating "Supported by Database Client" bar. It was `position: fixed`, so in the parquet
  viewer it sat on top of the pager, and it had no off switch. The sponsor components, assets,
  `sponsorBaseUrl` config and the `sponsorClick` / `openSponsor` webview messages went with it;
  the upstream credit moved to README's Credits section and NOTICE.md.

## [6.5.0] - 2026-11-11

### Added

- JSONL: a selection panel docked above the status bar shows the full value of the selected
  tree row. It wraps, scrolls, reports the character count, and copies the whole value;
  `Enter` toggles it and `Ctrl+C` still copies. The tree keeps its 120-character string
  preview for large entries (small ones still wrap leaf strings, as before) and the panel is
  where a long `description`, prompt or log message is actually read. A line that is one long
  string — no tree row to select — gets the panel too.
- JSONL: the directory has an explicit "Load more entries" row. The byte budget can return a
  window shorter than the pane, which has no scrollbar and therefore emitted no scroll event;
  the directory now tops itself up a bounded number of times and keeps a visible row for the
  rest.
- JSONL: a top-level identity key whose value is an object (or a string array) is now read
  one level deep (`id: { query }`, `query_search: ["…"]`), which is how agent transcripts
  store their identity. The 50-line `openclaw.jsonl` sample goes from 0 to 50 labelled
  rows; arbitrary nested `id`s are still deliberately ignored.
- JSONL: `verify:perf` gains two host-side invariants — a 4 MB directory window over 2 MB
  lines returns one row (≤3, measured 15 ms), and a 200k-line search is one pass
  (measured 0.3–0.5 s). They run in Node against the esbuild-bundled `JsonlSession`, because
  the browser harness cannot see the extension host.
- JSONL: a line above the 8 MB parse cap is decoded as a 4 KB head for the directory row
  instead of in full. A 100 MB record no longer allocates a 100 MB string just to show its
  size in the list; opening it still decodes it once for the raw view.

### Fixed

- JSONL: a 512 KB line cap refused realistic records — the 6.4 MB, 50-line transcript in the
  report contains a 541 KB line and the viewer showed only "too large". The parse cap is now
  8 MB; the tree model's existing 20,000-node bound keeps the render finite.
- JSONL: directory windows and search turns are byte-bounded (4 MB / 8 MB) instead of
  line-bounded. A file made of 500 KB records used to `JSON.parse` its whole first chunk
  before the first row appeared; the selected row now anchors the window so recentring never
  drops it.
- JSONL: a node at the 12-level depth cap no longer offers an expand arrow that opens
  nothing; it stays a leaf and says how many keys are below the cap (`… N more keys`).
- JSONL: the virtual tree assumed 24px rows while the CSS produced 28px, so the last seventh
  of every long tree could not be scrolled to. A 600-key entry never rendered its
  "… N more keys" row, and a 500-entry directory chunk hid its last ~70 rows. The row pitch
  is one number again.
- JSONL: raw text past 1,000,000 characters is a marked prefix with a character count instead
  of a silent cut; the 20,000-node tree cap now renders its own notice row instead of ending
  mid-tree without a word.
- JSONL: jumping to an entry while a search was open left the old directory window on screen
  and kept the host scan running. The jump now clears the search through the same path the
  clear button uses, then recenters on the target. A late search batch or a superseded
  directory reply can no longer repaint the window after that jump.
- JSONL: `Enter` no longer fights the tree's own key handling on a focused row; `Esc` closes
  the value panel and returns focus to its toggle; `Ctrl+C` works while that toggle is
  focused; the toggle's accessible name is its action, not the whole row.

### Changed

- JSONL: the directory's raw-text preview no longer relies on a native `title` tooltip; the
  entry detail is the reading channel (DESIGN.md already banned tooltips as content).

## [6.4.6] - 2026-11-11

Same code as 6.4.5. One version number for two registries: 6.4.5's identity is permanently
reserved on Open VSX — it was published there and then removed, and Open VSX never frees a
published version number — so the first Open VSX publication had to happen under a fresh one.
Nothing in the extension changed; if 6.4.5 is already installed there is nothing to gain by
updating.

## [6.4.5] - 2026-11-11

### Changed

- New extension icon (`image/logo.png`, 512x512, square): a table between braces, in teal and amber. The Marketplace rejected the previous icon as too similar to an existing one.

## [6.4.4] - 2026-11-11

### Changed

- Marketplace display name is now "Data File Viewer (Parquet, JSONL, Excel)". The Marketplace
  rejected "Office Viewer Plus" with "This extension display name is taken" on the first publish
  attempt (6.4.3). The extension id `GaussAA.office-viewer-plus` and the project name are
  unchanged.

## [6.4.3] - 2026-11-10

### Fixed

- `test/unit/stylesheets.test.ts` took the file name with a Windows path separator, so on Linux
  it reported every stylesheet as unused. It now uses `path.basename`. 6.4.2 was tagged before
  this was found and never passed CI.

### Changed

- Removed the three import cycles in the source tree by moving shared types out of the modules
  that imported each other: `x-spreadsheet/data.ts` (sheet and cell types; `index.ts` re-exports
  them) and `gitHistory/contextMenu/menuTypes.ts` (menu item and payload types). Type-only
  changes; runtime behaviour is unchanged.

## [6.4.2] - 2026-11-10

### Fixed

- **[SECURITY]** `xlsx` is back on SheetJS 0.20.3 (the 6.2.0 downgrade to npm 0.18.5 reintroduced
  prototype pollution and ReDoS advisories).
- Removed the 6.2.0 event-listener cleanup helpers; the Git history view no longer calls
  `removeAllListeners()` from an effect whose dependencies can change, which could drop the
  one-time `viewColumn` handler.
- Restored the changelog history (5.0.0 and earlier) that 6.2.0 deleted.
- The sample files under `test/fixtures` are now exercised by `test/unit/fixtures.test.ts`.
- `.nvmrc` is 24, matching the host Node and CI.

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

### Changed

- `xlsx` moved from the SheetJS CDN tarball (0.20.3) to npm 0.18.5. **This was a regression**:
  0.18.5 carries known prototype-pollution and ReDoS advisories. Reverted in the next release.
- Added test fixtures for parquet codecs, CSV/TSV edge cases and JSONL edge cases, plus
  `CONTRIBUTING.md`, `SECURITY.md` and `.editorconfig`. (The fixtures were not used by any test
  until the next release.)
- Added `handler.off()`/`removeAllListeners()` and unused `useEventListener` hooks. They
  fixed no leak (the webview handler overwrites by event name) and are removed in the next release.

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

A scope-narrowing release. The extension keeps only the three formats its maintainer actually
opens — spreadsheets, parquet and JSONL — and drops every second implementation it was
maintaining for formats someone else already covers. Read
[ADR-0015](docs/adr/0015-narrow-to-three-viewers.md) for the range decision and
[ADR-0014](docs/adr/0014-deduplicate-native-formats.md) for the de-duplication rule.

### Removed

- **Every viewer except spreadsheets, parquet and JSONL.** Word (`.docx`, `.dotx`), PowerPoint
  (`.pptx`, `.pptm`), PDF, ePub, fonts (`.ttf`, `.otf`, `.woff`, `.woff2`), all images including
  TIFF/HEIC, PSD, ICNS, XMind, HTML and Java `.class`, plus the archive browser
  (`.zip`, `.jar`, `.7z`, `.rar`, `.tar`, `.tar.gz`, `.tgz`, `.apk`, `.vsix`, `.crx`). Open those
  files in VS Code's own preview or in a dedicated reader. 17 runtime dependencies leave with
  them (`@docx-editor.dev/react`, `pptxviewjs`, `epubjs`, `opentype.js`, `ag-psd`, `mind-elixir`,
  `7z-wasm`, `node-unrar-js`, `tar`, `@zip.js/zip.js`, `@cantoo/pdf-lib`, `heic2any`, `utif2`,
  `react-image-gallery`, `file-type`, `pretty-bytes`), together with the 5.66 MB pdf.js copy, the
  1.4 MB Java decompiler and the 334 KB woff2 decoder.
- **The Markdown editor.** `GaussAA.markdownViewer`, the vendored `vditor/` workspace package
  (19 MB), the `resource/markdown` webview (9.9 MB), the PDF/DOCX/HTML export chain
  (`puppeteer-core`, `chrome-launcher`, `vscode-html-to-docx`), its nine settings, and the
  `Ctrl+V` / `Ctrl+Alt+E` keybindings are gone. VS Code's built-in Markdown preview covers the
  same ground, so `.md` now opens in the text editor — press `Ctrl+Shift+V` for the built-in
  preview. If you relied on the WYSIWYG editor or on exporting Markdown to PDF, stay on 5.x.
- **Parquet editing.** The viewer is read-only now; saving parquet is gone. Reading is unchanged
  (ZSTD/GZIP/BROTLI/LZ4, paging, range requests, nested columns). The three limitations that only
  existed because of the writer — non-SNAPPY files being rewritten as SNAPPY, the 200k-row
  read-only fallback, and the full re-read before saving — are gone with it.
- **The SVG viewer.** `.svg` no longer opens in this extension: VS Code's built-in image preview
  renders it by default and offers "Reopen as Text". The 922-line toolbox (format, fill colour,
  PNG export, zoom, code editor) went with it, along with its six CodeMirror/Lezer dependencies.
  In an SVG, press `Ctrl+Shift+V`-style "Reopen Editor With… → Text Editor" if you need the
  markup.

### Fixed

- Parquet columns whose `LIST` / `MAP` / `STRUCT` type is declared only through
  `logical_type` (the modern parquet form) no longer render as NULL or as flat fields.
  Legacy repeated primitives and plain groups go through the same top-level column model.
- The parquet grid is keyboard-navigable: cells are real focus targets with a roving
  tabindex, arrow keys move the cursor, and screen readers get the column, row and value.
- The cell inspector occupies a fixed row below the grid instead of overlaying rows, so
  selecting a cell cannot reflow the table or move the row under the pointer.
- Sidebar statistics are borderless; the pager arrows have tooltips; leaving an empty row
  input no longer shows the "invalid row" warning.
- The whole-file search cap is formatted from `SEARCH_MAX_ROWS` instead of hard-coding
  `5,000` in ten locales, and the webview restore map is capped at 20 documents instead of
  growing forever.

---

## Earlier releases

## 5.0.0 2026-11-06

A modernization release: three features removed, the platform floor raised to VS Code 1.125
(host Node 24), and the build/test toolchain replaced. Read the **Removed** section before
upgrading — 5.0.0 deletes things that worked in 4.x.

Removed:

- **The HTTP client.** `.http` / `.rest` request sending is gone, along with its custom editor,
  completion/linting providers and the request-runner. It was a separate feature that happened
  to ship in the same extension, it duplicates what REST Client does better, and it was the only
  reason the extension had a language-service stack of its own.
- **AI Polish.** The "AI Polish" action in the Markdown editor's context menu — and the
  OpenAI/Anthropic/Gemini/custom-HTTP streaming client behind it — is removed. It sent the
  document body to an endpoint chosen in the webview, and `package.json` never declared it.
  The editor's own AI dialog, review panel, toolbar entry, prompt/model storage and 238
  translations are gone with it, so nothing in the extension can reach the network for you any
  more — there is no dormant code path left to re-enable.
- **Syntax and colour themes.** The five bundled syntax themes (`Office Dark/Light`, `One Dark
  Pro`, …) and the two colour themes are removed; the icon theme is down to 26 icons from 1,263.
  VS Code's theme support covers this better, and the icon set was 6 MB of files for a
  document-preview extension. If you selected one of these themes, VS Code falls back to its
  default after the upgrade.
- **Web extension host support.** `browser` entry point, the `src/shims/` compatibility layer
  and the `--target web` build are gone. The extension is desktop-only; VS Code will no longer
  try to install a web build that could not run most viewers anyway.

Platform:

- **VS Code 1.125 or newer is required** (was 1.100). That is the host running Node 24, which
  every runtime dependency now has to support — `pnpm check:baseline` fails the build if any
  `engines.node` range is not satisfied by the host Node, so the floor cannot drift silently.

Fixed:

- **"Open remote URL" in Git History never worked.** It did `await import("vscode")`, which
  cannot resolve from an extension bundle (the host injects `vscode` through CommonJS only), so
  every click rejected and the error was shown as text. A new build-time check now fails on any
  bare dynamic `import()` that the packaged layout cannot resolve.

Toolchain (no behaviour change, listed for anyone bisecting):

- Prettier → `oxfmt`; ESLint → `oxlint --type-aware` (both fail the build, neither has a
  baseline). Tests run through `tsx` against the TypeScript sources directly instead of an
  esbuild bundle step. UI verification drives `puppeteer-core`, which was already a runtime
  dependency, instead of a hand-written DevTools-protocol client.
- Dependency swaps: `pdf-lib` → `@cantoo/pdf-lib`, `markdown-it-checkbox`/`markdown-it-plantuml`
  and a hand-copied KaTeX plugin → the `@mdit/plugin-*` family, `pretty-bytes`/`utif2`/
  `chrome-launcher`/`date-format` → maintained equivalents or six lines of local code.
- The repository is now an ES module tree with a CommonJS `out/`. `out/extension.js` went from
  6.55 MB to 1.62 MB after removing a mermaid import that only validated and discarded.

Security:

- The viewer webview and the Markdown editor now run under a Content-Security-Policy
  (`default-src 'none'`, sources limited to the webview origin). Remote scripts, inline
  scripts and `eval` are blocked; the HTML preview panel is exempt because it embeds the page
  you asked to preview. No behaviour change is expected — the policy is what was already
  happening, now enforced. See `docs/adr/0005-webview-csp.md`.

Activation:

- The extension no longer activates on every VS Code start. It now wakes up when a viewer
  is opened, when the workspace looks like a git repository (`.git/HEAD`), when a git
  history panel needs restoring. Two consequences worth
  knowing: the `Git` status-bar entry appears once the extension has activated rather than
  at startup, and in a non-git workspace nothing loads until you open a file.

HTML preview:

- The previewed page now renders inside a sandboxed frame instead of the extension's own
  webview. It still runs its own scripts and loads its images, but it shares no storage
  with the panel hosting it and cannot reach the extension host's message bridge.
- Reload on edit still works; the frame is re-fed rather than re-created.

Custom editors:

- The same file can be opened in two editor groups at once. Previously the second open was
  refused and left you with a single viewer.
- A viewer is no longer kept alive while its tab is hidden. Hidden tabs used to hold a full
  webview (DOM, JS heap) for every open file; they are now recreated when you come back, and
  the parquet viewer returns to the page you left it on.

Spreadsheets:

- The XLSX engine now comes from SheetJS's own CDN (0.20.3) instead of npm, where the package
  stopped at 0.18.5 in 2022. That pulls in the fixes for CVE-2023-30533 (prototype pollution)
  and CVE-2024-22363 (regular-expression denial of service), neither of which had a fix on
  npm. No API change: reading and exporting behave the same.

Word viewer:

- Moved to `@docx-editor.dev/react` (`@eigenpal/docx-editor-react` is deprecated on npm and
  no longer receives fixes). The editor now brings its own title bar, menu bar and toolbar,
  so the Word view gains the full editing chrome instead of the single hand-built button.
- Read-only documents open in the editor's view mode.

## 4.4.1 2026-11-05

Parquet viewer:

- Follow the VS Code theme. The separate light/dark switch is gone: the page, the native
  inputs and the antd widgets now read the editor's colours, so a light view no longer pairs
  with a black search box, and a dark view no longer pairs with a white "row" box.
- Search matches are marked with an opaque chip instead of a translucent wash, so a hit stays
  readable on top of the coloured values underneath.

JSONL viewer:

- Same search-mark change: hits are no longer a slightly different shade of green.

## 4.4.0 2026-11-05

JSONL viewer:

- Open large logs: the file is read in windows instead of being loaded whole, so indexing a
  500 MB log costs one chunk of memory plus the line index.
- One line is exactly one of four things (empty / invalid / too large / value); the detail
  pane and the directory now agree on that, instead of deciding separately.
- The entry tree is bounded and decides its own wrapping; entries above 500 nodes stay
  single-line so the virtual list keeps working.
- "… N more keys" is translated.
- Search streams progress, can be cancelled, and a newer search stops the previous one.

Parquet viewer:

- `LIST`/`MAP`/`STRUCT` columns are no longer offered for editing, and a `LIST<STRING>` column
  now shows the structure icon instead of the string icon (the two used to disagree).

Excel:

- Fix Find & Replace: replacing a match never modified the cell.

EPUB:

- Fix reader theming when exactly one document is rendered.

HTTP client:

- Fix decoding of responses that declare `utf-16be` (they threw instead of decoding).

Git history:

- Fix the macOS git detection branch that could never fire when `xcode-select` was missing.

## 4.2.2 2026-10-15

Markdown Editor:

- Fix unexpected WikiLink editing and copy behavior.
- Fix text-to-speech not working by upgrading `msedge-tts`.
- Preserve original image paths when editing images in visual mode.
- Fix absolute file paths being incorrectly resolved relative to the workspace.

Excel and CSV:

- Improve smooth scrolling.

Images:

- Remember the mouse wheel mode selection.

## 4.2.1 2026-10-14

Markdown Editor:

- Add text-to-speech support (Pro).
- Support configuring keyboard shortcuts(Pro).
- Add a quick delete button for tables.
- Show a notification when navigation to an internal file fails.
- Disable single-tilde strikethrough.
- Restore the `preventMacOptionKey` config.
- Fix text numbers being lost when applying a heading.
- Fix unexpected scrolling to the top while editing.
- Fix handling of external code block updates in IR mode.
- Fix spaces being removed before inline elements in table cells when saving in WYSIWYG or IR mode.

Excel and CSV:

- Support rendering nested formulas.
- Support parsing CSV files with comments.
- Fix selection border misalignment after zooming.

PDF:

- Fix PDF link navigation.
- Automatically switch between light and dark themes when toggling high-contrast colors.

Archives:

- Use UTF-8 as the default ZIP view encoding.
- Display extraction notifications in the viewer UI.

Images:

- Improve image loading performance.

Git History:

- Deduplicate repository paths on Windows.

General:

- Support opening Markdown, CSV, and DOCX files in Live Share sessions.

## 4.2.0 2026-8-16

Markdown Editor:

- Support configuring automatic focus restoration.
- Reduce redundant focus restoration when switching tabs.
- Fix Shift+Enter not working in IR mode.
- Fix Markmap and heading anchor jumps in IR mode.

PDF:

- Update PDF.js to v3.1.
- Remove the extra green indicator on the bookmark sidebar.

XMind:

- Fix inability to drag the canvas.

Git History:

- Improve reset button hover color.
- Improve toolbar button placement.

## 4.1.9 2026-8-13

Markdown Editor:

- Support rendering workspace images.
- Support pasting images to workspace paths.
- Support Markmap diagrams with interactive features.
- Support WikiLink graph.
- Fix overlapping alert text in IR mode.
- Fix input issues after leaving the math formula editor.

Excel:

- Support opening empty XLSX files.

XMind:

- Support editing XMind files.

SVG:

- Support customizing the preview overlay.
- Use HTML syntax to support inline CSS highlighting.

Git History:

- Show details for stash and uncommitted changes.

Editor:

- Change dirty indicator to asterisk.

## 4.1.8 2026-7-28

Excel:

- Add insert image support.
- Add image crop tools.
- Add pivot table read/write support.
- Add select-all-cells support.
- Add advanced replace options.
- Improve XLSX loading performance.
- Improve image selection and dragging behavior.
- Fix inaccurate image drag anchor positioning.
- Hide the theme toggle while loading.

Markdown Editor:

- Fix link and image edit popover layout issues.
- Align frontmatter property key icons.

PDF:

- Improve sidebar styling.

## 4.1.7 2026-7-24

Markdown Editor:

- Support hard line breaks (`Shift+Enter`).
- Support opening PlantUML diagrams in the browser.
- Update Mermaid toolbar color scheme.
- Update Edit in VS Code icon color.

Excel:

- Add auto-fit columns action.
- Update toolbar VS Code icons.
- Polish sheet tab interaction area (WPS-style navigation, sheet list menu, and active tab scrolling).
- Fix:
  - Tolerate unsupported formats and formulas.
  - Fix inaccurate cell positioning after scrolling.
  - Fix workbook loading failure caused by expanded data validation rules.
  - Fix merged cell region recognition for the default selected cell.
  - Fix CSV loading failure when the first row is empty.

PDF:

- Add PDF Pro tools and polish the tools dialog.

Git History:

- Improve details dialog positioning.

## 4.1.6 2026-7-20

Markdown Editor:

- Focus the find input after clicking the find button.
- Fix anchor and footnote jump failure in documents.

Excel:

- Add formula bar.
- Improve VS Code theme compatibility.
- Add an Edit in VS Code action to the CSV editor toolbar.
- Add filter changes to history and increase zoom debounce delay.
- Fix:
  - Fix inability to save edited empty CSV files.
  - Sync clipboard highlight when switching sheets.
  - Prevent image selection when selecting a range.
  - Prevent images from appearing across all sheets.

Diff:

- Skip CSV and DOCX files in diff view.

## 4.1.5 2026-7-8

Fix:

- Fix unexpected file reload on edit.
- Prevent Zip Slip path traversal in archive extraction(Reported by Mykhailo Kholiev).

Git History:

- Improve git history view UI.
- Change date format to yyyy-MM-dd.
- Support more remote URL formats.

Markdown Editor:

New:

- Add Shift+Tab support.
- Add typewriter mode support.
- Add new line button for quick row insertion.
- Support quick drag to resize images(Pro Feature).

Update:

- Improve large file editing performance.
- Add replace feature to find component.
- IR mode: support block drag-and-drop and table enhancements.
- Beautify context menu and settings modal.
- Remove automatic double quote completion.
- Remove default 400px code block height limit.

Fix:

- Fix failure to edit tags and wikilinks normally.
- Fix extra blank line left after deleting sublist
- Fix settings modal closing when deleting prompt or model.

Excel:

Update:

- Copy cells with HTML formatting.
- Support zoom adjustment via scroll wheel.
- Preserve formatting when pasting from Excel.
- Support editable image drag and resize.
- Support cell selection in config function.
- Improve user interaction and context menu appearance.
- Change page scrolling from cell-based to pixel-based.

Fix:

- Fix find component focus accuracy.
- Fix vertical alignment display error.
- Fix cell text overflow, editor overlay, and row height.
- Fix cell interaction and descending sort after sorting.

## 4.1.3-4 2026-7-3

Fix:

- Fix SVG loading failure.
- Fix PPTX loading failure.

## 4.1.2 2026-7-3

Markdown Editor:

- Improve AI review panel.
- Add quick action presets for AI Polish.
- Add output language selection for AI Polish.

Fix:

- Fix math formulas and diagrams (Mermaid, PlantUML) not rendering correctly after code block lazy-loading optimization.

## 4.1.1 2026-7-3

Markdown Editor:

- Add code search support within code blocks.
- Improve editor performance when handling multiple code blocks.

Export:

- Move PDF export margin inside the content container.
- Upgrade html-to-docx for improved DOCX export quality.
- Dynamically load export dependencies (HTML, DOCX, PDF) to reduce extension size.

Git History:

- Add warning echo for Git operations.
- Fix graph being incorrectly dimmed.
- Align author filter options and simplify filtered graph.

Update:

- Improve view rendering performance.
- Replace cheerio with node-html-parser.
- Dynamically load Mermaid and Puppeteer to reduce extension size.

Fix:

- Resolve inline HTML rendering issue.
- Resolve file loading failure on Windows virtual space.

## 4.1.0 2026-7-1

New: Add Parquet file format support.

Markdown Editor:

- Improve visual design.
- Update keyboard shortcuts.
- Support code block font configuration.
- Improve light/dark mode switching logic.
- Fix failure to open relative path files in IR mode.
- Support font size adjustment via scroll wheel in the editor.

Pro:

- Introduce Pro license activation.
- Remove Sponsor banner after Pro activation.
- Support custom font color and background color editing.
- Support adjusting image width and height in the Markdown editor.
- Support beautiful PDF / HTML / DOCX export with theme, font, and font-size options.

Git History:

- Improve visual design.
- Adjust Git branch colors for better visibility in light mode.
- Gray out non-current commits while loading Git history view.
- Fix color inconsistency between graph lines and branches in Git history view.

## 4.0.9 2026-6-29

Update:

- Restore missing HTML viewer previewer registration.
- Fix outline loading failure caused by special headings (code blocks, line breaks).
- Improve file loading performance by streaming via webview URI instead of message buffer transfer.

## 4.0.8 2026-6-29

Markdown editor:

Update:

- Add image preview.
- Beautify CodeMirror toolbar.
- Disable latex syntax validation.
- Remember last selected theme preference.
- Sync settings to other editors after modification.
- Support expandable code blocks with configurable height.

Git History:

- Improve Git view and Git history view styling.
- Support double-click to quick push in Git view.
- Git history view supports pull and batch operations.

Fix:

- Support saving links with spaces.
- Fix class file decompilation failure.
- Fix Wikilinks in remote environment.
- Preserve bold text color in light theme.
- Prevent file cache generation after each view.
- Fix relative links and images in remote environment.
- Fix markdown editor loading issue for Russian locale.
- Fix the missing margin for the first child element at the top of the page.

## 4.0.7 2026-6-26

New:

- Support editing Vditor configuration via a configuration file.
- Markdown editor supports remote and web workspaces (vscode-vfs, vscode-remote).

Update:

- Beautify alert color.
- Improve PDF loading performance.
- Improve Git history view styling.
- Improve TIFF/HEIC loading performance.
- Change the default Excel font size to 11.
- Remove Git history caching for more accurate data.

Markdown:

- Add AI polish usage tip in settings panel.
- Fix CodeMirror font not syncing with typography settings.
- Fix pasted math formula blocks being converted into code blocks.

Fix:

- Fix incorrect read-only mode detection.
- Fix remote URL order in Git view with multiple repositories.

## 4.0.6 2026-6-26

New:

- Full support for Excel.
- Support editing DOCX files.
- Support the web version of VS Code.

Markdown:

- Support Wikilinks.
- Support AI-powered polishing.
- Support configuring editor typography.
- Support previewing and editing inline HTML.
- Support highlighting and autocompletion for latex formulas.

## 4.0.5 2026-6-23

Important: **Refactor Markdown editor**: beautified UI with modernized toolbar, in-page search (Ctrl/Cmd+F), and real-time code block editing

Other:

- Update Material Icons
- Add Kusto (KQL) syntax highlighting
- Beautify Git history view: refreshed styling and a commit details panel
- Support batch Git operations: push branches, add tags, and delete tags across multiple remotes in one action

## 4.0.4 2026-6-19

New:

- Add Kotlin syntax highlighting
- Add Nginx conf syntax highlighting
- Add anonymous usage telemetry (respects VS Code global telemetry settings)

Update:

- Beautify the SVG and PDF view
- Hide sponsor banner in Excel view while loading
- Refresh Git history after deleting filtered branches

## 4.0.3 2026-6-18

Important:

- Redesign the One Dark Modern theme
- Add Git history management feature

New:

- Add SVG editor
- Add support for ODS format
- Add syntax highlighting for TOML
- Add YAML outline and anchor navigation support

Update:

- Add dark mode toggle to PDF viewer
- Update markdown editor default theme
- Add icons for Parquet, SQLite, and DuckDB
- Change the default PPTX view to light mode
- Support quick switch color in markdown editor

## 4.0.2 2026-6-15

- Integrate HTTP client for `.http` and `.rest` files
- Support XMind, PSD, ICNS, HEIC and TIFF formats

## 4.0.1 2026-6-14

- Better zip viewer
- Fix excel save tip gone

## 4.0.0 2026-6-14

- Support pptx and epub files
- Support 7zip and tar.gz archives
- Better support for docx, excel, pdf and archives

## 3.5.7 2026-6-12

- Fixed paste image failed in markdown editor

## 3.5.6 2026-6-10

- Update puppeteer-core version
- Beautify zip,font,image and markdown view
- Fix command 'office.markdown.paste' hijacks ctrl/cmd+v

## 3.5.5 2026-6-8

- Update mermaid version
- Integrate Vditor resources
- Fix Excel cell shortcut keys not working on MacOS

## 3.5.4 2025-4-28

- Support edit excel and csv file.

## 3.5.3 2025-4-17

- Support view rar file.

## 3.5.2 2025-4-10

- Compatible with rest client.

## 3.5.1 2025-4-7

- Better support for zip viewer.
- Update extension name and icon.
- Support export markdown with Mermaid.

## 3.5.0 2025-1-14

- Remove markdown editor border.

## 3.4.8 2024-12-14

- Modify the font of the markdown editor.

## 3.4.6 2024-12-13

- Add more markdown editor theme.
- Support refresh for zip viewer.

## 3.4.2 2024-9-28

- Fixed "Edit In VS Code" shortcut not working.
- Fixed copying content failure in preview mode.

## 3.3.4 2024-6-4

- Better csv and zip support.

## 3.3.3 2024-5-6

- Support edit svg in VS Code.
- Fix shortcut key conflict with Copilot.
- Support display font item name and search font item.

## 3.3.2 2024-4-6

- Support sort zip items.

## 3.3.1 2024-3-30

- Update font and pdf viewer.

## 3.3.0 2024-3-29

- Rewrite the UI front end using React.

## 3.2.5 2024-3-8

- Add shortcut document.
- Update editor switch icon.
- Fix load chinese zip entry failed.

## 3.2.4 2024-3-5

New:

- Support view woff2 font.
- Support modifying editor theme individually.

Markdown

- Follow vscode editor font size.
- Add button to quick switch markdown editor.

Other:

- Support edit in vscode for csv.
- Support edit in vscode for svg.
- Only use image viewer for svg.

## 3.2.0 2024-3-4

- Use vscode default editor when diffing.
- Fix cannot save outline state for macOS.
- Fix cannot find chromium path on macOS.

## 3.1.7 2023-9-32

- Fix export markdown to docx fail.

## 3.1.5 2023-5-18

- Support view apk file.

## 3.1.4 2023-5-4

- Support view zip file.

## 3.1.2 2023-4-25

- Change inactive tab foreground color.

## 3.1.1 2023-4-24

- Update peek view colors.
- Remove semantic highlighting.

## 3.1.0 2023-4-13

- Better theme colors.
- Markdown:
  - Katex compatible wrong formula.
  - Load the chart with a white background.
  - Support for rendering latex formulas in an offline environment.

## 3.0.4 2023-4-11

- Modify the background color of the theme.

## 3.0.2 2023-4-5

- Update extension icon.

## 3.0.1 2023-4-3

- Fix git view cannot view pictures.
- Support for reloading workspace docx after file changes.
- PDF:
  - Fixed sometimes opening PDF failed.
  - Do not display the sidebar on small screens.
  - Support export markdown to pdf without outline.

## 3.0.0 2023-3-29

- Better docx rendering.

## 2.9.6 2023-3-7

- Reduce the size of the excel save notice.
- Support resizing the view through ctrl/meta with mouse scrolling.
- Word:

  - Fix cannot display images.
  - Fix pager jumping incorrectly.
  - Reduce pagination navigator size.

- Markdown:

  - Support hide toolbar.
  - Fix extension activation failure when rest client exists.
  - Support open hyperlinks via meta or middle mouse button.

## 2.9.5 2023-1-12

- 更新主题的editorInlayHint颜色.
- Markdown:
  - 代码块预览增加行号显示.
  - 支持配置代码块颜色样式.
  - 粘贴图片路径增加workspaceDir变量.
  - 修复无法导出PDF.
  - 修复无法显示绝对路径的图片.

## 2.9.4 2022-12-20

- 调整代码块颜色.
- 支持设置导出pdf的chromium路径.

## 2.9.3 2022-12-10

- 修复Pdf部分字体无法加载.
- QuickItem和菜单的border颜色优化.

## 2.9.2 2022-12-6

- 修复表格工具栏消失.
- 保存xlsx时增加确认框.
- 导出Html和docx时不生成目录.
- 修复图片过多时无法显示图片文件名.

## 2.9.1 2022-11-23

- 调整markdown编辑器小屏下的大纲宽度
- Markdown转换的Pdf调整页面边距.

## 2.9.0 2022-11-9

- Speed up extension activation.

## 2.8.1 2022-10-29

- Fix preview html unable to load images.
- Markdown:
  - Support export to docx.
  - Fix hr can not display on dark theme.
  - Edit math formulas using different background colors.
  - Fix export pdf not rendering math formulas that start or end with spaces.

## 2.8.0 2022-10-24

- Change markdown editor default language to english.
- Supporting change of language for editor [en_US, ja_JP, ko_KR, ru_RU, zh_CN, zh_TW]

## 2.7.9 2022-10-23

- 修复小屏下工具栏丢失.

## 2.7.8 2022-10-19

- Markdown:
  - 修复导出的pdf数学公式显示异常.
  - 优化自带主题的markdown显示效果.
- Pdf:
  - 优先显示大纲视图.
  - 美化部分视觉效果.
  - 修复只能显示二级大纲.

## 2.7.7 2022-10-18

- markdown:
  - 升级katex版本.
  - 固定工具栏位置.
  - 记住文件最后的编辑位置.
  - 修复切换不同的markdown总数没有更新.
  - 修复小屏下工具栏样式异常, 以及无法显示大纲.

## 2.7.5 2022-10-12

- 优化大纲切换的焦点.

## 2.7.4 2022-10-11

- markdown
  - 修复字数没有实时更新.
  - 修复diff视图无法显示图片.
  - 修复部分情况下在外部编辑后没有实时更新.
- 修复excel无法保存更新.
- 图片浏览器支持通过ctrl+滑动放大图片.

## 2.7.3 2022-10-5

- 完善焦点聚焦逻辑.
- 支持ctrl+shift+v粘贴为纯文本.
- 增加自动清理webview缓存.
- Markdown:

  - 自动识别粘贴的图片类型.
  - 修复粘贴文本后选中的文本还在.

- 预览Html支持解析本地js文件.

## 2.7.2 2022-9-15

- 移除图片中的空格.
- 修复latex公式显示不全.

## 2.7.1 2022-9-5

- 优化编辑器焦点恢复功能.

## 2.7.0 2022-9-2

- 升级vditor版本.
- 增加设置编辑器焦点的延迟.
- 美化右键菜单样式, 点击其他地方后隐藏菜单.

## 2.6.9 2022-8-29

- 修复代码块背景颜色异常.

## 2.6.8 2022-8-28

- Markdown: 修复显示绝对路径图片的设置无效.
- Xlsx:
  - 支持查看xlsm文件.
  - 加快excel文件打开速度.
  - 修复xlsx超过26的列无法显示.

## 2.6.7 2022-8-28

- Markdown:
  - 修复分割线无法显示.
  - 移除单引号和美元符号的补全.
  - 导出的pdf目录序号修改样式为圆圈.
  - 支持关闭代码预览, 修改代码块背景颜色.
- 修复查看docx文件时, 如果页面数量页面错乱.

## 2.6.1 2022-6-19

- 修复在Vditor无法打开相对路径的markdown.

## 2.6.0 2022-6-13

- 对主题的自适应功能进行优化.
- 修复编辑markdown时输出了无关日志.

## 2.5.8 2022-6-7

- 支持打开dotx文件
- markdown编辑器支持打开图片超链接
- 更新超链接颜色

## 2.5.7 2022-6-7

- 优化粘贴图片的逻辑
- 优化自动主题颜色的边框颜色
- 保存后更新字数总数
- 修改默认代码主题

## 2.5.5 2022-5-28

- 支持配置markdown粘贴图片的路径
- 更新vditor版本

## 2.5.1 2021-12-29

- 增加稳定性, 修复图片有时保存失败
- Support save outline open state.

## 2.5.0 2021-12-27

- Update markdown editor:
  - To open a hyperlink, need to hold down ctrl.
  - Support chose image from toolbar.
  - Update editor when external update.
  - Open source code editor as beside.
- Fix puml editor not trigger save.
- Fix html preview not support untitle document.

## 2.4.2 2021-12-4

- Fix markdown editor cannot cut, loss focus.

## 2.4.1 2021-9-9

- Rollback docx support.
- Fix http auto-complection fail.
- Reduce markdown editor cache usage.

## 2.4.0 2021-8-3

- Better http client support.
- Fix markdown editor cannot save.

## 2.2.2 2021-6-19

- Speed up picture pasting

## 2.2.0 2021-6-2

- Not trigger vscode hotkey when match markdown hotkey.
- Support immediately preservation.

## 2.1.1 2021-5-27

- Change vditor mode from ir to wysiwyg.
- Fix markdown cannot type tab.
- Reduce markdown editor padding.

## 2.0.0+

- Support ods file.
- Remove top button of word document.
- Remove markdown style.
- Support inline markdown.
- Support export to html.
- Markdown support auto quote.
- Change viewer name as editor.
- Change default markdown editor as vditor.

## 1.9.1 2021-1-18

- Fix cannot view big xmind.
- Support follow theme with docx viewer.
- Image viewer support show pixel.

## 1.9.0 2020-12-30

- Support view csv file with utf8 encoding.

## 1.8.9 2020-12-21

- Update java decompiler version, change priority as option.
- Markdown editor support paster as plain text.

## 1.8.1 2020-11-24

- Change export markdown pdf chinese font to 'Song style'
- Export markdown auto add bookmarks.
- Update markdown list style.

## 1.8.0 2020-11-24

- Support play flash swf animation.

## 1.7.10 2020-11-23

- Support open link from markdown.

## 1.7.9 2020-11-19

- support paste image file in markdown editor.

## 1.7.7 2020-11-17

- Update status bar when open markdown editor.

## 1.7.5 2020-11-11

- Add java class decompiler.

## 1.7.1 2020-11-3

- Support generate outline for pdf.

## 1.7.0 2020-11-2

- Support export markdwon to pdf.
- Support edit xlsx、xls、csv.

## 1.6.0 2020-10-19

- Add font viewer.
- Adjust markdown style and fix save fail bug.

## 1.5.0 2020-10-16

- Enhance Image viewer.

## 1.4.3 2020-10-12

- Fix paste fail in terminal.
- Using hyperMD as default markdown editor.

## 1.4.0 2020-10-9

- Integrate stackedit to edit markdown.
- Add csv support.

## 1.3.0 2020-10-8

- Add plantuml support.
- Adjust svg css.

## 1.2.0 2020-10-8

- Add pdf support.
- Add xmind support.

## 1.1.0 2020-10-8

- Add epub support.
- Add svg support.
- Add photoshow support.
- Add windows reg support.
- Add paginition to docx view..

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
