# 从 4.x 升级到 5.0.0

5.0.0 是**破坏性版本**：它删掉三个功能，并把平台下限抬到 VS Code 1.125。这份文档说明
每一处变化对你的实际影响，以及需要你动手做什么。绝大多数人可以不改任何东西就升级完，
但下面几项会**静默**改变行为，值得先读一遍。

## 一句话版本

- 你的 **`.http` 文件**不再由这个扩展打开 —— 装 [REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client)。
- **AI Polish** 从 Markdown 编辑器右键菜单消失，扩展不再具备任何对外发起请求的能力。
- 你选过的 **Office 主题** 会被 VS Code 回落到默认主题，需要重新选一个内置主题。
- **VS Code 必须 ≥ 1.125**；更低版本不会再收到更新。

## 1. 平台：VS Code 1.125+（宿主 Node 24）

`engines.vscode` 从 `^1.100` 抬到 `^1.125`。理由不是"想用新 API"，而是这个区间是宿主
自带 **Node 24** 的那档 —— 而我们每一个运行时依赖（`puppeteer-core`、`highlight.js`、
`katex`、`vscode-html-to-docx`、`@cantoo/pdf-lib`）的 `engines.node` 都必须被宿主满足。

这条现在由闸门守着：`pnpm check:baseline` 会求交所有依赖的 `engines.node` 与 `engines.vscode`
推出的宿主 Node 版本，不满足就让构建失败。所以下限不会再次悄悄漂移。

**你要做的**：把 VS Code 升到 1.125 或更新。低于 1.125 的版本会停在 4.4.1，不再收到更新。

## 2. HTTP client 移除（`.http` / `.rest`）

发送请求的整套东西都删了：custom editor、补全与诊断提供者、请求执行器，以及
`activationEvents` 里的 `onLanguage:http`。

**为什么**：它只是恰好装进同一个扩展的另一个功能，[REST Client](https://github.com/Huachao/vscode-restclient)
做得更完整；而它是这个扩展唯一需要自带一套语言服务栈的理由 —— 那是几千行和一批依赖。

**你要做的**：

1. 如果你用 `.http` 文件，先装 REST Client，再在文件上右键 **Reopen Editor With…** 选它。
   你的 `.http` 文件本身不会被改动。
2. 如果 `.http` 文件现在被当纯文本打开，那正是预期行为。

## 3. AI Polish 移除

Markdown 编辑器右键菜单里的 **AI Polish** 项、以及它背后整套 OpenAI / Anthropic / Gemini /
自定义 HTTP 的流式客户端都删除了。

这个功能做了一件当时没有显式声明的事：把**整篇文档正文**发到 webview 里填的一个端点，
密钥也保存在 webview 里。`package.json` 从头到尾没有 AI 相关的设置项。

**你要做的**：不需要做什么。如果你需要 AI 改写 Markdown，用编辑器自带的 Copilot Chat ——
它对谁在读你的文件、发到哪里、保留多久有明确说明。

## 4. 语法主题与配色主题移除

- 五套语法主题（`Office Dark`、`Office Light`、`One Dark Pro` 等）删除。
- 两套配色主题（`Office Material Icon Theme`、`One Dark Modern`）删除。
- 图标主题从 1,263 个图标减到 26 个。

**为什么**：一个文档预览扩展附带完整配色主题没有道理，而图标集是 6 MB 的文件。

**你要做的**：如果 `workbench.colorTheme` / `workbench.iconTheme` 还指着被删的主题，
VS Code 会回落到默认主题 —— 打开 **Preferences: Color Theme** 重新选一个即可。图标主题同理。
这不会影响文件预览的任何功能。

## 5. Web 扩展宿主支持移除

`browser` 入口、`src/shims/` 兼容层、`--target web` 构建全部删除。

**对你的影响**：在 vscode.dev / github.dev 这类纯 Web 环境里，这个扩展不再安装、也不再
promise 任何能力。原因很直接：parquet（WASM）、office 文档、Git History 这些都需要真实
文件系统与 Node 运行时，Web 版从来就没有真正工作过。

## 6. 顺手修掉的一个 bug

Git History 里的 **"在浏览器打开远程仓库"** 以前**每次都失败**：它用
`await import("vscode")`，而扩展宿主是通过 CommonJS 注入 `vscode` 模块的，ESM 加载器不认。
报错被当成字符串显示在界面上。现在正常了。

---

## 从 5.0.0 起你还能指望的东西

- 每次改动都能单独回退：每个提交只做一件事，`git log` 是一条可读的线。
- 闸门不会自己变绿：`pnpm check` 是 fail-closed 的（零类型错误、零 lint 问题、零格式差异），
  并且 `typecheck --self-test` 会**注入一个已知错误**来证明闸门真的会红。
- 平台下限不会漂移：`check:baseline` 求交每个运行时依赖的 `engines.node`。

细节见 [CHANGELOG.md](../CHANGELOG.md) 与 `docs/adr/`。
