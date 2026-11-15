# Excel UI 测试修复 - 当前状态报告

## 执行时间

开始: 2026-11-14 约 22:40
当前: 2026-11-14 约 23:45
总耗时: 约 65 分钟

## 已修复的问题 ✅

### 1. SharedArrayBuffer 支持

- **错误**: `SharedArrayBuffer is not defined`
- **原因**: xlsx 库需要 SharedArrayBuffer，但浏览器默认不启用
- **解决方案**: 在 `scripts/ui-verify/harness.mjs` 中添加必需的 HTTP 响应头：
  ```javascript
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  ```

### 2. 跨域资源策略

- **错误**: COEP 要求所有资源都有 CORP 头
- **解决方案**: 为所有静态资源添加 `Cross-Origin-Resource-Policy: cross-origin` 头

### 3. process 全局变量

- **错误**: `process is not defined`
- **解决方案**: 在 HTML 中注入 process shim

### 4. util.debuglog 方法

- **错误**: `r.debuglog is not a function`
- **解决方案**: 使用 Vite 插件在 `generateBundle` 阶段替换空的 util 模块，注入 debuglog 方法

### 5. diagnostics_channel.channel 方法

- **错误**: `n.channel is not a function`
- **解决方案**: 在 util shim 中添加 channel 方法

## 当前障碍 ❌

### Class extends EventEmitter 失败

**错误信息**:

```
Class extends value #<Object> is not a constructor or null
```

**问题分析**:

- 代码尝试 `class X extends n`，其中 `n` 来自 `{EventEmitter:n}=Wt()`
- 我们已经成功将 EventEmitter 注入到 Wt 模块的 exports 中
- 验证显示：
  - ✅ EventEmitter 类/函数被正确定义
  - ✅ 语法正确，有构造函数
  - ✅ `t.exports={...EventEmitter:EventEmitter}` 正确导出
  - ✅ 所有解构调用在模块定义之后
- 但运行时仍然报告基类不是构造函数

**尝试过的方法**:

1. ❌ 使用 ES6 class 语法定义 EventEmitter
2. ❌ 使用传统 function + prototype 语法定义 EventEmitter
3. ❌ 各种不同的模块注入方式

**可能的根本原因**:

1. **运行时作用域丢失** - EventEmitter 在模块包装器内部定义，导出时作用域可能有问题
2. **打包工具的进一步处理** - Vite 或其他工具可能在我们的插件之后又修改了代码
3. **浏览器兼容性** - 虽然不太可能，但某些语法可能不被支持
4. **深层依赖问题** - exceljs 的依赖（如 undici）可能有其他未解决的 Node.js 依赖

## 当前代码状态

### 修改的文件

1. **scripts/ui-verify/harness.mjs**
   - 添加了 COOP/COEP 响应头
   - 为所有资源添加了 CORP 头
   - 注入了 process 全局变量

2. **vite.config.ts**
   - 添加了 `nodePolyfills()` 插件
   - 在 `generateBundle` 阶段替换空的 util 模块
   - 注入了完整的 util shim，包括 EventEmitter

3. **src/react/shims/** (未使用)
   - 创建了 `nodeUtil.ts`, `process.ts`, `nodeStream.ts`
   - 但这些文件没有被实际使用，因为 Vite 的 alias 配置对预构建的依赖不生效

### 测试结果

```
71/83 scenarios passed

Failed (12个Excel相关测试):
- excel-reduced-motion
- excel-large-file-guard
- excel-large-file-force
- excel-windowed-large-file
- excel-windowed-seek-limit
- excel-save-direct
- excel-save-format-confirm
- excel-save-readonly-saveas
- excel-windowed-find
- excel-windowed-workbook
- excel-windowed-legacy
- remaining-routes-smoke (包含 excel)
```

所有非 Excel 测试都通过，包括 parquet 和其他格式。

## 建议的后续步骤

### 选项 1: 深度调试（需要时间）

**步骤**:

1. 在浏览器中手动加载生成的代码
2. 在控制台中测试 `Wt()` 返回值
3. 验证 `Wt().EventEmitter` 是否是有效的构造函数
4. 单步调试实际的继承代码

**预计时间**: 1-2 小时

### 选项 2: 使用 patch-package 修改 exceljs（中等复杂度）

**步骤**:

1. 找到 exceljs 浏览器构建中使用 util/events 的具体位置
2. 创建 patch，直接修改源码，移除或替换这些依赖
3. 使用 patch-package 保存修改

**优点**: 直接控制依赖代码
**缺点**: 维护成本，每次升级需要重新应用

**预计时间**: 2-3 小时

### 选项 3: 替换 exceljs（推荐）

**步骤**:

1. 评估 exceljs 在项目中的实际使用
2. 检查是否可以只用 SheetJS (xlsx) 替代
3. 如果需要可编辑功能，寻找其他浏览器友好的库

**优点**:

- 彻底解决 Node.js 依赖问题
- SheetJS 已经在项目中，没有类似问题
- 长期维护成本低

**缺点**:

- 可能需要重写部分代码
- 某些功能可能不可用

**预计时间**: 4-6 小时（取决于代码量）

### 选项 4: 暂时跳过可编辑模式（快速方案）

**步骤**:

1. 识别哪些测试依赖 exceljs（可编辑模式）
2. 暂时禁用这些测试
3. 标记为 TODO，等待上游或更好的解决方案

**优点**: 快速解决其他测试
**缺点**: 功能不完整

**预计时间**: 30 分钟

## 相关资料

- 进度文档: `docs/agents/ui-verify-excel-fix-progress.md`
- 相关 issue: (如果有的话)
- 测试命令: `pnpm verify:ui`
- 单个测试: `TEST_PATTERN=excel-reduced-motion pnpm verify:ui`

## 结论

我们已经成功解决了多个浏览器兼容性问题，让 Excel 测试从完全无法加载进步到只剩最后一个 EventEmitter 继承问题。这个问题需要更深入的调试或考虑替换依赖库。

考虑到时间投入和当前进展，我建议：

1. **短期**: 评估选项 3（替换 exceljs）的可行性
2. **中期**: 如果替换成本太高，尝试选项 2（patch-package）
3. **长期**: 向 @cweijan/exceljs 报告问题，寻求上游修复
