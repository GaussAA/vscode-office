# ADR-0028 CSV 偏移与 JSON Preview 索引落盘

- 状态：已接受（2026-11-18，方向；已落地）
- 日期：2026-11-18

## 背景

ADR-0026 把 CSV 偏移缓存推迟（21 MB CSV 的 `excel-csv-scan` 为 126 ms，占 542 ms 打开的
23%），并把 JSON Preview 排除在范围外。维护者现在要求继续这两块。两块的共同点是：要缓存的
都是**偏移/索引**，不是值；文件内容仍由 webview/host 读取，命中的收益是跳过边界扫描，而不是
跳过读取。

现状（审计见 ADR-0026 与 0027）：

- CSV：`createTextSheetSource` 在一次全量扫描里算 `starts`（8 B/行）与 `maxFields`，源只在
  webview；文件字节仍要 fetch；windowed bus 的 126 ms 是这次扫描。
- JSON Preview：`JsonPreviewSession` 在 host 读全文后跑 `indexJsonArray`，得到顶层记录的
  `{start,end}` 范围（UTF-16 偏移）；91.6 MB 数组的索引 <6 s；文本本身还要留在 host 供
  window/record/search 使用。
- 两者当前都没有跨 webview/重开的索引缓存；JSON Preview 的 `json-preview:left` 是 UI 状态，
  没有 TTL/version；统一 Clear 也不认识它。

约束：值不落盘；指纹 `documentCacheId + size + mtime + version`；数据 7 天；LRU；Clear 统一；
首次打开的成本不消失，命中的是第二次打开/重开；host 不做同步全量扫描（CSV 的 126 ms 尚小，
但先把扫描留在 webview；JSON 的索引已在其 session 内）。

## 决定

### 1. CSV 偏移：host 磁盘缓存、webview 扫描回填

- 新增 `CsvIndexCache`（基于 ADR-0026 的 `HostDiskCache`，根目录 `csv-index`）：
  - 值：`starts`（每条记录起始字节，4 B/行）与 `maxFields`；**不含任何单元格值**。
  - 键：`documentCacheId + size + mtimeMs + CSV_INDEX_VERSION`；单文件 ≤16 MB、总 ≤64 MB、
    LRU 5、7 天；超过上限或没有 stat 不缓存。
  - 读取时校验行数 = payload/4、`starts` 严格递增、首项 0、末项 < size；不合法删除并 miss。
- 打开路径：
  - provider 对**文件 scheme 的 `.csv/.tsv`** 设置 `OfficeOpenMessage.hostCsv`；
  - webview 先取 buffer（仍要读文件），再发 `excelCsvIndexOpen`：
    - **hit**：host 返回 `{starts,maxFields}`；`createTextSheetSource` 用这个索引，跳过
      `indexRecordStartsAndFields`；
    - **miss/错误**：webview 照旧扫描，随后 `excelCsvIndexStore` 回填（首屏后 `setTimeout(0)`）。
- `createTextSheetSource(buffer, cachedIndex?)` 是唯一的组装点：它会校验缓存索引与 buffer
  是否相容，不合法就退回扫描；`TextSheetSource` 暴露 `recordIndex` 供回填。
- 未知/虚拟文档、harness stub 不设 `hostCsv`，走原路径。

### 2. JSON Preview：host 磁盘缓存记录范围、跳过索引扫描

- 新增 `JsonPreviewRangeCache`（同一个 `HostDiskCache`，根目录 `json-preview-index`）：
  - 值：顶层数组每条记录的 `{start,end}`（各 4 B，共 8 B/条）；**不含文本/记录值**。
  - 键/预算/版本：`documentCacheId + size + mtimeMs + JSON_RANGE_VERSION`，单文件 ≤16 MB、
    总 ≤64 MB、LRU 5、7 天；超过或无法 stat 不缓存。
  - 命中校验：范围严格递增、`end ≤ text.length`、`start < end`；不合法删除并 miss。
- 打开/重载：
  - host 仍读完整文本；带缓存的 `JsonSource` 识别磁盘来源（`fromBuffer === false`）；
  - `JsonPreviewSession` 增加可选的 `cachedRecords`：数组根直接用缓存范围构造
    `JsonArrayAdapter`，跳过 `indexJsonArray`；对象/标量根不受影响；
  - 首次打开（缓存 miss）后，session 把 `recordRanges` 回填到磁盘；打开 buffer（未保存编辑器
    内容）不缓存。
  - `readJsonSource` 的 text/byteSize 路径不变；新增的只是索引。
- JSON Preview 的 `json-preview:left` UI 状态改用共享的 version/TTL 包装（90 天），旧值迁移；
  Clear 会删除它。

### 3. Clear 与生命周期

- 统一 `Clear Data Viewer Caches` 增加：
  - CSV 偏移缓存（`csv-index`）与 JSON Preview 范围缓存（`json-preview-index`）；
  - 打开的 JSON Preview 面板收到 `clearJsonPreviewCache`：清 `json-preview:left`、重新读文件
    并重建 session（缓存已空，索引会重新扫描并回填）；没有打开面板时下一次打开先清。
- 打开的 Excel 视图收到 `clearExcelCache` 后清 UI/find 并重新走 `init`；host 的 CSV 偏移和
  workbook 缓存已清，重新扫描/解析并回填。
- JSON Preview 的文本、CSV 的字节仍只在内存；上述磁盘条目只有索引/偏移。

## Considered Options

- **CSV 偏移留 webview localStorage**：4 B/行，280k 行 ≈1.1 MB 可行，但 200 MB CSV 会撞
  5–10 MB 配额；与已有的 host disk store 重复。否决。
- **host 侧同步扫描 CSV/JSON**：省一次 webview 扫描，但把 126 ms/数秒的同步工作量搬进
  extension host，冻结消息；且首次打开等待不变。否决。
- **JSON Preview 文本落盘**：重开最快，但全文是用户数据；违反“值不落盘”。否决。
- **只缓存 CSV 或只缓存 JSON Preview**：维护者要求两块一起；分别设计会造成两套相似的
  指纹/预算/清理代码，故共用 HostDiskCache 与同一套验收。
- **不做缓存**：重复扫描成本明确；用户明确要求继续。否决。

## 后果

- **收益**：CSV 重开跳过 126 ms 的边界扫描（大文件更明显）；JSON Preview 重开跳过顶层数组
  索引扫描（91.6 MB 级文件可达数秒）；两者都只落盘偏移，值不落盘；Clear 覆盖完整。
- **代价**：CSV 首次打开多一次 host 往返（miss 很快），首屏后一次大数组 postMessage 回填；
  JSON Preview 首次打开多一次 host 读 stat/缓存查询，索引回填写盘；两个新 cache 需要
  TTL/LRU/损坏处理；JSON Preview 的 UI 状态迁移。
- **已知边界**：第一次打开仍扫描；文件需有 stat；超过 16 MB 的索引不落盘；同 size+mtime 的
  改写无法发现；CSV 的字节仍要 fetch，所以收益是扫描而非 I/O；JSON Preview 文本仍要读入内存；
  harness 不覆盖真实 host 路径。
- **验收**：host 缓存单测（命中/指纹/版本/截断/损坏/LRU/clear）；CSV source 的缓存索引校验与
  回填；JSON session 用缓存范围不调用 `indexJsonArray`（计数/mock）；UI 110 走 fallback；
  `pnpm check`/`verify:perf` 不退化；第二阶段在真实 VS Code 里验证第二次打开。

## 实施记录（2026-11-18）

两块都已落地，验证：`pnpm check` 924 tests / 0 fail，`verify:ui` 110/110，
`verify:perf` 13/13，`pnpm build` 通过。

- **CSV**：`CsvIndexCache`（HostDiskCache，4 B/行 starts + maxFields，16 MB/文件、64 MB 总量、
  LRU 5、7 天）；`ExcelSession` 的 `loadCsvIndex/storeCsvIndex`；`createTextSheetSource` 的
  cached-index 分支与 `recordIndex`；provider 的 `excelCsvIndexOpen/Store` 处理器；webview 的
  `csvIndexTransport`；`hostCsv` 只对文件 `.csv/.tsv` 设置；miss 回填在首屏后 `setTimeout(0)`。
  单测覆盖：缓存命中/指纹/截断/非法索引/LRU；source 的缓存索引与 fallback；session 的 hit
  不 store、miss 回填；transport 的 hit/miss/timeout/store。
- **JSON Preview**：`JsonPreviewRangeCache`（8 B/条 start/end，16 MB/文件、64 MB、LRU 5、7 天）；
  `JsonPreviewSession` 的可选 `cachedRecords` 与 `recordRanges`；`readWithCache`（text 路径不变，
  仅附加 ranges/fingerprint）；handler 的 `storeRanges`；打开的 JSON Preview 面板清缓存后
  `clearJsonPreviewCache` + reload；`json-preview:left` 改用 version/TTL（90 天，旧裸数字/对象
  迁移）；统一 Clear 现在包含 JSON Preview，modal 文案同步。
- **Clear**：Office provider 的 `clearDataViewerCaches` 变 async，清 CSV 索引；JSON Preview
  的 `clearJsonPreviewCaches` 清 ranges 并通知打开的面板；两者都注册到统一 registry。
- **UI harness 仍走 fallback**（fake bridge 不设 `hostCsv`，JSON Preview 无 host 缓存）；
  host 路径由 host/session/source/transport 单测覆盖。
- **真宿主验证已完成**：新增 `test/smoke/hostCache.test.ts`，在真实 VS Code Extension
  Development Host + CDP 里打开大文件两次，用新的 `GaussAA.office.__cachePaths`（仅非
  production 注册）定位 globalStorage：
  - CSV 300k 行：第一次有 `excel-csv-scan`，第二次为 0 且有 `excel-csv-index-hit`，`csv-index`
    的 `.bin` mtime 不变；
  - Excel 30k×8（10.45 MB，窗口阈值 8 MB 与 host 上限 15 MB 之间）：第一次有
    `excel-workbook-parse`，第二次为 0；
  - JSON Preview 150k 条、JSONL 150k 行：第二次 `.bin` mtime 不变（range/line index 未重写）。
  - `pnpm test:smoke` 结果为 21/21；4 个 cache 用例连续 3 次通过。前两次运行里既有的
    save suite 各有一个时序 flake（分别是 save echo 与 external change，第三次全绿），与
    缓存无关；`.vscode-test.mjs` 现在显式固定 extension.test → hostCache.test 的顺序，避免
    新 suite 的激活破坏 activation-is-lazy 断言。
- **仍待**：版本号与发布（与前面累积的修复一起，未发）；save suite 的时序 flake 在 CI 上
  仍需观察。
