### 进度（2026-11-06）

D1–D8、D10、D12、D13a 已落地；D9 只剩 `tsx`，D11 还剩可选项，D6 与 D13b 未开始：

| 项                                | 状态   | 说明                                                                                                                                                                                                                      |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1 D2 D3 D4 D5 D7 D8 D10 D12 D13a | 完成   | 见 git log                                                                                                                                                                                                                |
| D9                                | 部分   | `oxfmt`（D10 一并）、`typecheck --self-test`、`puppeteer-core`、`oxlint --type-aware`（首轮 50 条发现全部修完，无基线）、`type: module` + `out/` CJS 作用域（ADR-0012）已完成；**只剩 `tsx`**                             |
| D11                               | 部分   | 已换 9 个：`codemirror`(删)、`node-unrar-js`(归类修正)、`pretty-bytes`、`utif2`、`chrome-launcher`、`date-format`、`pdf-lib`→`@cantoo/pdf-lib`、`markdown-it-checkbox`/`markdown-it-plantuml`/手抄 katex 插件 → `@mdit/*` |
| D6                                | 未开始 | gitHistory 换 `simple-git`                                                                                                                                                                                                |
| D13b                              | 未开始 | katex ×3 / mermaid ×2 / highlight.js ×2 合并，约 4.6 MB                                                                                                                                                                   |

`src/` 里非 vendored 的 `.js` 现在是 **0 个**（`x-spreadsheet/` 下 ~100 个是 vendored CJS，
按 ADR-0009 保持原样）。根 `package.json` 是 `"type": "module"`，`out/` 由构建生成一个
`{"type":"commonjs"}` 的 `package.json` 把扩展宿主的作用域划回去 —— 见
[ADR-0012](adr/0012-module-system-esm-with-cjs-out.md)。
