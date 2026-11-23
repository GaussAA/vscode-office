# ADR-0027 Excel 工作簿缓存：首次在 webview 解析，host 缓存行文本

- 状态：已接受（2026-11-18，方向；已落地）
- 日期：2026-11-18

## 背景

ADR-0026 的测量（`excel-workbook-parse-probe`，300,001 行 × 8 列）给出：

| 指标         | 数值     |
| ------------ | -------- |
| 整本 parse   | 6,466 ms |
| 打开到首屏   | 8,095 ms |
| parse 占打开 | 80%      |

两项判据（`>1.5 s` 或 `>50%`）都触发。原计划是“host 读文件、SheetJS 解析一次、按指纹
缓存在 host 内存”。实现前发现一个约束：

- SheetJS 的 `XLSX.read` 是**同步**的。把 6.5 s 的解析放进 extension host 会让整个 host
  卡住 6.5 s——命令、文件事件、其它 webview 消息全部停摆。
- 用 worker 可以避免卡 host，但**不会缩短第一次打开**：首屏仍然要等整本解析完成，行文本
  在 worker 里生成，再传回 host/webview；第一次打开的用户等待不变。worker 还会引入打包、
  线程生命周期和结果序列化的复杂度。
- 缓存真正能省掉的是**第二次打开**（重开、同文件第二个标签）的 fetch + parse，而不是第一次。

所以把“host 解析”改成“**首次在 webview 解析，host 缓存行文本**”：第一次打开与今天相同
（webview fetch + parse），解析结果随后交给 host 内存；第二次打开直接向 host 要元数据和
行窗口，不 fetch、不 parse。值仍然只在内存，不落盘。

## 决定

### 1. host 内存缓存

- 新增 `ExcelWorkbookCache`：值是 `WorkbookSheetRows[]`（每个 sheet 的 `string[][]`），键是
  `documentCacheId + size + mtimeMs + WORKBOOK_CACHE_VERSION`。
- **按文件 LRU 2**，随 VS Code 会话结束；超过 15 MB 的源文件（windowed 路径的上限）不进缓存。
- **只存内存**：没有 disk store、没有 localStorage；Clear 清空。
- 同一文件第二个标签共享；不同文件打开时按 LRU 淘汰（被淘汰的打开视图需要重开，见“已知边界”）。

### 2. 打开路径：hit 跳过 fetch/parse，miss 走原路径并回填

- `OfficeOpenMessage.hostWorkbook`：provider 只对**文件 scheme 的 workbook 后缀**
  （`.xlsx/.xlsm/.xls/.ods`）设置；CSV/TSV、虚拟文档、harness stub 不设置。
- webview 先发 `excelWorkbookOpen`：
  - **hit**：host 返回 `{key, sheets: [{name,rowCount,columnCount}]}`；webview 创建
    `HostWorkbookSource`，`readRows` 发 `excelWorkbookRows` 请求窗口；不 fetch、不 parse。
  - **miss/超时/错误**：webview 走现有 `loadBuffer` + `loadWorkbookRows`，然后发
    `excelWorkbookStore` 把行文本交给 host；当前视图仍用本地 `WorkbookSheetSource`。
- store 在 `setTimeout(0)` 里发，避免首屏先等一次大对象序列化；第二次打开在稍后发生即可。
- 请求带 `requestId`，webview 侧有 pending map 和 4 s 超时；host 的行请求按 key 查缓存，
  被淘汰/清除时返回错误，不静默返回空行。

### 3. 清理

- `Clear Data Viewer Caches` 调 `OfficeViewerProvider.clearDataViewerCaches()`，其中
  `excelWorkbooks.clear()`；无打开的 Excel 视图时下一次打开带 one-shot clear。
- 打开的 Excel 视图收到 `clearExcelCache` 后清 UI/find，并发 `init` 重新走一次打开：
  host 缓存已空，webview 重新 fetch/parse 并回填，避免用已删缓存继续发窗口请求。
- JSON Preview 不动；Excel 值不落盘。

### 4. 测试与 fallback

- 单测：缓存 LRU/key/元数据；host handler 的 open/store/rows、指纹变化、15 MB 上限、无 stat；
  `HostWorkbookSource` 的元数据/窗口/换 sheet；transport 的 hit/miss/超时/错误；session 的
  hit 不调 `loadBuffer`/`loadWorkbookRows`、miss 回填。
- UI harness 的 fake bridge 不设 `hostWorkbook`，所有 Excel UI 场景继续测 **fallback** 路径；
  host 路径由 host/session 单测覆盖。真实 VS Code 的第二次打开是人工/发布前验证项。

## Considered Options

- **host 同步解析**：首屏等待相同，且冻结 extension host 6.5 s；否决。
- **worker 解析**：不冻结 host，但首屏等待不变，且打包/线程/序列化成本高；本轮否决，若未来
  host 响应性成为问题再评估。
- **解析结果落盘/localStorage**：重开跨重启最快，但单元格值落盘，隐私/体积边界不可控；否决。
- **不缓存，只测量**：测量已证明重复 parse 成本，但用户每次重开都付 6.5 s；否决。

## 后果

- **收益**：同一 VS Code 会话内重开/第二个标签的 windowed workbook 不再 fetch/parse；
  host 不被同步解析卡住；值不落盘。
- **代价**：host 多一份行文本内存（LRU 2），store 的一次大对象 postMessage；新增三组消息与
  fallback 分支；缓存淘汰后打开的视图需要重开。
- **已知边界**：第一次打开仍解析（用户等待不变）；超过 15 MB 不缓存；LRU 2，第三个大文件
  会淘汰最早的；被淘汰的打开视图行请求会报错（重开恢复）；跨 VS Code 重启不保留；harness
  不覆盖真实 host IPC。
- **验收**：`pnpm check` 897 tests；`verify:ui` 110/110（fallback）；`verify:perf` 13/13；
  session 单测断言 host hit 零 fetch/parse、miss 回填；ADR-0026 的测量仍作为“第一次打开”
  的观测，host 命中是第二次打开的收益。

## 后续（7.0.0）

工作簿 host 缓存随表格预览在 [ADR-0029](./0029-narrow-to-two-viewers.md) 删除；JSONL/JSON 共用的
`HostDiskCache` 不受影响。
