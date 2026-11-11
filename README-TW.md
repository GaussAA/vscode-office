# Data File Viewer (Parquet, JSONL, Excel)

[English](README.md) | [简体中文](README-CN.md) | 繁體中文

## 介紹

這個擴充功能在 VS Code 裡只預覽**三種東西**：

| 格式                                                     | 你能得到什麼                                            |
| -------------------------------------------------------- | ------------------------------------------------------- |
| 試算表：`.xls`、`.xlsx`、`.xlsm`、`.csv`、`.tsv`、`.ods` | 可編輯格線與尋找/取代；大檔案進入唯讀視窗檢視           |
| Parquet：`.parquet`                                      | ZSTD/GZIP/BROTLI/LZ4 欄位、懶載入分頁、全檔案搜尋，唯讀 |
| JSONL / NDJSON：`.jsonl`、`.ndjson`                      | 左側項目目錄，右側把選取項目呈現為樹狀或原文            |

就這些。這個 fork 從上游繼承的其他格式——Word、PowerPoint、PDF、ePub、字型、圖片、PSD、
ICNS、XMind、HTML、Java `.class`、壓縮檔——都在 **6.0.0** 移除：其中一部分 VS Code
原生已經支援，其餘都有更成熟的專用閱讀器。理由見
[ADR-0015](docs/adr/0015-narrow-to-three-viewers.md)，升級說明見 [CHANGELOG.md](CHANGELOG.md)。

除此之外還有一個命令式開啟的唯讀 JSON 檢查器，用來讀大的 `.json` 頂層陣列；它不註冊
`.json`、不改變預設編輯器，見下面的 [JSON 陣列](#json-陣列不開啟文字編輯器也能讀)。

## 本倉庫：Data File Viewer (Parquet, JSONL, Excel)（fork）

本倉庫 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（MIT，見
[NOTICE.md](NOTICE.md)），以 `GaussAA.office-viewer-plus` 發佈，可與原版並存安裝。這個 fork
只服務一個人的資料工作，因此只保留那部分工作真正會用到的格式。

如果同時安裝了原版，兩者都會宣告可以開啟相同的表格檔案，VS Code 會選其中一個作為預設。想指定時，在分頁上用 **重新開啟編輯器的方式…**，或設定 `workbench.editorAssociations`（例如 `{ "*.xlsx": "GaussAA.officeViewer" }`）。最省事的做法是停用原版。

### Parquet：上游打不開的壓縮檔案

上游打包 `hyparquet` 時沒有帶解壓器，ZSTD 壓縮的 parquet 會直接報
`parquet unsupported compression codec: ZSTD`。本 fork 接上 `hyparquet-compressors`，
SNAPPY / GZIP / BROTLI / ZSTD / LZ4 都能解碼。

![ZSTD 壓縮的 parquet](docs/screenshots/parquet-zstd.png)

讀取是懶載入的，大檔案也不會卡：

- **按頁讀取**：只解析目前可見的 50 列，377 MB 的檔案不再把整張表讀進記憶體。
- **支援時按 Range 取位元組**：先用 2 位元組探測，支援就只讀 footer 和你看的頁，否則退回
  一次性抓取；主控台會印出 `[parquet] source: ranged|full`。
- **百萬列也能導覽**：按列號跳轉，頁尾顯示目前區間（`239,951–240,000 of 250,000`）。
- **依型別呈現**：數字靠右對齊 + 等寬數字，字串/布林/時間戳依主題著色，一般 `BYTE_ARRAY`
  以十六進位顯示，null 顯示為 `NULL`，點擊儲存格可查看完整值。
- **結構化儲存格有結構感**：JSON 陣列/物件（包括 Polars 存成 JSON 字串的 list 欄位）
  會依語法著色，而不是糊成一段字串。
- **URL 可直接點擊**：整個值都是 `http(s)` URL 的儲存格會透過擴充功能宿主在瀏覽器開啟；
  其他協定、帶帳號密碼的 URL 不會被開啟。
- **點擊左側欄位跳到對應欄**：表格水平捲動到該欄並留下淡色高亮，不改變列、分頁或篩選。

![Parquet 型別著色](docs/screenshots/parquet-types.png)

工具列的 **Find in file** 每個欄位只掃描一遍整個檔案，帶進度、標記命中的列、在儲存格內
醒目顯示符合的文字，並自動跳到第一筆命中；100 萬列約 1.3 秒。

檢視器跟隨 VS Code 主題——包括以前在深色檢視下仍是淺色的 antd 控件。沒有獨立的明暗切換開關。

![淺色主題下的 parquet](docs/screenshots/parquet-light.png)

### JSONL / NDJSON：目錄 + 樹狀，而不是表格

一行一個 JSON 值不適合表格，因此提供雙欄檢視：左側列出項目，右側把選取項目呈現為樹狀（或原文）。

![JSONL 雙欄檢視](docs/screenshots/jsonl-two-pane.png)

- **檔案位元組不進 webview**：webview 只拿到可見項目的摘要和選取項目的完整值。
- **全檔案搜尋**：分批串流回傳，命中處帶上下文片段並醒目顯示。
- **目錄讀身分，不只看原始開頭**：項目有頂層身分鍵時顯示它；身分鍵是物件時再往裡讀一層
  （如 `id: { query }`）。
- **長值可以讀全，不是截斷。** 樹是概覽：大項目每列固定單列、字串預覽 120 字元；小項目（≤2,000 節點）仍允許葉子換行到 2,000 字元。無論哪種，選取一列後樹下方展開值面板，給出全文、路徑、類型、字元數與整值複製。節點數超過 2,000 的項目自動退回固定列高虛擬清單，避免極端列卡死介面。
- **上限會說出來。** 單列超過 8 MB 時以原始文字顯示而不解析成樹；原文超過 1,000,000 字元時明確標為截斷；樹的 20,000 節點上限也有提示列，而不是無聲結束。
- 鍵盤：`←`/`→` 折疊展開，`Space` 切換，`Enter` 開啟或收合值面板，`Ctrl+C` 複製值，`Ctrl+Shift+C` 複製路徑，`Esc` 收合面板。

![JSONL 值面板](docs/screenshots/jsonl-value-panel.png)

### JSON 陣列：不開啟文字編輯器也能讀

唯讀檢查器，面向頂層是陣列或物件的 `.json` 檔案。它是命令，不是第四個 viewer：不註冊
`.json`、不接管預設編輯器、不寫 `contributes.customEditors`。入口是命令面板
（**Data File Viewer: Preview JSON**）、檔案總管右鍵和 JSON 編輯器標題。

![JSON 預覽](docs/screenshots/json-records.png)

- **大陣列只建索引，不整份 parse。** 頂層陣列最多 100 MB，按記錄邊界串流掃描；webview 只為可見列要
  `[index]` 標籤，並一次只要一筆記錄。物件根（最多 20 MB）整份解析。
- **先找記錄，再找鍵。** 全檔案搜尋回傳命中的記錄、片段與命中數；選取後載入該記錄，展開並醒目顯示
  第一個命中的鍵；物件根的結果是路徑。
- **只接受嚴格 JSON。** 註解和尾逗號會給出帶行列的解析錯誤，並留一個 **Open in Text Editor** 出口；
  編輯器有未儲存修改時優先讀 buffer，並在工具列標明。
- **唯讀是承諾。** 沒有編輯、schema 驗證或 JSONC；所有動作最終都回到文字編輯器。
- 鍵盤：記錄清單 `↑`/`↓`/`Home`/`End`；樹 `←`/`→`/`Space` 收合展開、`Enter` 切換值面板、
  `Ctrl+C` / `Ctrl+Shift+C` 複製值/路徑、`Esc` 清除搜尋或收合面板。

![JSON 搜尋結果](docs/screenshots/json-search.png)

上限：100 MB 陣列、20 MB 物件根、單筆記錄 8 MB（超過按原文顯示）、每筆原文最多
1,000,000 字元、每次搜尋最多 10,000 個命中。記錄清單是虛擬清單；樹沿用 JSONL 的
20,000 節點/每層 200 子項/12 層上限。

### 表格：大檔案也能直接看

超過 8 MB 後，CSV/TSV 與活頁簿進入唯讀視窗檢視：DOM 裡只有視窗內的行，21 MB 的 CSV 首屏
約 0.5 s、堆約 33 MB，而可編輯網格需要數秒與數百 MB。尋找按區塊掃全檔案，跳列只改捲動偏移，
活頁簿帶 sheet 選擇器。閾值以上要編輯就用文字編輯器（**Open in VS Code**）。

![唯讀視窗檢視](docs/screenshots/excel-windowed.png)

### 驗收方式

```bash
pnpm test        # 解析邏輯單元測試（node:test，不引入額外框架）
pnpm verify:ui   # 無頭瀏覽器 DOM 斷言；截圖輸出到 .ui-verify/shots
pnpm verify:perf # 大檔案首屏位元組/耗時與搜尋耗時閘門
```

CI 在每次 push 時都會跑這三項，以及 `pnpm build` 和 `pnpm run package`。`pnpm verify:ui --docs`
可刷新上面的截圖。

### 已知限制

- 超大檔案的 parquet 全檔案搜尋受 I/O 限制（會讀取走訪到的每個 row group）。
- parquet 唯讀，沒有寫入端。
- 表格超過 8 MB 時進入唯讀視窗檢視（只渲染視窗內的行）。活頁簿超過 15 MB、虛擬工作區裡的
  CSV/TSV 超過 25 MB 時先詢問再載入；本機 CSV/TSV 最多可視窗化到 200 MB。所有活頁簿格式（`.xlsx`、`.xlsm`、`.xls`、`.ods`）都以列文字
  視窗化，所以超過 8 MB 也是唯讀。
- JSONL 搜尋比對原始文字，不理解 JSON 路徑。
- JSONL 單行超過 8 MB 時只以原始文字顯示、不解析成樹；原文檢視只送出前 1,000,000 個字元
  （並明確提示），不會假裝那是全文。
- JSONL 的樹有上限：20,000 個節點、每層 200 個子項、12 層。截斷時樹會說出來；要看剩下的
  內容用原文檢視。
- 目錄視窗按位元組（4 MB）而不是列數封頂：由超大列組成的檔案只在選取處附近列出少量項目，
  不會為了填滿一屏先解析整塊。用項目編號跳轉；視窗只會向下追加，填不滿一屏時末尾有一列
  顯式的「載入更多項目」。
- JSON 預覽的陣列上限 100 MB、物件根上限 20 MB；單筆記錄超過 8 MB 按原文顯示，搜尋最多
  10,000 個命中，JSONC/尾逗號會被拒絕。它是命令式面板，視窗重新載入後不恢復上一次預覽的
  文件，需要重新執行命令。
- 上游的遙測已完全移除。

## Git 歷史

擴充功能仍保留 Git 歷史工作區（它是提交瀏覽器，不是檔案預覽，所以 6.0.0 的範圍收窄沒有動它）。
可從原始碼控制檢視、編輯器標題列、編輯器右鍵選單或檔案總管右鍵選單開啟。

![Git 歷史](image/README/1783342874748.png)

## 其他功能

- YAML：文件大綱與錨點導覽（別名引用可跳轉到定義）
- XML：文件格式化
- 圖示主題：8 個 [Material Icon Theme](https://github.com/PKief/vscode-material-icon-theme) 圖示，涵蓋試算表、parquet 與 JSONL

## 開發

```bash
pnpm install
pnpm build        # 生產建置到 out/
pnpm run package  # 打包 vsix（需先 build）
pnpm check        # 格式 + lint + 基線 + 型別 + 單元測試
pnpm check:full   # check + build + smoke + verify:ui + verify:perf
```

在 VS Code 裡按 `F5`，選擇 **Extension** 執行本地建置。

## 致謝

- 試算表解析：[SheetJS/sheetjs](https://github.com/SheetJS/sheetjs)
- 試算表呈現：[myliang/x-spreadsheet](https://github.com/myliang/x-spreadsheet)
- Parquet：[hyparquet](https://github.com/hyparam/hyparquet) 與
  [hyparquet-compressors](https://github.com/hyparam/hyparquet-compressors)
- 圖示主題：[PKief/vscode-material-icon-theme](https://github.com/PKief/vscode-material-icon-theme)

## Sponsor

[![Database Client](https://doc.database-client.com/public/logo.png)](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)

適用於 Visual Studio Code 的資料庫客戶端，支援 **MySQL/MariaDB、PostgreSQL、SQLite、Redis**
以及 **ElasticSearch**，也可作為 **SSH** 客戶端使用。
[立刻安裝](https://marketplace.visualstudio.com/items?itemName=cweijan.vscode-database-client2)。
