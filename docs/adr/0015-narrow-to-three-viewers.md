---
status: accepted
---

# 范围收窄：只保留三个真正会用的格式

6.0.0 之前，这个扩展继承了一整套「什么都能看」的格式清单：Word、PowerPoint、PDF、ePub、
字体、图片、PSD、ICNS、XMind、HTML、Java `.class`、压缩包。维护者实际打开过的只有三种：
表格（`.xls/.xlsx/.xlsm/.csv/.tsv/.ods`）、parquet、JSONL。

其余格式全部删除。理由不是「它们不好」，而是**每一个都在替别人维护一份更差的实现**：

- **原生已够用**：图片与 SVG 交给 VS Code 内置预览（ADR-0014 已删 SVG）。
- **有更好的专用阅读器**：PDF、ePub、PSD、字体、压缩包在各自领域都有成熟客户端；
  Word/PowerPoint 有 Office 与网页版。
- **维护面与使用面不成比例**：11 个格式带来了 `@docx-editor.dev/react`、`pptxviewjs`、
  `epubjs`、`ag-psd`、`mind-elixir`、`opentype.js`、`7z-wasm`、`node-unrar-js`、`tar`、
  `@zip.js/zip.js`、`@cantoo/pdf-lib`、`heic2any`、`utif2`、`react-image-gallery` 等
  一长串依赖，以及 5.66 MB 的 pdf.js 副本、1.4 MB 的 Java 反编译器、一个 334 KB 的
  woff2 解码器；其中大部分没有任何单测，只有 mount 级 smoke。

保留的三个格式都有真实工作流支撑，并且**不再扩展**：新增格式必须能说出「原生没有、且我
每周都在开」的理由（ADR-0014 的 `Native preview` 判据）。

## Considered Options

- **继续保留但只做只读**：仍然要维护 11 个格式的解析器、依赖与升级面；「只读」省不下依赖。
- **按需安装成独立扩展**：拆成多个扩展是更彻底的做法，但会带来 3 个发布流水线与 3 份
  webview 构建；在只有一个人维护的前提下，维护成本高于收益。
- **全部删到只剩好用的三个**：本 ADR。

## Consequences

- `contributes.customEditors` 从 8 个 viewType 降到 3 个（office/excel、parquet、jsonl），
  `filenamePattern` 从 62 条降到 12 条。
- 删除 7 个 React 视图目录、6 个 provider、压缩包/HTML 的服务层、`resource/pdf`（5.66 MB）、
  `resource/java-decompiler.jar`（1.4 MB）、`public/`（334 KB）与 17 个运行时依赖。
- CSP 相应收窄：`'wasm-unsafe-eval'`、`frame-src`、`media-src`、`worker-src` 全部移除；
  `webview-csp.test.ts` 里改成「这些指令必须不存在」，防止它们悄悄回来。
- **没有删除的**：Git 历史（不是格式预览）、YAML/XML 语言服务（不是预览、也不是写操作）、
  图标主题（展示层）。这三块与格式去留无关，若要再收窄应另开 ADR。
- 6.0.0 的 CHANGELOG 必须把每个被删格式逐条列出；三份 README 的格式清单重写为三项。
