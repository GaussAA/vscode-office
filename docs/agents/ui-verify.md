# UI verification

`pnpm verify:ui` runs the built webviews in headless Chrome, asserts the DOM, and writes
screenshots to `.ui-verify/shots/`. It exists because the webviews only run inside a
`postMessage` bridge, so "looks right in the code" is not evidence — every change to a
viewer should be checked here before it ships.

## How it works

```
scripts/ui-verify/
├── runner.mjs    CLI, scenario loading, assertions
├── harness.mjs   HTTP server: built HTML from out/webview + fake VS Code bridge + parquet bytes
├── browser.mjs   Puppeteer driver (puppeteer-core + @puppeteer/browsers) + a CDP session for CSP logs
├── fixtures.mjs  generates mixed/big parquet with hyparquet-writer, uses committed zstd sample
├── scenarios/    scenario definitions split across modules (json, jsonl, parquet-*, compare, etc.)
└── fixtures/zstd.parquet
```

The fake bridge posts the same messages the extension host does (`jsonlInfo`,
`jsonlEntries`, `jsonlSearchBatch`, `jsonlEntryData`, `jsonInfo`, `jsonRecordsData`,
`jsonRecordData`, `jsonSearchBatch`, `jsonRoot`, `open`), so the real React bundles
run unchanged. Parquet fixtures are served with `Range` support and every request is
counted in `/stats` — that counter is how lazy loading and the next-page prefetch are
asserted (`0` new range reads when paging forward).

## Commands

```bash
pnpm build            # required: the harness serves out/webview
pnpm verify:ui                  # assert only
pnpm verify:ui --docs           # also refresh docs/screenshots
pnpm verify:ui --filter=parquet # only matching scenarios (pnpm forwards args directly)
pnpm verify:ui --headed         # watch it run
```

Chrome or Edge is auto-detected; set `CHROME_PATH` to override. Node >= 22 is required
(global `WebSocket`). No network access is needed: the 4 KB ZSTD sample is committed and
the other fixtures are generated locally.

### Reproducing a CI-only flake

A scenario that passes locally and fails in CI is almost always a timing difference, and
re-running it locally proves nothing. `UI_VERIFY_CPU=8` throttles the browser through
`Emulation.setCPUThrottlingRate`, which makes the machine behave like a loaded runner:

```bash
UI_VERIFY_CPU=8 node scripts/ui-verify/runner.mjs --filter=parquet-json-links-column-jump
```

Note what it does _not_ prove: at high rates an unrelated earlier wait (mounting the table)
times out first, so a failure under throttling is not automatically the same failure you saw
in CI. Read the message — `table did not render` and `did not bring the column into view` are
different bugs. Prefer making the scenario wait for the _precondition_ its assertion needs
("the table can scroll sideways") over adding a retry: a retry hides the next real regression.

### Preconditions: wait for the answer, not the shell

Every flake this suite has had was the same shape — the fake host answers asynchronously, the
scenario acts on whatever exists before that answer lands. Three real cases, all fixed the same
way:

| Symptom                                                 | What existed too early                                  | What the scenario waits for now                             |
| ------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------- |
| `the automatic scan produced no top-N`                  | the docked panel (it opens before the profile answer)   | the null-share badge — only rendered once statistics arrive |
| `Cannot read properties of undefined (reading 'click')` | the schema list without its badges                      | `list-null` count ≥ 1 before clicking badge #3              |
| `compare-*` asserting on "Loading…"                     | `.compare-view`, which renders in the loading state too | a group heading or the error line                           |

The rule: **wait for a node that can only exist after the answer**, never for a container that
renders empty first. If the scenario is asserting an _absence_ (a silent host must produce no
number), the honest construct is "the page is otherwise ready, then a bounded grace period" —
`parquet-profile-silent-host` waits for the table and then 250 ms, because an absence needs a
window rather than a signal.

## Adding a scenario

Add the scenario to the module in `scenarios/` that matches its viewer (`parquet-*.mjs`,
`jsonl.mjs`, `json.mjs`, `compare.mjs`, `excel-motion.mjs`, `other.mjs`); `runner.mjs` imports
every module and merges them. A new module has to be imported there as well:

```js
{
    name: 'viewer-what-it-proves',
    docs: 'optional-screenshot-name.png',   // copied to docs/screenshots with --docs
    async run({ page, base, stats }) {
        await openParquet(page, base, '?mixed=1')
        const state = json(await page.evaluate(`JSON.stringify({ /* read DOM */ })`))
        expect(state.range === '1–50 of 300', `unexpected range: ${state.range}`)
        return 'one line of evidence for the summary table'
    },
}
```

Rules that keep this suite useful:

- Assert on **user-visible facts** (text, ranges, counts, computed heights), not internals.
- One scenario per behaviour; name it after the fact it proves.
- A scenario must fail for a real regression: no screenshot-only checks.
- Colours are user-visible too: `parquet-theme-follows-vscode` asserts the _luminance_ of the
  native input and of the antd input under both themes, because the two used to be driven by
  different colour sources (a VS Code CSS variable and antd's default light tokens) and
  disagreed with the page whenever the theme did not match.

## Route smoke vs. real scenarios

`remaining-routes-smoke` walks the **React** routes without a behavioural scenario of their
own — `excel` since the Git History panel was removed in 6.8.0 — with a minimal `open`
payload and asserts that
something mounted and nothing threw. Its job is to catch fork-wide breakage (entry, provider,
shared utilities), **not** rendering correctness. It polls for the mount (`page.waitFor`)
rather than sleeping a fixed delay: the excel chunk is ~1.3 MB and mounts slower on a loaded
machine than any fixed delay we would pick.

`parquet` (`parquet-*`), `jsonl` (`jsonl-*`) and `json` (`json-*`) have their own scenarios instead.
`test/unit/viewer-registry.test.ts` asserts that every route in `main.tsx` is covered one way
or the other, so adding a route without coverage fails the build instead of silently shrinking
the suite.

No viewer is served outside the React route table anymore: the HTML preview panel and the PDF
viewer were the last two, and both were removed in 6.0.0.

## RequestGuard 回归场景

`scenarios/parquet-request-guard.mjs` 和 `scenarios/request-guard-search.mjs` 守护 RequestGuard（commit a141a101）的回归：

| 场景                                         | 守护什么                              | 已验证的变异                                                                  |
| -------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------- |
| `parquet-open-once`                          | 带窗口缩放后 `init` 只发一次          | M1: `paging.pageSize` 加入 `loadParquet` 依赖 → 失败 `range: 1–21 of 300`     |
| `parquet-restore-first-measure-min-viewport` | 视口高 400、页大小 8 时恢复到 row 100 | M2: 去掉 `fitPageSize` 的 `this.restorePending` → 失败 `1–8 of 300`           |
| `parquet-document-switch-stale-scan`         | 切换文档后旧扫描应答不渗入            | **未找到有效变异**（`openProfilePanel` 的 cancel 掩盖了影响）                 |
| `parquet-document-switch-stale-profile`      | 切换文档时旧 profile 应答不渗入       | M3: 去掉 `profileRequest.cancel()` + 面板复位 → 失败 `["null 0%","null 77%"]` |
| `jsonl-search-new-query-cancels-old`         | 新搜索取消旧搜索，旧批次不渲染        | M4: `isCurrent` 恒返回 true → 失败 `2 rows (stale batch)`                     |
| `json-search-new-query-cancels-old`          | 同上                                  | M4: `isCurrent` 恒返回 true → 失败 `["[0]...","[2]..."]`                      |
| `compare-reload-stale-reply-dropped`         | Compare 丢弃 requestId 不匹配的应答   | M4: `isCurrent` 恒返回 true → 失败 `accepted stale reply`                     |

### Bridge 录制器

harness 注入的 `window.__bridge` 对象，包装 `acquireVsCodeApi().postMessage` 和 `window.postMessage`，记录 webview 发出的消息和宿主返回的应答。API：

- `sentCount(type)` / `sentOf(type)`：webview 发出了多少次 / 全部消息
- `deliveredOf(type)`：实际到达 webview 的应答（已放出的）
- `hold(type)` / `release(type)`：挂起 / 放出某类应答
- `queued(type)`：该类应答有多少条在队列里
- `deliver(type, content)`：注入一条应答（不经 stub）

URL 参数 `?hold=type1,type2` 可从页面加载时自动挂起。

### Viewport 控制

场景通过 `setViewport(width, height)` 改变窗口大小，runner 在每个场景后自动调用 `resetViewport()` 恢复默认 1500×850。用于测试"窗口缩放触发页大小变化"的回归。

### Delay 参数

harness 的 parquet 路由支持 `?delay=<ms>`（最多 5000）延迟响应，模拟"文档加载中陈旧应答到达"的窗口。例如 `/mixed.parquet?delay=1500` 让每次 range 请求延迟 1.5 秒。
