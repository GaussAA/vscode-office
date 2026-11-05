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

**Session（会话）**:
一个 viewer 与 host 之间、跨多次消息存活的唯一状态所有者（`ParquetSession`、`JsonlSession`）。它既不认识 React 也不认识 `vscode`；组件只通过它读写状态，因此分页、预取、过期保护可以被单元测试直接覆盖。
_Avoid_: store, state（太泛，且暗示全局单例）

**Byte source（字节来源）**:
打开文件时选定的读取原语（`fileByteSource` 走 `fs`，`memoryByteSource` 走内存副本），决定这个文件是「按窗口读」还是「整份在内存」。JSONL 与 parquet 共用这层抽象。
_Avoid_: loader, reader（本仓库的 reader 指解析器）

**Provider glue（provider 胶水层）**:
host 侧把 webview 消息翻译成 service 调用、再把结果发回去的那一层（`src/provider/*.ts`）。它应当只做翻译，不含业务规则；`openByteSource` 的 scheme 分支是它唯一的选择逻辑。
_Avoid_: 把解析或状态放进 provider

**Entry kind（条目种类）**:
一条 JSONL 记录的四种互斥状态：`empty` / `invalid` / `too-large` / `value`。它是判别联合的判别式，不是一组布尔标记；这个判断只在一处做出。
_Avoid_: flags, status

**Node model（节点模型）**:
JSONL 详情树的纯数据表示（`NodeModel` / `EntryModel`）：不含 JSX，也不含 antd。渲染由唯一适配器 `toAntdNodes` 承担，深度、宽度、截断与换行都在模型里决定。
_Avoid_: tree data（那是 antd 的类型名，指的不是这一层）

**Highlight run（高亮片段）**:
搜索命中切分后的文本片段，带 `hit` 标记。两个视图共用一个切分函数；各自只决定用哪个 `<mark>` 类名。
_Avoid_: match, span

**Typecheck baseline（类型闸门基线）**:
`scripts/typecheck-baseline.json` 里记录的已知类型错误，只许减不许增。它现在是空的，所以规则退化为：任何类型错误都会让 `pnpm check` 失败。
_Avoid_: whitelist（它曾经是白名单；现在只是一个已清空的棘轮）

**Platform baseline（平台基线）**:
扩展对外承诺的宿主下限，与它编译时实际使用的类型定义，构成的整体：`engines.vscode`、`@types/vscode`、`@types/node` 三者必须互相自洽。它回答的唯一问题是「我们敢用哪些 API」，不是三个可以各自漂移的版本号——一旦 `engines` 落后于 `@types`，编译通过就只是假象。
_Avoid_: 引擎版本、最低支持版本（只提 `engines` 会掩盖另外两项）

**Upstream（上游）**:
我们 fork 的来源仓库 `cweijan/vscode-office`。它是**只读参考资料**，不是合并来源：需要上游的修复时读它的 diff 自己重写（见 [ADR-0002](./docs/adr/0002-independent-evolution.md)）。
_Avoid_: 原版, 官方, 作者版；也别说「合并上游」
