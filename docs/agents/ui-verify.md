# UI verification (webview)

Webview 的验收方式是无头浏览器断言 + 截图。`pnpm verify:ui` 跑全部场景（CI 也在每次 push 上跑），`--filter=<substring>` 可以只跑名字包含指定字符串的场景，`--headed` 打开可见浏览器窗口（调试时用）。

## 基础设施

- **harness (`scripts/ui-verify/harness.mjs`)**：fake host，在 `http://localhost:<port>` 上提供 webview HTML + 带 CSP nonce 的 stub 脚本，挂载到真实的 Chromium 页面里。stub 用 `setTimeout` 模拟异步应答（延迟 40 ms），payload 来自 `fixtures/` 或内联数据。
- **bridge recorder**：harness 注入的 `window.__bridge` 对象，包装 `acquireVsCodeApi().postMessage` 和 `window.postMessage`，记录 webview 发出的消息（`sent`）和宿主返回的应答（`delivered`）。支持按类型挂起应答（`hold(type)`）、放出（`release(type)`）、查询计数（`sentCount(type)`、`queued(type)`）、直接注入消息（`deliver(type, content)`）。场景可通过 `?hold=type1,type2` 参数在页面加载时自动挂起指定类型的应答。
- **`?delay=<ms>` 参数**：harness 的 parquet 路由支持延迟响应（最多 5 秒），用于模拟"文档加载中陈旧应答到达"的窗口。例如 `/mixed.parquet?delay=1500` 让每次 range 请求延迟 1.5 秒。
- **viewport control**：场景通过 `setViewport(width, height)` 改变浏览器窗口大小（runner 在每个场景后自动调用 `resetViewport` 恢复默认的 1500×850）。用于测试"窗口缩放触发页大小变化"的回归。
- **browser (`scripts/ui-verify/browser.mjs`)**：Puppeteer wrapper，提供 `navigate`、`waitFor`、`evaluate`、`press`、`sleep`、`screenshot`、`setViewport`、`resetViewport`。
- **runner (`scripts/ui-verify/runner.mjs`)**：遍历 `scenarios/*.mjs` 里的场景数组，每个场景拿到 `{ page, base, setViewport, setReducedMotion, press, frames, clearFrames, stats }` context，返回一行总结文本（PASS）或抛异常（FAIL + 截图）。
- **helpers (`scripts/ui-verify/helpers.mjs`)**：`expect`、`json`、`openParquet`、`openJsonl`、`openJson`、`pageSize`、`pagerState`、`rangeOf`、`setInput` 等常用操作。

## RequestGuard 回归场景

在 `scenarios/parquet-request-guard.mjs` 和 `scenarios/request-guard-search.mjs` 里，守护以下回归：

| 场景                                         | 守护什么                               | 变异（能让场景失败）                                                                   |
| -------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| `parquet-open-once`                          | 带窗口缩放后 `init` 只发一次           | M1: 把 `paging.pageSize` 加进 `loadParquet` 依赖 → 失败 `range: 1–21 of 300`           |
| `parquet-restore-first-measure`              | 恢复到 row 100（默认视口，页大小≠8）   | M2: 去掉 `fitPageSize` 的 `                                                            |     | this.restorePending` → **不失败**（页大小 21≠8，分支走不到） |
| `parquet-restore-first-measure-min-viewport` | 恢复到 row 100（视口高 400，页大小=8） | M2: 去掉 `                                                                             |     | this.restorePending`→ 失败`1–8 of 300`                       |
| `parquet-document-switch-stale-scan`         | 切换文档后旧扫描应答不渗入新文档       | **未找到能让它失败的变异**（`selectCell(null)` + `openProfilePanel` 的重置掩盖了影响） |
| `parquet-document-switch-stale-profile`      | 切换文档时旧 profile 应答不渗入新文档  | M3: 去掉 `profileRequest.cancel()` + 面板复位 → 失败 `["null 0%","null 77%"]`          |
| `jsonl-search-new-query-cancels-old`         | 新搜索取消旧搜索，旧批次不渲染         | M4: `isCurrent` 恒返回 true → 失败 `2 rows (stale batch rendered)`                     |
| `json-search-new-query-cancels-old`          | 同上                                   | M4: `isCurrent` 恒返回 true → 失败 `["[0]...","[2]..."]`                               |
| `compare-reload-stale-reply-dropped`         | Compare 丢弃 requestId 不匹配的应答    | M4: `isCurrent` 恒返回 true → 失败 `the view accepted the stale reply`                 |

## 添加新场景的步骤

1. 在 `scenarios/<name>.mjs` 里 `export default [...]` 数组。
2. 在 `runner.mjs` 里 `import` 并展开到 `scenarios` 数组。
3. 每个场景对象：`{ name, async run({ page, base, ... }) { ... } }`，`run` 返回一行总结或抛异常。
4. 用 `expect(condition, message)` 断言，失败时抛 `Error(message)`。
5. 用 `await page.waitFor(condition, timeoutMs)` 等待 DOM 条件成立（默认超时 15 秒）。
6. `await page.evaluate(expr)` 在浏览器里执行 JS 表达式，返回 JSON-serializable 结果。
7. 提交前**必须**找到一个能让新场景失败的变异（改源码、重新 build、跑场景、看失败信息、恢复源码）。变异要记录在场景文件的注释里或本文档的表格里。

## 变异验证流程

每个新场景必须证明它能抓到真实回归。流程：

1. **定义变异**：在源码里做一个"恢复原 bug"的改动（如去掉某行 `cancel()`、改某个条件判断）。
2. `pnpm build`。
3. `pnpm verify:ui --filter=<scenario-name>`，预期**失败**并记录失败信息。
4. `git checkout <file>` 恢复源码。
5. `pnpm build`。
6. `pnpm verify:ui --filter=<scenario-name>`，预期**通过**。
7. `git status --short` 确认工作区干净。

如果找不到能让场景失败的变异，说明场景没有覆盖到真实的回归风险，需要重新设计或删除。

## 截图刷新

`pnpm verify:ui --docs` 会把所有标注了 `docs: "<filename>.png"` 的场景的截图刷新到 `docs/screenshots/` 下（当前 18 张，覆盖 parquet / jsonl / json / compare / excel 的主要 UI）。`docs/*.md` 里用 `![caption](./screenshots/<filename>.png)` 引用。刷新前先目视对比新旧截图，确认变化符合预期。

## 性能闸门

`pnpm verify:perf` 跑 12 个性能检查（parquet 首屏字节数、全文件搜索耗时、宽表翻页、列画像读出的字节数、列扫描字节数，大表格窗口视图首屏/堆/渲染行数，JSONL 字节预算窗口、20 万行搜索，JSON 100 MB 数组的索引/窗口/搜索）。脚本在 `scripts/perf/runner.mjs`，fixture 缓存在 `.perf/`（首次跑时下载）。CI 在每次 push 上跑。不变量见 `scripts/perf/runner.mjs` 里的断言阈值。

## 烟雾测试

`pnpm test:smoke` 在真实 VS Code stable 里验证激活与 custom editor 路由（9 个用例）。`pnpm test:smoke:min` 在 `engines.vscode` 下限上跑同样的测试。两者都需要先 `pnpm build`。CI 在每次 push 上跑这两个。
