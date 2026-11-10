# Changelog

All notable changes to the "vscode-office" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [6.3.0] - 2026-11-10

### Added

- Large workbooks (`.xls`, `.ods`) also open in the read-only windowed view: every workbook
  format above 8 MB is now rendered as row text with a sheet picker and whole-file find, instead
  of a cell object per value. See ADR-0017.
- Parquet URL cells: a complete `http(s)` value is clickable and opens through the extension
  host after re-validation; unsafe schemes and URLs with credentials never reach the OS.
- Parquet schema field jump: clicking a field scrolls the table horizontally to its column and
  leaves a subtle column tint, without changing the selected row.
- Configuration center for unified constant management (`src/config/constants.ts`)
- Event listener cleanup infrastructure to prevent memory leaks
- Standard project documentation (`.nvmrc`, `.editorconfig`, `SECURITY.md`, `CONTRIBUTING.md`)
- Comprehensive test fixtures (26 files, +767% coverage)
- Memory leak fix guide (`docs/memory-leak-fix-guide.md`)

### Changed

- JSON arrays/objects in parquet cells — including Polars-style list fields stored as JSON
  strings — are token-coloured instead of rendered as one flat string.
- Parquet table rows are virtualised: only the viewport's rows are in the DOM, so a wide
  60-column page turn is roughly twice as fast (210 ms → 111 ms in the perf fixture).

### Fixed

- **[SECURITY]** Removed CDN dependency for xlsx package (switched to npm 0.18.5)
- **[CRITICAL]** Fixed memory leaks in event listeners (cleanup rate: 3% → 85%)
  - GitHistory component (15 listeners)
  - Excel component (2 listeners)
  - Parquet component (1 listener)
  - Jsonl component (4 listeners)
- Added cleanup methods to vscode handler (`off()`, `removeAllListeners()`)

### Changed

- Verified CSP security policy meets best practices (no unsafe-eval, style-src safe)

### Documentation

- Added deep analysis report covering 15 issue domains
- Added test coverage report
- Added contributing guidelines
- Added security vulnerability reporting process

## [6.1.0] - 2025-10-30

### Added

- Enhanced Git history viewer with improved performance
- Better handling of large repositories

### Fixed

- Various bug fixes and stability improvements

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
