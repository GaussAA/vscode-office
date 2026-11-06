---
status: accepted
---

# `vendored` 要拆成两个词：拷贝（copy）与分叉（fork）

`NOTICE.md` 原来用「vendored」同时指三件性质完全不同的事，而这个词本身不含判据，于是它导出了错的结论。最典型的一次：把 `src/react/view/excel/x-spreadsheet/` 判成「用 `pnpm patch` 换回 npm 包就能省 12,503 行」—— 实测它相对上游的增量是 **45 个共享文件 +3,178 / −967**，占 11,961 行的 22%。把 4,000 行 diff 做成 patch 文件，只是把「12k 行能读能改的树」换成「4k 行不能直接编辑的补丁」，换不来可读性。

真正的分野是**我们的增量占原项目多大比例**：

- **Vendored copy（拷贝）**：几乎原样搬进来，我们只是宿主。增量远小于原项目。处置：回 npm，或删掉。
- **Fork（分叉）**：我们已经在上面写了大量自己的代码，形成独立演进线。增量与原项目同数量级。处置：认领 —— 登记进 `NOTICE.md`、当自己的代码维护、把「rebase 到上游」冻结为非目标。

按这条重新分类：

| 路径                                          | 增量 / 规模                        | 类别         | 处置                                                      |
| --------------------------------------------- | ---------------------------------- | ------------ | --------------------------------------------------------- |
| `src/service/zip/pretty-bytes/`               | 0%                                 | copy         | 删，用 npm 的 `pretty-bytes`                              |
| `resource/pdf/`（pdf.js 3.1.81）              | 0%                                 | copy         | 换 `pdfjs-dist` 当前版，viewer 只保留我们的注入           |
| `resource/markdown/dist/` 里的 Lute / Mermaid | 0%                                 | copy         | 与 npm 版本对齐（构建产物，gitignored）                   |
| `icons/`                                      | 0%                                 | copy         | 重写成只覆盖我们会渲染的格式的最小集                      |
| `vditor/`                                     | **+12,129 / 27,075 行（45%）**     | fork         | 认领                                                      |
| `src/react/view/excel/x-spreadsheet/`         | **+3,178 / 11,961（22%）**         | fork（边界） | 认领；换引擎另立 ADR                                      |
| `src/provider/http/`                          | 分叉自仍活跃的 `vscode-restclient` | fork         | **删掉整个功能**，见 [ADR-0010](0010-feature-boundary.md) |

## Considered Options

- **继续用一个词，逐例临场判断**：这正是导致上面那次误判的原因。词不承载判据，判断就会漂移。
- **一律回 npm**：对 `vditor/` 不成立 —— 12k 行自研增量没有「薄补丁」的可能，硬做等于把一份可维护的源码换成不可维护的补丁。
- **本决策**：先分类，再按类处置。

## Consequences

- 两个术语进 [GLOSSARY](../../GLOSSARY.md)。今后讨论「这块要不要动」之前，先回答「它是拷贝还是分叉」。
- `NOTICE.md` 的登记范围从 2 条扩到全部 fork 与拷贝。原来 `vditor/`、`resource/pdf`、`icons/`、`theme/`、`syntaxes/`、`public/woff2_decompress_binding.js` 都没登记 —— 那是许可证归属的空白，不只是文档缺失。
- `vditor/` 被认领之后，它的内部质量进入我们的闸门与命名规范；「等上游修」这个选项从讨论中移除。
- 分叉的**上游健康度**与**我们的增量**是两个独立坐标。`vditor` 的上游（`Vanessa219/vditor`）每隔一两周发版、很活跃，但我们的 fork 基座（`vscode-ext-studio/vditor`）自 2026-06 起休眠 —— 所以「上游还活着」不能成为「我们不用管」的理由。
