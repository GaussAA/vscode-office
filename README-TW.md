# Office Viewer

[English](README.md) | [简体中文](README-CN.md) | 繁體中文

## 介紹

本擴充功能支援在 VS Code 中預覽以下常見的辦公檔案格式：

- Excel: `.xls`、`.xlsx`、`.xlsm`、`.csv`、`.ods`
- Word: `.docx`、`.dotx`
- PowerPoint: `.pptx`、`.pptm`
- PDF 與電子書: `.pdf`、`.epub`
- HEIC/TIFF: `.heic`、`.heif`、`.tiff`
- 設計檔案: `.psd`、`.xmind`、`.icns`、`.svg`
- 字型: `.ttf`、`.otf`、`.woff`、`.woff2`
- Markdown: `.md`、`.markdown`
- HTML: `.html`、`.htm`
- HTTP 請求: `.http`、`.rest`
- Java: `.class`（反編譯）
- 壓縮檔案: `.zip`、`.jar`、`.vsix`、`.rar`、`.7z`、`.tar`、`.tar.gz`、`.tgz`、`.apk`

## 本儲存庫：Office Viewer Plus（fork）

本儲存庫 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（MIT，見
[NOTICE.md](NOTICE.md)），以 `GaussAA.office-viewer-plus` 發布，可與原版並存安裝。上述功能
全部保留，此外還增加了：

### Parquet：上游打不開的壓縮檔案

上游打包 `hyparquet` 時沒有帶解壓器，ZSTD 壓縮的 parquet 會直接報
`parquet unsupported compression codec: ZSTD`。本 fork 接入了 `hyparquet-compressors`，
SNAPPY / GZIP / BROTLI / ZSTD / LZ4 都能解碼。

![ZSTD 壓縮的 parquet](docs/screenshots/parquet-zstd.png)

讀取是懶載入的，大檔案也不會卡住：

- **按頁讀取**：只解析目前可見的 50 列，377 MB 的檔案不再把整張表讀進記憶體；編輯以
  「絕對列號 → 修補」記錄，換頁時重新套用。
- **支援時按 Range 取位元組**：先用 2 位元組探測，支援就只讀 footer 和你看的頁，否則退回
  一次性抓取；主控台會印出 `[parquet] source: ranged|full`。
- **超大檔案自動唯讀**：儲存需要全量重讀，所以超過 20 萬列時直接停用編輯並說明原因。
- **百萬列也能導覽**：按列號跳轉，頁尾顯示目前區間（`239,951–240,000 of 250,000`）。
- **依型別呈現**：數字靠右對齊 + 等寬數字，字串/布林/時間戳依主題著色，null 顯示為 `NULL`，
  編輯過的儲存格有標記，點擊儲存格可查看完整值。

![Parquet 型別著色](docs/screenshots/parquet-types.png)

工具列的 **Find in file** 以 5000 列為一批掃描整個檔案，帶進度、標記命中的列、在儲存格內
醒目顯示符合的文字，並自動跳到第一筆命中。

### JSONL / NDJSON：目錄 + 樹狀，而不是表格

一行一個 JSON 值不適合表格，因此提供雙欄檢視：左側列出項目，右側把選取項目呈現為樹狀（或原文）。

![JSONL 雙欄檢視](docs/screenshots/jsonl-two-pane.png)

- **檔案位元組不進 webview**：webview 只拿到可見項目的摘要和選取項目的完整值。
- **全檔案搜尋**：分批串流回傳，命中處帶上下文片段並醒目顯示。
- **長值換行**而不是截斷；節點數超過 500 的項目自動退回固定列高的虛擬清單，避免極端列卡死介面。
- 鍵盤：`←`/`→` 摺疊展開，`Space` 切換，`Enter` 複製值，`Ctrl+Shift+C` 複製路徑。

### 驗收方式

```bash
pnpm test        # 解析邏輯單元測試（node:test，不引入額外框架）
pnpm verify:ui   # 無頭瀏覽器 DOM 斷言；截圖輸出到 .ui-verify/shots
```

CI 在每次 push 時都會跑這兩項，以及 `pnpm build` 和 `pnpm run package`。`verify:ui -- --docs`
可更新上面的截圖。設計取捨見 [docs/adr/0001-fork-office-viewer.md](docs/adr/0001-fork-office-viewer.md)。

### 已知限制

- 儲存非 SNAPPY 的 parquet 會被重寫成 SNAPPY（寫入端只支援它），儲存前會提示。
- 超過 20 萬列的 parquet 唯讀；超大檔案的全檔案搜尋受 I/O 限制（會讀取走訪到的每個 row group）。
- JSONL 搜尋比對原始文字，不理解 JSON 路徑。
- 上游的遙測已完全移除。

## Git 歷史

Office Viewer 內建完整的 Git 歷史工作區，讓你無需離開 VS Code 即可瀏覽儲存庫。可從原始碼控制檢視、編輯器標題列、編輯器右鍵選單或檔案總管右鍵選單開啟。

![1783342874748](image/README/1783342874748.png)

## Markdown

整合 Markdown 所見即所得編輯器。

如需使用 VS Code 原生 Markdown 編輯器，請在 `settings.json` 中新增以下設定：

```json
{
  "workbench.editorAssociations": {
    "*.md": "default",
    "*.markdown": "default"
  }
}
```

在編輯器中按右鍵，可將 Markdown 匯出為 PDF、DOCX 或 HTML。PDF 匯出依賴 Chromium，可透過 `vscode-office.chromiumPath` 設定瀏覽器路徑。

![匯出 Markdown](image/README-CN/1685418034035.png)

快捷鍵：基於 [shortcut.md](shortcut.md)，以及：

- 新行: `Ctrl+Enter` / `⌘ Enter`
- 硬換行: `Shift+Enter` / `⇧ Enter`
- 編輯超連結: `Alt+Enter` / `^ Enter`
- 設定 CodeMirror 語言: `Alt+Enter` / `^ Enter`
- 在 VS Code 中編輯: `Ctrl Alt E` / `⌘ ^ E`
- 貼上為純文字: `Ctrl+Shift+V` / `⌘ ⇧ V`

## 其他功能

- HTML: 編輯時按下 `Ctrl+Shift+V` 可即時預覽
- YAML: 支援文件大綱與錨點導覽（別名引用可跳轉到定義）
- 圖示主題: 內建 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 部分圖示，並提供 **Office Material Icon Theme** 與 **One Dark Modern** 配色主題
- Excel: 支援預覽與儲存 `.xlsx`、`.xls`、`.xlsm`、`.csv`、`.ods` 等檔案
- HTTP: 在 `.http`、`.rest` 檔案中傳送請求（整合自 [REST Client](https://github.com/Huachao/vscode-restclient)，並修正了本地請求的已知問題）；按 `Ctrl+Enter` / `⌘ Enter` 傳送
- Java: 開啟 `.class` 檔案可反編譯並查看原始碼

## Sponsor

[![Database Client](https://doc.database-client.com/public/logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

適用於 Visual Studio Code 的資料庫用戶端，支援 **MySQL/MariaDB、PostgreSQL、SQLite、Redis** 以及 **ElasticSearch** 等資料庫的管理，且可作為 SSH 用戶端，極大地提升您的生產力！[立刻安裝](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)。

## 開發指南

### 環境要求

- [Node.js](https://nodejs.org/) 18+
- [VS Code](https://code.visualstudio.com/) 1.64+

### 快速開始

```bash
git clone https://github.com/cweijan/vscode-office.git
cd vscode-office
npm install
```

### 開發除錯

**桌面端擴充功能**（完整功能）：

```bash
npm run dev
```

在 VS Code 中按 `F5`，或在「執行和偵錯」中選擇 **Extension**。

**Web 端擴充功能**（瀏覽器中的 Markdown、HTML、YAML）：

```bash
npm run dev:web
```

在「執行和偵錯」中選擇 **Extension (Web)**。

### 建置與打包

```bash
npm run build    # 生產建置
npm run package  # 產生 .vsix
```

## 使用資料（Usage Data）

Office Viewer 會收集**匿名使用資料**，用於了解各預覽功能的使用情況，以便改進擴充功能。資料透過官方模組 [`@vscode/extension-telemetry`](https://www.npmjs.com/package/@vscode/extension-telemetry) 傳送至 [Azure Application Insights](https://learn.microsoft.com/zh-tw/azure/azure-monitor/app/app-insights-overview)。

### 收集內容

| 事件        | 觸發時機            | 屬性                                                                                 |
| ----------- | ------------------- | ------------------------------------------------------------------------------------ |
| `view.open` | 開啟自訂預覽/編輯器 | `viewType`（如 `excel`、`markdown`、`pdf`）、`fileType`（僅副檔名，如 `xlsx`、`md`） |

**不會**收集檔案路徑、檔名、URL、儲存庫名稱、請求內容或其他可識別個人身份的資訊。

### 如何關閉

僅在以下**兩項均允許**時才會上報：

1. VS Code 全域遙測已開啟（`telemetry.telemetryLevel` 不為 `off`，或舊版中 `telemetry.enableTelemetry` 為 `true`）。
2. 擴充功能遙測已開啟：在設定中將 `vscode-office.enableTelemetry` 設為 `false` 可單獨關閉本擴充功能的上報。

也可在 **設定 → 應用程式 → 遙測** 中關閉 VS Code 的全部遙測。

### 維護者設定

若自行建置並發佈本擴充功能，請參閱 [docs/telemetry.md](docs/telemetry.md) 設定 Azure Application Insights 及範例查詢。

## Credits

- PDF rendering: [mozilla/pdf.js](https://github.com/mozilla/pdf.js/)
- DOCX rendering: [VolodymyrBaydalka/docxjs](https://github.com/VolodymyrBaydalka/docxjs)
- PPTX rendering: [pptxviewjs](https://www.npmjs.com/package/pptxviewjs)
- XLSX rendering:
  - [SheetJS/sheetjs](https://github.com/SheetJS/sheetjs): XLSX parsing
  - [myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet): XLSX rendering
- EPUB: [futurepress/epub.js](https://github.com/futurepress/epub.js)
- PSD: [ag-psd](https://github.com/Agamnentzar/ag-psd)
- XMind: [mind-elixir](https://github.com/ssshooter/mind-elixir-core), [@mind-elixir/import-xmind](https://github.com/ssshooter/mind-elixir-core)
- HEIC conversion: [heic2any](https://github.com/alexcorvi/heic2any)
- Java decompiler: [JetBrains/java-decompiler](https://github.com/JetBrains/intellij-community/tree/master/plugins/java-decompiler/engine)
- HTTP: [REST Client](https://github.com/Huachao/vscode-restclient)
- Markdown: [Vanessa219/vditor](https://github.com/Vanessa219/vditor)
- Material Icon theme: [PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)
