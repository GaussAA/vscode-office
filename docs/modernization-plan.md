# 现代化改造清单

这份清单来自 2026-11 的一次技术栈审计（依赖新鲜度 + VS Code 平台最佳实践 + 源码核对），按 [ADR-0002](adr/0002-independent-evolution.md) 的纪律拆成**可单独回退**的步骤。每条一行提交；顺序即执行顺序。

Issues 已同步到 [GaussAA/vscode-office #5](https://github.com/GaussAA/vscode-office/issues/5)（tracking），T01–T19 对应 #6–#24，父子关系与 blocked-by 已用 GitHub 原生依赖记录。

## 判据

一条升级进入清单，必须回答三个问题；缺一条就进 ADR-0004 的"不追"清单：

1. **升级后现有闸门能发现它出问题吗**（`pnpm lint` / `typecheck` / `test` / `verify:ui`，以及本清单新增的 smoke）？
2. **它能不能一个 commit 单独回退**？
3. **它走的是官方在走的路径吗**（不是某个人独有的实验）？

## 顺序

| # | Issue | 任务 | 依赖 | 为什么单独一步 |
|---|---|---|---|---|
| T01 | [#6](https://github.com/GaussAA/vscode-office/issues/6) | 新增 release workflow，发布改 OIDC 受信发布 | — | **硬截止 2026-12-01**：Marketplace PAT 退役。现有 CI 只上传 vsix artifact，从不发布 |
| T02 | [#7](https://github.com/GaussAA/vscode-office/issues/7) | 新建 `@vscode/test-cli` smoke 层 | — | T03–T06 的失败模式只在真实宿主里显现 |
| T03 | [#8](https://github.com/GaussAA/vscode-office/issues/8) | 平台基线三件套对齐 + CI 断言 | T02 | 见 [ADR-0003](adr/0003-platform-baseline.md) |
| T04 | [#9](https://github.com/GaussAA/vscode-office/issues/9) | 删除 `activationEvents: onStartupFinished` | T03 | 需要 `engines >= 1.74` 才允许隐式激活 |
| T05 | [#10](https://github.com/GaussAA/vscode-office/issues/10) | webview 补 CSP + HTML 预览改沙箱 | T02 | 当前把用户 HTML 直接塞进扩展 origin |
| T06 | [#11](https://github.com/GaussAA/vscode-office/issues/11) | `supportsMultipleEditorsPerDocument: true` | T02 | 一行，但改变同文档多编辑器的行为 |
| T07 | [#12](https://github.com/GaussAA/vscode-office/issues/12) | `tsconfig` 收敛：`target/lib` → ES2022，单一 check 配置 | T03 | 基线抬升后 es2019 不再有保护价值 |
| T08 | [#13](https://github.com/GaussAA/vscode-office/issues/13) | `vditor/` 收编为 pnpm workspace 包 + 构建拆出 | — | 让"这块代码依赖什么"重新可计算 |
| T09 | [#14](https://github.com/GaussAA/vscode-office/issues/14) | 清理真正无引用的依赖 | T08 | 先让依赖可见，再判断谁没用 |
| T10 | [#15](https://github.com/GaussAA/vscode-office/issues/15) | 安全升级批（`iconv-lite` / `katex` / `node-html-parser` / vite patch） | — | 无 API 变化，一次做完 |
| T11 | [#16](https://github.com/GaussAA/vscode-office/issues/16) | `xlsx` → SheetJS 官方自托管 tarball | T05 | 排在 CSP 之后：两者是同一条攻击链的两段 |
| T12 | [#17](https://github.com/GaussAA/vscode-office/issues/17) | `@eigenpal/docx-editor-react` → `@docx-editor.dev/react` | — | 渠道废弃，作者已换包名 |
| T13 | [#18](https://github.com/GaussAA/vscode-office/issues/18) | TypeScript 7 + 闸门自证 | T02 | 单独一步，否则错误来源混杂 |
| T14 | [#19](https://github.com/GaussAA/vscode-office/issues/19) | `strictNullChecks` | T13 | 收益最大、噪声最大的一个 |
| T15 | [#20](https://github.com/GaussAA/vscode-office/issues/20) | 其余 strict 家族 | T14 | 小步跟上，每条可回退 |
| T16 | [#21](https://github.com/GaussAA/vscode-office/issues/21) | 去全局 `retainContextWhenHidden` | T02 | 改 `getState/setState`，行为面明显 |
| T17 | [#22](https://github.com/GaussAA/vscode-office/issues/22) | `antd` 6 + `@ant-design/icons` 6 | T06 | 主题/token 重做，26 处引用 |
| T18 | [#23](https://github.com/GaussAA/vscode-office/issues/23) | `markdown-it` 15 / `mermaid` 12 / `file-type` 22 | T16 | 三个 ESM-only，各自独立 |
| T19 | [#24](https://github.com/GaussAA/vscode-office/issues/24) | i18n 扩展侧迁 `vscode.l10n` | — | 收益上限是"一半"，排最后 |

## 陷阱

**T01 — 发布链路目前完全不在 CI 里。** [main.yml](../.github/workflows/main.yml) 只做 `check` / `build` / `verify:ui` / `package` 然后上传 artifact；真正发到市场靠本地 `pnpm publish`（`vsce publish && ovsx publish`）。改 OIDC 要同时做三件事：workflow 加 `permissions: id-token: write`、publisher 侧配置 Trusted Publishing、把 `ovsx` 留在 token 路径上（Open VSX 不参与这次退役）。顺便把 CI 的 `node-version: 22.x` 与本地的 24 对齐 —— 它会影响 T03 那条 `@types/node` 的断言。

**T04 — 删 `activationEvents` 不是删一行。** `activateGitHistory` 在激活时同时做三件事：创建状态栏条目 `$(git-commit) Git`、注册 `WebviewPanelSerializer`、跑 `repoDiscovery.discover()` 扫 git 仓库。前两件不激活就不发生。保留最小激活集合（`onWebviewPanel:` 覆盖面板恢复），状态栏接受"首次激活后出现"的时序 —— 或者把状态栏也改成懒创建。第三件（启动扫描）删掉本身是收益。

**T05 — CSP 不能做成最严。** 三个约束：antd 5 是 CSS-in-JS，运行时注入 `<style>`，`style-src` 必须留 `'unsafe-inline'`；EPUB 走 iframe，需要 `frame-src`；`localResourceRoots` 目前把文档所在目录整个暴露，要收窄。

更严重的是 [htmlService.ts](../src/service/htmlService.ts)：它把**用户 HTML 文件的内容直接赋给 `webview.html`**，且 `enableScripts: true`。1.73 起 webview origin 按「扩展 + viewType」稳定复用，localStorage 在实例间共享 —— 恶意 HTML 可以读写其他 viewer 的缓存。修法不是 CSP，而是外层壳 + `<iframe sandbox="allow-scripts" srcdoc=...>`，让脚本跑在隔离 origin。

**T08/T09 — 依赖审计报告在这件事上是错的。** `diff-match-patch`、`codemirror-lang-latex`、`codemirror-lang-mermaid` 被 `vditor/src/ts/*` 真实 import，而 `pnpm build` 会把 `vditor/` 当嵌套 Vite 项目重编一遍（见 [vite/vditorPlugin.ts](../vite/vditorPlugin.ts)）。它们之所以看起来"零引用"，是因为 `vditor/package.json` 里 `dependencies` 是空的，靠 root manifest 喂。真正无引用的只有 `save-svg-as-png`（只在 vditor 的旧 dist 产物里出现）。**先做 T08，再相信任何"死依赖"的判断。**

**T11 — 先验证再迁移。** OSV 里 CVE-2023-30533 / CVE-2024-22363 的 `fixed_in` 为空，SheetJS 自己的发布说明称修复在 0.19.3 / 0.20.2。迁移前按官方公告逐条确认，`pnpm` 会把 tarball 的 integrity 锁进 lockfile。

**T13 — 闸门可能静默变绿。** [scripts/typecheck.mjs](../scripts/typecheck.mjs) 用正则 `^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$` 解析 tsc 的**文本输出**。TS 7 换了实现，输出格式若偏移，正则匹配不到任何错误 → `errors` 为空 → 若 tsc 恰好退出码为 0，闸门静默通过。切换后**立刻故意注入一个类型错误，确认 `pnpm typecheck` 真的会红**，这条验证比切换本身重要。

**T16 — 去掉 `retainContextWhenHidden` 之后**，webview 状态只能靠 `getState/setState`。而 origin 是稳定复用的，`localStorage` 必须按文档 URI 分区，且不得存放关键数据。

## 完成定义

`pnpm check:full` 全绿，且新增的 smoke 层在 T03 的基线上跑通。smoke 本身也要被验证一次：故意让一个 viewer mount 失败，确认它会红 —— 否则新加的闸门和 TS 7 之前的类型闸门一样，只是看起来守着。

## 不在本清单内

见 [ADR-0004](adr/0004-web-extension-best-effort.md)：ESM 入口、ESLint 10、更换 bundler、`@vscode/webview-ui-toolkit`、替换 React。这些不需要逐个重新论证。
