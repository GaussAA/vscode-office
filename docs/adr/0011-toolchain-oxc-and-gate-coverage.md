---
status: accepted
---

# 工具链：押 pre-GA 的 Oxc，并把闸门覆盖面补到 `.js` 与 `test/`

这个仓库已经押过两次 pre-GA：TypeScript 7（Go 原生 `tsgo`）与 oxlint。两次都成立，因为它们各自有一条硬理由 —— TS 7 让「整个 `src` 一次类型检查」在秒级完成，oxlint 不依赖 `typescript` 包从而解开了 TS 7 的 peer 锁。这条判据继续用，写成三条可检验的形状：

1. 上游有公开仓库与发布节奏，不是一次性个人项目；
2. 坏了能一个 commit 回退；
3. 现有闸门能发现它出错。

三条都满足就上，不看是否 GA。

按此逐条判决：

| 决定                              | 判决                   | 依据                                                                                                                                                                                                                                                             |
| --------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prettier → **`oxfmt`**            | 上                     | `vite@8.3.6` 自己的 `package.json` 就是 `"lint": "oxlint src", "format": "oxfmt"`；Less/CSS/JSON/YAML/Markdown 原生支持，默认读 `.prettierignore`，`--migrate=prettier` 一次性迁移。仍是 0.x、无 semver 承诺 —— 记在案                                           |
| **`oxlint --type-aware`**         | 上（已进 `pnpm lint`） | oxlint-tsgolint 实现了 61 条 typescript-eslint 类型感知规则里的 59 条，且不依赖 `typescript` 包。首轮跑出 50 条发现，全部修完后接进闸门 —— 不做基线，理由同 `typecheck`。它仍被列在 _Features Not Subject to Semver_，所以**只作加法信号，不许替代 `typecheck`** |
| 手搓 esbuild 测试打包 → **`tsx`** | 上                     | 实测：`tsx --test` 能从 `tsconfig.json` 的 `paths` 解析 `@/`，`node:test` 的 `.ts` 测试直接跑绿。Node 24 原生剥离被否决（9 个 `enum`、26 处 parameter properties、100 个 `@/` 别名，且 Node 完全忽略 `tsconfig`）                                                |
| 手搓 CDP → **`puppeteer-core`**   | 上                     | 它**本来就是运行时依赖**（`html-export.js` 用它导出 PDF），`@puppeteer/browsers` 还带着 `computeSystemExecutablePath()`。而 `cdp.mjs` 的文件头写着「不引入 puppeteer 因为仓库不需要 Chrome」—— 这句话从第一天就是假的                                            |
| `typecheck.mjs` 的正则解析 → 换掉 | **换不掉，给它加自证** | TS 7 没有 JSON 诊断（`tsc --json` → `TS5023`），唯一结构化出口是 `typescript/unstable/sync`，明确标 unstable。既然被迫解析文本，就用 `--self-test` 注入一个已知类型错误并断言闸门变红                                                                            |

同时补两个**闸门盲区** —— 这是比换工具更重要的一半：

- **`src/**/*.js`**：`tsconfig.json` 的 `include` 只有 `src/**/*.ts` 与 `*.tsx`，`oxlint` 的 `ignorePatterns` 又把 `src/**/*.js` 整段排除（当年排除的理由是「那底下是 vendored 代码」）。但里面有 **8 个属于我们自己的手写模块**（`markdown-pdf.js`、`html-export.js`、`outline.js`、`yamlProperties.js`、`ext/markdown-it-*.js` ×4，43.6 KB），加上 `resource/markdown/` 的 6 个 webview 脚本（27.6 KB）。mermaid 12 把 `parse()` 改成异步、让 `try/catch` 从此永不命中的那次静默回归，正好落在这个洞里。修法：属于我们的转成 `.ts`，真正 vendored 的继续排除。

**`oxlint --type-aware` 首轮 50 条的处置**（已完成）：9 条 `no-base-to-string` 是**真 bug** —— `String(value)` 在 `unknown` 上会把对象渲染成 `[object Object]`，抽出 `src/common/displayText.ts` 的 `toDisplayText()` 统一收口（含循环引用与 Date 的处理），配 5 条单测；24 条 `no-floating-promises` 全部落在事件处理器与 effect 里，加 `void` 并保持仓库既有写法；其余是 `await` 非 Promise、多余的类型联合、无用的默认值、无用的 `void`、测试里的隐式 eval 与缺 `sort` 比较器，逐条修掉。**没有建基线。**

- **`test/`**：`oxlint` 只扫 `src`，`tsconfig` 只收 `src`。也就是说**用来看守一切的 14 个测试文件本身没有任何东西看守**。修法：测试随 `tsx` 迁移一起改成 `.ts`，并把 `test/**/*.ts` 加进两处覆盖面。

## Considered Options

- **只换工具，不补覆盖面**：那这次换来的只是更快的 lint 和更快的格式化，而两个已经造成过真实回归的盲区仍然开着。
- **用 `oxlint --type-check` 取代 `typecheck.mjs`**：它包含 tsc 诊断，但被明确排除在 semver 之外，而且 fail-closed 的棘轮基线（错误按「文件 + 错误码 + 消息」比对，只许减）在它上面没有等价物。
- **`.js` 全部删掉重写**：8 个模块里有两个是 mermaid 12 的补丁，重写等于重做一遍刚修完的 bug。转 `.ts` 是零行为变化的。

## Consequences

- `src/` 会经历**一次全量 reformat**（`oxfmt` 的 `printWidth` 默认 100，而仓库现在是 4 空格/单引号的上游风格）。那一个 commit 用 `.git-blame-ignore-revs` 挡在 blame 之外，并单独提交。
- 「闸门覆盖什么」从隐式约定变成显式清单：`src/**/*.{ts,tsx}` + 我们自己的 `.js`（转 `.ts` 后）+ `test/**/*.ts`。今后新增代码的默认位置就在覆盖面内。
- `pnpm test` 从「先 esbuild 打包再跑 `out/`」变成「直接 `tsx --test "test/unit/*.test.ts"`」，`scripts/unit-tests/build.mjs` 与 `test/support/vscode-stub.ts` 一并删除。

## 事后记录（D9a 落地时）

`tsx` 能用的真正前提不是装个包，而是**两个结构问题**：

1. **`.ts` 得真的是 ESM** —— 否则 tsx 按 CJS 处理，默认导出多包一层。这是 ADR-0012 那一步。
2. **测试要导入的模块不能依赖 `vscode`** —— 先前靠 esbuild 的 `alias` 顶替。追下去发现
   `markdown-pdf.ts` 只是拿 `Uri.file()` 取 `fsPath` 当标题，而这个模块真正需要的目录
   （`out/template`、`out/styles`、`resource/markdown/...`）本来就应该由调用方给。
   把 `__dirname` 换成显式传入的 `extensionRoot`（来自 `ExtensionContext.extensionPath`），
   `vscode` 依赖和 `__dirname` 一起消失，测试也就再不需要 stub 了。

`out/unit-tests/` 那层预打包也随之删除：140 条测试现在直接导入 `src/**/*.ts`。
`test/unit/*.test.ts` 仍不进 `tsconfig` 的 `include`（进去会带出 131 条 `noImplicitAny`），
所以 `typecheck` 不覆盖它们 —— 这与之前的 `.mjs` 状态一致，属于已知的下一步，不是回退。
