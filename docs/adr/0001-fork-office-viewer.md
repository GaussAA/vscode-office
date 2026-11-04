---
status: accepted
---

# Fork cweijan/vscode-office 而不是新建 slim 扩展

我们 fork [cweijan/vscode-office](https://github.com/cweijan/vscode-office)（MIT）并在其上继续开发，而不是新建一个只做 parquet 的瘦扩展。真正要保留的不是「一个 parquet 视图」，而是**整套已支持的格式与它们各自的预览面**，只有 fork 能不丢这些；同时上游已经把 custom editor 注册、Vite 构建、webview 与 extension host 的接线搭好，于是修 zstd、加 JSONL viewer 都成了局部改动，而重新搭地基等于把最贵的交互与视觉细节重做一遍。

## Considered Options

- **新建 slim 扩展、只移植 parquet 视图**：体积可压到 2 MB 以内，但会丢掉 CSV/XLSX/DOCX/PDF/Markdown/压缩包等全部现有预览——用户明确要求保留。
- **从零自研 UI**：完全可控，但违背「喜欢它现有的预览方式」这一首要约束。
- **改用 battlecook.omni-viewer**：已支持 zstd 且同为 MIT，但预览面不是我们想要的形态，且不可定制。

## Consequences

- 与上游是**长期分叉**，需定期 `merge upstream/main`。因此头几笔提交不得改写上游文件，上游文件也不纳入自动格式化；否则每次合并都会付出巨额冲突。
- 一并继承上游 70 个运行时依赖与约 40 MB 安装体积，可后续再裁剪，不阻塞第一版。
- 上游的 telemetry 指向作者自己的 Azure App Insights，必须摘除，否则我们的使用数据会流进他人账号。
- 扩展身份必须改（新 publisher/name）：沿用原 ID 会直接覆盖本机已装的原版。
- 上游代码风格（4 空格、单引号）与本仓库 prettier 配置（2 空格、双引号）冲突，导入时必须绕过格式化钩子。
