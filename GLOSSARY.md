# Office Viewer fork

我们 fork 自 [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（MIT），在它的基础上继续开发自己的版本。这个上下文管的是：一个文件该由哪个预览面呈现、用什么单元去数它、以及我们与上游的关系。

## Language

**Extension（扩展）**:
一个 VS Code 安装单元，由一个 `publisher.name` 标识。我们只有一个扩展，它是上游的 fork。
_Avoid_: 插件, viewer

**Viewer（视图）**:
扩展内为某一类文件注册的预览入口（一个 `viewType` 加它的文件选择器）。一个扩展有多个 viewer；JSONL 是新增的 viewer，不是新增的扩展。
_Avoid_: 预览器, 面板, 功能

**Preview surface（预览面）**:
某个 viewer 呈现内容的具体形态：树、网格、画布、纯文本。一个 viewer 只给一个形态，形态是选择而不是选项。
_Avoid_: 界面, UI

**Editable surface（可编辑预览面）**:
会把握改的结果写回文件的预览面。parquet viewer 目前是可编辑的；只读预览面不是它的退化版本，而是不同的承诺。
_Avoid_: 编辑器（与 VS Code 自己的 editor 冲突）

**Format（格式）**:
由文件名决定的文件种类（parquet、jsonl、xlsx…），决定用哪个 viewer。
_Avoid_: 把 codec 混进 format

**Codec（压缩编码）**:
parquet 列内部用的压缩算法（SNAPPY、ZSTD、GZIP…）。codec 是格式内部的细节，不是一种格式。
_Avoid_: 把 zstd 说成「一种格式」

**Parquet Row（行）**:
parquet 的一条记录，全部行共享同一 schema。

**JSONL Line（行）**:
jsonl 的一行就是一个自包含的 JSON 文档，键可以与其他行完全不同。它是树的节点，不是表格里的一行；因此「行数」在两个格式里不是同一个概念。
_Avoid_: 把 jsonl 的 line 叫 row，把 jsonl 做成表格

**Upstream（上游）**:
我们 fork 的来源仓库 `cweijan/vscode-office`。合并方向永远是 upstream → 我们，绝不反向。
_Avoid_: 原版, 官方, 作者版
