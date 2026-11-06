---
status: superseded
superseded-by: 0008-drop-web-extension-host.md
---

> **后续**：Web 入口已在 [ADR-0008](0008-drop-web-extension-host.md) 中整体删除，本文的「保留但降级」不再成立；其中「因此不采用 ESM 入口」的理由随 web worker 宿主一起消失，ESM 变成「允许但暂不采用」。

# Web 扩展降级为 best-effort，并因此不采用 ESM 入口

扩展同时提供 desktop（`main` → `out/extension.js`）与 web（`browser` → `out/extension.web.js`）两个入口。保住 Web 版可用的代价分散在整个代码库：`src/shims/` 下 12 个 node 内置模块桩、双打包目标、一批 `enablement: "!office.extensionHost.web"` 的命令门槛，以及一条隐性约束——**新功能必须能在浏览器里跑**。这条约束会在 parquet / jsonl 这类明显偏本地的功能上收税，而它的受益面无法度量。

决策：保留 Web 入口，但它不再是设计约束。新功能不为 vscode.dev 让路；需要 Node 能力的功能显式降级，而不是靠扩写 shim 层硬撑。

由此推出 **不采用 ESM 入口**。1.100 起 Node 宿主支持 ESM，但 web worker 宿主至今不支持 —— 上 ESM 等于删掉 Web 版。而它带来的能力接近零：ESM-only 依赖（`file-type@22`、`mermaid@12`）在 esbuild 打包时本来就会被转成 CJS 输出，官方 bundling 示例至今仍写 `format: 'cjs'`。

## Considered Options

- **彻底砍掉 `browser` 入口**：干净，但丢掉 vscode.dev 这个差异化；而且砍掉并不减少多少现有代码。
- **维持"Web 版是一等公民"**：说服力不足——没有证据表明用户主要在浏览器里用它，但每个新功能都要为此付设计成本。
- **本决策**：入口保留、约束解除。

## Consequences

- `src/shims/` 不再扩张；新代码可以只面向 Node。
- 同类"现代化"提案不再需要逐个重新论证，直接引用本条即可：
  - **ESLint 10**：flat config 生态跟进情况未知，收益为零，拒。
  - **更换 bundler（rolldown / tsdown / 把宿主也交给 Vite）**：官方文档的首选就是 esbuild，双轨（Vite 包 webview、esbuild 包宿主）分工明确，拒。
  - **`@vscode/webview-ui-toolkit`**：2025-01 废弃、仓库已归档；官方现只给"原生 HTML + `--vscode-*` CSS 变量"。本项目用 antd，不走它，也不需要替代品。
  - **替换 React / 替换 Vite**：没有理由。
- 判断口径沿用这次审计定下的三条：升级后现有闸门能否发现它出问题、能否一个 commit 单独回退、它走的是不是官方在走的路径。三条缺一条就进"不追"。
