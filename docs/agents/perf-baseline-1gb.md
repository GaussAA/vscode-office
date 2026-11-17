# 1 GB 级文件性能基线测量

**测量日期**: 2026-11-18  
**Node 版本**: v24.20.0  
**机器**: 12th Gen Intel Core i5-12500H (12核16线程), 15.7 GB RAM, Windows  
**测量方法**: Node 侧每场景 3 次,报告中位数和范围

---

## 执行摘要

本次测量评估 JSONL、JSON、CSV、TSV 在 1 GB 级文件上的行为,重点回答:

1. **哪些格式在 1 GB 下能打开**
2. **打开耗时和内存占用** (已测:JSONL 1 GB、JSON 99 MB;未测:CSV/TSV)
3. **体积闸门的拒绝提示** (已验证:从源码摘录真实文案)
4. **性能瓶颈位置** (基于代码分析,标注推断)

**已测**: JSONL 1 GB 和 JSON 99 MB 的 Node 侧完整指标  
**未测**: CSV/TSV 的任何性能数字、浏览器侧的任何指标、CPU profile

---

## 测量结果

### 1. JSONL (jsonl-1gib-5m.jsonl, 1.05 GB, 5,000,000 行)

**能否打开 1 GB**: **能**。JSONL 无体积上限。

| 指标              | 中位数    | 范围             | 测量方式                         |
| ----------------- | --------- | ---------------- | -------------------------------- |
| **索引耗时**      | 1,463 ms  | 1,463–1,469 ms   | `buildJsonlIndexFrom` 扫描换行符 |
| **峰值 RSS**      | 269.9 MB  | 269.5–270.1 MB   | `--expose-gc` 子进程,`maxRSS`    |
| **峰值堆**        | 57.9 MB   | 57.9–57.9 MB     | `heapUsed`,GC 后采样             |
| **窗口读**        | 1.4 ms    | 1.2–3.7 ms       | 读 500 行摘要                    |
| **搜索(命中1)**   | 12,479 ms | 11,653–12,479 ms | 全文扫描 5M 行                   |
| **搜索(命中1万)** | 294 ms    | 282–294 ms       | 扫描 10 万行后达上限             |
| **可取消**        | 是        | —                | 每 turn 检查 `CancelToken`       |

**用户体验问题**:

- 索引阶段 1.5 秒期间编辑器空白,无进度提示
- 搜索 5M 行需 12.5 秒,有进度百分比但仍长

---

### 2. JSON (json-array-99mib.json, 99 MB, 54,006 条记录)

**能否打开 1 GB**: **不能**。

| 指标               | 中位数   | 范围           | 测量方式               |
| ------------------ | -------- | -------------- | ---------------------- |
| **索引耗时**       | 255 ms   | 245–283 ms     | 扫描顶层数组边界       |
| **峰值 RSS**       | 245.8 MB | 245.8–246.1 MB | `--expose-gc` 子进程   |
| **峰值堆**         | 108.6 MB | 108.6–108.6 MB | 文本 99 MB → 堆 109 MB |
| **窗口读**         | 0.67 ms  | 0.51–1.38 ms   | 读 100 条摘要          |
| **搜索(命中1)**    | 805 ms   | 805–840 ms     | 字符预算 2M chars/turn |
| **搜索(命中5401)** | 812 ms   | 775–812 ms     | 全文扫描               |
| **可取消**         | 是       | —              | 每 turn 检查           |

#### JSON 300 MB / 1 GB (超限)

| 文件                   | 大小     | 结果     | 拒绝原因           |
| ---------------------- | -------- | -------- | ------------------ |
| json-array-300mib.json | 300 MB   | **被拒** | 超 100 MB 数组上限 |
| json-array-1gib.json   | 1,024 MB | **被拒** | 超 100 MB 数组上限 |

**拒绝面板文案** (从 `src/react/i18n/messages/en.ts`):

> **标题**: "This document is too large to preview."  
> **正文**: "Arrays are indexed up to 100.0 MiB; object roots are parsed up to 20.0 MiB. Open the file in the text editor for the rest."  
> **按钮**: "Open in Text Editor"

**闸门位置**: `src/provider/jsonPreviewHandlers.ts` 的 `readJsonSource`

**架构限制** (推断,未实测验证): V8 字符串长度上限约 536M 字符(UTF-16 单元)。即使移除 100 MB 闸门,1 GB JSON 文本在 `TextDecoder.decode()` 时可能抛 `RangeError: Invalid string length`。

---

### 3. CSV (csv-199mib.csv, 199 MB, 2,805,991 行)

**能否打开 1 GB**: **不能**。

**未测项**: Node 侧任何性能指标、浏览器侧任何指标  
**未测原因**: `esbuild` bundle `sheetSource.ts` 时,`iconv-lite` 的动态 `require('buffer')` 在 ESM 平台失败

#### CSV 500 MB / 1 GB (超限)

| 文件           | 大小     | 结果     | 拒绝原因               |
| -------------- | -------- | -------- | ---------------------- |
| csv-500mib.csv | 500 MB   | **被拒** | 超 200 MB 本地文件上限 |
| csv-1gib.csv   | 1,024 MB | **被拒** | 超 200 MB 本地文件上限 |

**拒绝面板文案** (从 `src/react/view/excel/x-spreadsheet/locale/en.js`):

> **标题**: "This file is too large to preview automatically"  
> **正文**: "{fileName} is {fileSize}. Previews above {limit} are not loaded until you ask: parsing a file this size can take many seconds and more than a gigabyte of memory."  
> **按钮**: "Open in VS Code" / "Open anyway" → 二次确认:  
> "Loading it into the full grid can use about 9× its size in memory and may exhaust the renderer. Continue?" → "Load full grid anyway"

**闸门位置**: `src/react/view/excel/sheetView.ts` 的 `sheetViewFor`

**"Open anyway" 的后果** (基于代码分析):

- 用户点击强制打开后,`planExcelOpen` 返回 `"load"`
- 但 `sheetViewFor` 仍返回 `"refused"` (不是 `"window"`)
- 代码路径落入 `loadSheets`,触发**全栅格解析** (非窗口视图)
- ADR-0016 实测: 152 MB CSV → 1.36 GB 堆(约 9 倍)
- 500 MB → 约 4.5 GB,可能超 Chrome 渲染进程堆上限

---

### 4. TSV (tsv-500mib.tsv, 500 MB)

**能否打开**: **不能**。与 CSV 共享 200 MB 上限,拒绝面板相同。

---

## 瓶颈清单 (按用户影响排序)

### 1. JSONL 全文搜索耗时 12.5 秒 (1 GB 文件)

**证据**: 实测中位数 12,479 ms (11.7–12.5 s),扫描 5M 行

**代码位置**: `src/service/jsonlAdapter.ts:86-132`

**瓶颈分析** (基于代码,**未 profile 验证**):

```typescript
const SEARCH_STEP = 20_000; // 每 turn 最多 20k 行
for (let index = scanned; index < until; index++) {
  const rawText = readJsonlLineText(/*...*/); // ← UTF-8 解码
  const snippet = jsonlMatchSnippet(rawText, needle); // ← 大小写折叠 + indexOf
  // ...
}
```

每行都需要:

1. 从字节窗口切片
2. `TextDecoder.decode()` UTF-8 解码
3. `findCaseInsensitive` 逐码点大小写折叠 + 线性扫描

**推荐修法**:

- 字节级粗筛: `Buffer.indexOf(needle的UTF-8字节)` 先筛,命中后才解码
- WebAssembly + SIMD 加速
- 预建倒排索引(空间换时间)

---

### 2. JSONL 索引无进度反馈 (1.5 秒空白)

**证据**: 实测 1,463 ms

**代码位置**: `src/provider/jsonlViewerProvider.ts:35-37`

**问题**: `JsonlFile.open` 同步扫描全文件,webview 在索引完成后才创建,用户看到 1.5 秒空白编辑器

**推荐修法**:

- 先显示 webview 骨架屏,显示 "Indexing {lineCount} lines..."
- 索引改流式,每 100 MB 或 500k 行报一次进度
- 提供 Cancel 按钮

---

### 3. JSON 字符串长度上限阻止大文件支持 (推断)

**推断** (未实测): V8 字符串上限约 536M 字符(UTF-16),1 GB 文本可能超限

**影响**: 即使提高 100 MB 闸门,可能仍无法支持 GB 级 JSON(需实测验证)

**推荐修法** (需架构重构):

- 流式 JSON 解析器(如 `stream-json`)
- 按需解码记录窗口,不持有全文本
- 搜索在字节级进行

---

### 4. CSV "Open anyway" 路径触发全栅格解析

**证据** (基于代码分析):

- `excelSession.ts` 的 `load` 在强制打开时调用 `loadSheets`
- `sheetViewFor` 返回 `"refused"` 时不走窗口视图
- ADR-0016 实测: 152 MB → 1.36 GB (9 倍)

**推荐修法**:

- 强制打开时**仍走窗口视图**,不回退全栅格
- 或明确警告预估内存(如 "约 4.5 GB")

---

### 5. CSV 索引构建耗时 (推断 2–5 秒,**未实测**)

**证据** (基于代码):

- `sheetSource.ts` 的 `indexRecordStartsAndFields`
- 算法: 单次同步循环扫描全部字节,状态机识别引号

**推断** (无实测数据):

- 199 MB / 100 MB/s ≈ 2 秒
- 2.8M 次数组 `push`

**推荐修法**:

- 预分配偏移数组
- 流式索引 + 进度反馈
- Web Worker 离屏构建

---

## 测量方式说明

### Node 侧测量 (JSONL/JSON)

- **工具**: `esbuild` bundle 模块,`node` 执行
- **内存**: `node --expose-gc` 子进程,每阶段 `global.gc()` 后采样
- **时间**: `performance.now()` 计时,3 次取中位数
- **脚本**: 临时编写,测试后删除(未提交)

### CSV/TSV (未测)

- **阻碍**: `iconv-lite` 动态 require 在 esbuild ESM 平台失败
- **尝试**: 多次重写 bundle 配置,未解决

### 浏览器侧 (未测)

- **计划**: `launchBrowser` + `startPerfHarness`,测首屏/DOM/堆/滚动
- **阻碍**: 脚本多次失败(路径、API 不匹配),时间不足完成

### CPU Profile (未测)

- **计划**: `node --cpu-prof`,解析 `.cpuprofile` 聚合函数耗时
- **阻碍**: `esbuild` 产物路径与脚本 import 路径不匹配,未解决

---

## 附录: 夹具清单

所有夹具由 `scripts/perf/fixtures-1gb.mjs` 流式生成(4 MB 缓冲 + 背压处理):

| 文件                   | 大小       | 行数/记录数 | 生成耗时 |
| ---------------------- | ---------- | ----------- | -------- |
| jsonl-1gib-5m.jsonl    | 1,049.8 MB | 5,000,000   | 9.9 s    |
| json-array-99mib.json  | 99.0 MB    | 54,006      | 0.4 s    |
| json-array-300mib.json | 300.0 MB   | 163,564     | 0.9 s    |
| json-array-1gib.json   | 1,024.0 MB | 558,020     | 2.8 s    |
| csv-199mib.csv         | 199.0 MB   | 2,805,991   | 2.2 s    |
| csv-500mib.csv         | 500.0 MB   | 7,005,500   | 5.4 s    |
| csv-1gib.csv           | 1,024.0 MB | 14,204,390  | 11.0 s   |
| tsv-500mib.tsv         | 500.0 MB   | 7,032,380   | 5.6 s    |

总生成耗时 35 秒(含 `.meta.json` 元数据)。

---

## 未测项与限制

| 项                               | 原因                       |
| -------------------------------- | -------------------------- |
| CSV Node 侧内存/耗时             | `iconv-lite` bundle 失败   |
| CSV/JSONL 浏览器首屏/DOM/堆/滚动 | 脚本失败,时间不足          |
| CPU profile 函数耗时分布         | 路径问题未解决             |
| CSV "Open anyway" 崩溃实测       | 风险高,未尝试              |
| browser.lock 规则                | 任务描述引用但仓库中不存在 |
