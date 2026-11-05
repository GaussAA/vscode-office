---
status: accepted
---

# 平台基线：三件套互相自洽，并由 CI 断言

`engines.vscode` 停在 `^1.64.0`（VS Code 2022-02，宿主 Node 14.16 / Chromium 91），而 `@types/vscode` 因为 caret 范围被解析到 1.144.0、`@types/node` 声明 `^26.1.0`（任何 VS Code 都不存在的 Node）。三者各自看着有理，合起来的效果是：**按 2026 年的 API 过类型检查、对外承诺 2022 年的宿主、而 vsce 只比对声明字符串的 major.minor 所以不会拦你**。这不是"保守"，它在语法层面已经无法兑现 —— Chromium 91 没有 `:has()` 与 CSS 嵌套，Node 14.16 没有 `structuredClone` / `fetch` / `node:` 前缀。

决策：`engines.vscode` 与 `@types/vscode` 提升到同一 major.minor，`@types/node` 降到宿主真实 Node 的 major，三条不等式由脚本在 CI 断言，任何漂移都让 `pnpm check` 失败。副作用是白捡的：`engines >= 1.74` 之后 `activationEvents` 可以整体交给 `contributes` 隐式激活。

## Considered Options

- **保持 `^1.64.0`，把 `@types/vscode` 反向锁到 1.64**：不说谎，但等于为一个已经不存在的用户群永久放弃两代 API，且 `target: es2019` 的自我限制继续存在。
- **跟随最新（`^1.145.0`）**：只服务刚更新过的用户，且每次 VS Code 发版都要跟一次，把"基线"变成"追版本"。
- **本决策**：钉在一个真实测试过的下限上，用它定义"敢用哪些 API"。

## Consequences

- 基线的具体数字不写进词汇表也不写进 ADR 正文，只写进 `package.json`；它属于会变的事实，不属于决策。参见 [GLOSSARY](../../GLOSSARY.md) 的 **Platform baseline（平台基线）**。
- **删除 `activationEvents` 不是删一行**：`activateGitHistory` 在激活时同时做三件事 —— 创建状态栏条目 `$(git-commit) Git`、注册 `WebviewPanelSerializer`、启动 `repoDiscovery.discover()` 扫仓库。不激活则状态栏不出现、Git History 面板在窗口重载后无法恢复。需要保留最小激活事件（`onWebviewPanel:`）并接受状态栏"首次激活后出现"的时序，不能简单删行。
- 抬基线之后 `tsconfig` 的 `target: es2019` / `lib: [es6, es2017, es2019]` 不再有保护价值，可以提到 ES2022。
- 因为闸门是 fail-closed 的（`scripts/typecheck.mjs`），基线变更会被类型错误直接暴露，这正是它可信的原因。
