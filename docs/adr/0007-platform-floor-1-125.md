---
status: accepted
---

# 平台下限抬到 1.125（宿主 Node 24），并让闸门检查依赖的 `engines`

[ADR-0003](0003-platform-baseline.md) 把三件套焊成一条不等式，但它只比较**版本号**。于是它放过了这件事：`puppeteer-core@25.16.0` 自己声明 `engines.node >= 22.12.0`，而我们声称支持的是 `^1.100.0` —— Electron 34，宿主 **Node 20.18.1**。这个依赖是运行时依赖：它被 `external` 保留、打进 `out/node_modules`、由 Markdown 导出 PDF 那条路加载。所以在**我们书面承诺支持的宿主上**，那条功能跑在一个依赖明确拒绝的运行时上。同一堵墙挡住了 `file-type@22`（`engines: node >= 22`），那是 #23 里唯一没升的依赖。

决策：`engines.vscode` 从 `^1.100.0` 抬到 `^1.125.0`（Electron 42 → Node 24.15），`@types/node` 跟到 `^24`，`tsconfig` 的 `target` / `lib` 提到 ES2024，`.vscode-test.mjs` 的 `smoke-min` 跟到 `1.125.0`。同时把 `check-baseline.mjs` 从「比版本号」扩成「**求交**」：扫运行时 `dependencies` 各自的 `engines.node`，与宿主 Node 取交，空集就让 `pnpm check` 失败。

## Considered Options

- **`^1.105.0`（Electron 37 → Node 22.16）**：最小的诚实修法，同时满足 `puppeteer-core`（≥22.12）与 `file-type@22`（≥22），用户面只砍到 2025-10。放弃它的理由是 Electron 40/41/42 都落在 Node 24，抬到 1.125 之后**下一次 Node 上限漂移会远得多**。
- **保持 `^1.100.0`，把 `file-type` 永远钉在 19**：那不是保守，是继续维持一个已知为假的承诺 —— 而且没有任何现有闸门能发现它（这正是本 ADR 要修的第二件事）。
- **跟随当前 stable（`^1.143`）**：买不到任何我们需要的新 API，只是白砍用户。

## Consequences

- 1.125 之前的 VS Code 装不上这个扩展。这是真实的用户面代价，写进 CHANGELOG。
- 闸门从「比三个版本号」变成「**比三个版本号 + 算依赖的 Node 要求**」。以后任何依赖悄悄抬高 `engines.node`，`pnpm check` 就会红 —— 包括 `pnpm add` 之后的第一次检查。
- 下限被真实测试过这件事，现在依赖三个同步点：`package.json#engines`、`scripts/check-baseline.mjs` 的映射表、`.vscode-test.mjs` 的 `smoke-min`。第三个以前只写在注释里，本 ADR 把它写进脚本注释和 `AGENTS.md`。
- `file-type` 可以升到 22，Web 入口删除后（[ADR-0008](0008-drop-web-extension-host.md)）它的 web shim 也不需要了。
- 基线数字本身不进词汇表，只进 `package.json`：它属于会变的事实，不属于决策（同 ADR-0003）。
