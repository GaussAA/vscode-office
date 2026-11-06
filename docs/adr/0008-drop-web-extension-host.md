---
status: accepted
---

# 删除 Web 扩展宿主，连带整层 node shim

[ADR-0004](0004-web-extension-best-effort.md) 保留了 `browser` 入口，但把它从设计约束降级为 best-effort。那条决策的自我评价是「受益面无法度量」。三年下来，这个判断没有变，代价却被量出来了：

| 组成           | 规模                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `src/shims/`   | 12 文件 / 181 行（`path` 77、`fs` 30、`child_process` 16、`empty-stub` 13、其余 45）                  |
| 入口与降级视图 | `extension.web.ts` 42 + `webUnsupportedViewerProvider.ts` 40 + `WebUnsupported.tsx` 26 + `.css` 59    |
| 宿主判定       | `common/extensionHost.ts` 10，两处运行时分支（`officeContent.ts:134`、`autoClearCacheStorage.ts:50`） |
| 构建胶水       | `build.ts` 里 `createNodeShimPlugin` / `buildWebExtension` / 18 个内置桩映射 ≈ 95 行                  |
| 清单门槛       | `package.json` 里 **17 处** `office.extensionHost.web`（6 个 `enablement`、11 个 `when`）             |
| 产物           | 第二个 esbuild 目标 + `out/extension.web.js` 212 KB                                                   |

决策：删除 `browser` 入口、`src/shims/`、`WebUnsupported*`、`extensionHost.ts` 与 `package.json` 里的 17 处门槛。**`src/react/shims/` 与 `src/react/polyfills/buffer.ts` 保留** —— 它们服务的是 webview（本来就是浏览器上下文），与扩展宿主无关，删了会让 webview 起不来。

## Considered Options

- **维持 best-effort（ADR-0004 的现状）**：它确实很薄，但薄不等于免费 —— 它给每一个新功能附上一条隐性约束「必须能在浏览器里跑」，而这条约束对 parquet / jsonl 这类明显偏本地的功能收税。
- **把它升回一等公民**：需要一个我们拿不出的理由。没有证据表明用户主要在 vscode.dev 里用它。
- **本决策**：整块删掉，`src/shims/` 不再有存在意义，`buffer` 依赖也可以走。

## Consequences

- `vscode.dev` / `github.dev` 不再支持。写进 README 的「不支持」一节与 CHANGELOG。
- [ADR-0004](0004-web-extension-best-effort.md) 里「由此推出不采用 ESM 入口」的**理由**随之消失（ESM 的唯一阻碍是 web worker 宿主）。ESM 入口因此变成「允许但暂不采用」，而不是「被禁止」—— 采用与否要单独立 ADR，不属于本次改造。
- `src/shims/` 删除后，`build.ts` 只剩一个构建目标，`OUT` 里不再有 `extension.web.js`。
- 这条改动是**纯减法**，可用一个 commit 整体回退。
