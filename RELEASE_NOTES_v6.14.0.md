# Data File Viewer (Parquet, JSONL, Excel) v6.14.0

## 🎉 Major Optimization Release

This release brings **significant performance and quality improvements** through a comprehensive 3-day optimization effort.

## Key Improvements

### 📦 21.3% Smaller Package Size

- **Before**: 1,805 KB (gzipped)
- **After**: 1,420 KB (gzipped)
- **Saved**: 385 KB

Your extension downloads and updates faster!

### 🔧 Memory Leak Fixed

- Fixed **all 129 event listener leaks**
- Memory cleanup rate improved from **3% to 100%**
- You can now open/close Excel files repeatedly without crashes

### ⚡ Faster Loading

- Language packs load on demand (not all at once)
- Find panel and dialogs load only when needed
- Faster first-time open

### 🗑️ Cleaner Codebase

- Removed 519 lines of unused code
- Deleted 5 unused files
- Improved maintainability

## What This Means for You

- ✅ **Smaller download** — Save 385 KB
- ✅ **Faster startup** — Lazy loading optimization
- ✅ **No more crashes** — Memory leaks completely fixed
- ✅ **Stable long-term use** — No memory growth over time

## Technical Details

See full technical report: [docs/x-spreadsheet-optimization-final-report.md](docs/x-spreadsheet-optimization-final-report.md)

## Credits

This optimization was the result of comprehensive research including:

- Evaluation of 4 alternative spreadsheet libraries
- Complete POC for ag-Grid integration (444 lines)
- 13+ detailed technical reports
- ADR-0024 documenting the decision to optimize rather than replace

---

**Full Changelog**: https://github.com/GaussAA/vscode-office/compare/v6.13.0...v6.14.0
