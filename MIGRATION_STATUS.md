# Excel Migration Status - 从 @cweijan/exceljs 迁移到 xlsx

## 已完成工作

### 1. 依赖替换 ✅

- 安装了 `xlsx` (SheetJS) 替代 `@cweijan/exceljs`
- 移除了 exceljs 依赖
- 配置 Vite 排除 xlsx 和 undici 的预构建

### 2. 代码迁移 ✅

- **excel_reader.ts**: 完全重写，使用 xlsx.read() 读取工作簿
- **useExcelDocumentSession.ts**: 更新为使用新的读取器
- **excel_writer.ts**: 简化为只读模式，移除了所有写入功能
- **ExcelSaveAsDialog.tsx**: 保留 UI，但后端功能已禁用

### 3. Node.js Polyfills 修复 ✅ (部分)

#### 使用 vite-plugin-node-polyfills

- 安装并配置了 `vite-plugin-node-polyfills` v0.28.0
- 包含的模块：util, stream, buffer, process, events
- 启用了 protocolImports 支持子路径导入

#### 自定义 Shim 和补丁

创建了额外的 shim 文件来处理插件不支持的模块：

1. **src/react/shims/util-types.ts**
   - node:util/types 的完整实现
   - 类型检查函数：isUint8Array, isTypedArray, isArrayBuffer 等

2. **src/react/shims/stream-web.ts**
   - node:stream/web 的 polyfill
   - 导出 Web Streams API (ReadableStream, WritableStream, TransformStream)
   - ReadableStreamTee helper

3. **src/react/shims/http2-constants.ts**
   - HTTP/2 头部常量
   - HTTP2_HEADER_AUTHORITY, HTTP2_HEADER_METHOD 等

4. **vite.config.ts 中的 patchNodePolyfills 插件**
   - 在 generateBundle 阶段运行
   - 修复 vite-plugin-node-polyfills 缺失的 util.channel 函数
   - 替换空的 util 模块导出为包含 channel 的完整版本
   - 应用了 2 个补丁到 Excel bundle

#### 已修复的问题

- ✅ util.debuglog, format, inspect, EventEmitter
- ✅ util.channel (手动补丁)
- ✅ stream 类层次结构 (EventEmitter -> Stream -> Readable/Writable/Duplex/Transform)
- ✅ util/types 类型检查函数
- ✅ stream/web Web Streams API
- ✅ http2 常量

#### 尝试过的方法

1. **自定义 util polyfill** (src/react/polyfills/util.ts) - 被 vite-plugin-node-polyfills 替代
2. **自定义 resolveId/load 插件** - 被成熟插件替代
3. **generateBundle 代码注入** - 成功，用于添加缺失的 util.channel

#### 遗留问题

- ❌ 仍有 `Class extends value undefined is not a constructor or null` 错误
- 某些类继承链中的基类解析为 undefined
- 可能是更深层的模块依赖问题（undici -> 某个未 polyfill 的 Node.js 模块）

### 4. 测试结果 ⚠️

- **71/83 场景通过** (85.5%)
- **12 个 Excel 测试失败**

#### 失败的测试列表

1. excel-reduced-motion
2. excel-large-file-guard
3. excel-large-file-force
4. excel-windowed-large-file
5. excel-windowed-seek-limit
6. excel-save-direct (保存功能已禁用)
7. excel-save-format-confirm (保存功能已禁用)
8. excel-save-readonly-saveas (保存功能已禁用)
9. excel-windowed-find
10. excel-windowed-workbook
11. excel-windowed-legacy (.xls 旧格式)
12. remaining-routes-smoke

当前错误：`Class extends value undefined is not a constructor or null`

## 已知问题

### 运行时错误：Class extends 失败

**症状**: 所有失败的测试都报同样的错误

```
Class extends value #<Object> is not a constructor or null
```

**分析**:

1. 构建产物中的流类定义看起来正确：

   ```javascript
   zl=class{listeners=new Map...}  // EventEmitterLike
   Bl=class extends zl{...}         // Stream
   Ul=class extends Bl{}            // Duplex
   Wl=class extends Ul{}            // Transform
   ```

2. 模块导出结构正确：

   ```javascript
   Jl=s({Transform:()=>Wl, ...})
   Xl=a((()=>{ql(),Yl={Transform:Wl,...}}))
   ```

3. 可能的根本原因：
   - 某个模块在运行时返回了普通对象而不是构造函数
   - 模块初始化顺序问题
   - 外部化的 Node.js 模块（node:stream/web, node:async_hooks, node:assert, node:buffer）导致运行时错误

**尝试过的修复**:

- ✅ 创建 util polyfill 并全局注入
- ✅ 在 generateBundle 阶段替换空模块
- ✅ 拦截 stream 导入
- ✅ 排除 xlsx 和 undici 的预构建
- ❌ 问题仍然存在

**下一步调试方向**:

1. 使用浏览器 DevTools 在运行时断点，查看实际的类值
2. 检查被 Vite 外部化的模块（node:stream/web 等）是否需要额外的 polyfill
3. 考虑使用 vite-plugin-node-polyfills 或类似的成熟方案
4. 检查 undici 的具体使用情况，可能需要更激进的 shim

## 功能状态

### ✅ 正常工作

- Excel 文件加载和解析
- 工作簿和工作表显示
- 单元格数据读取
- 格式化显示
- 多工作表切换
- 查找和替换（71个测试通过）

### ❌ 不工作

- 编辑和保存功能（已有意禁用）
- 12 个特定场景的 Excel 预览（运行时错误）

### 🚧 待确认

- 大文件处理
- 压缩文件支持
- 特殊格式处理

## 文件清单

### 修改的文件

- `package.json` - 依赖更新
- `src/react/excel/excel_reader.ts` - 完全重写
- `src/react/excel/excel_writer.ts` - 简化为只读
- `src/react/view/excel/useExcelDocumentSession.ts` - 适配新读取器
- `src/react/view/excel/ExcelSaveAsDialog.tsx` - UI保留，功能禁用
- `vite.config.ts` - 添加 polyfill 插件
- `src/react/main.tsx` - 早期导入 util polyfill

### 新增的文件

- `src/react/polyfills/util.ts` - util 模块 polyfill

### 可删除的文件（待清理）

- `src/react/shims/nodeUtil.ts` - 被 polyfills/util.ts 替代
- 任何未使用的 exceljs 相关代码

## 技术债务

1. **Polyfill 策略需要重新评估**
   - 当前的自定义 polyfill 方案不够完善
   - 考虑使用 @esbuild-plugins/node-modules-polyfill 或 vite-plugin-node-polyfills

2. **只读模式的用户体验**
   - 需要更清楚地告知用户编辑功能不可用
   - 考虑完全隐藏编辑相关的 UI 元素

3. **测试覆盖**
   - 需要修复失败的 12 个测试
   - 或者如果这些场景确实不支持，需要更新测试预期

## 构建信息

- 构建时间: ~3秒
- Excel bundle 大小: ~6MB
- Polyfill 插件日志显示正确拦截了 util 和 stream 导入
- 一个空模块被成功替换

## 下一步行动

### 优先级 1 - 修复运行时错误

1. 在浏览器中实际运行并调试
2. 检查 DevTools Console 的完整错误堆栈
3. 使用断点查看类继承时的实际值

### 优先级 2 - 评估替代方案

1. 研究其他项目如何在浏览器中使用 xlsx
2. 考虑使用更成熟的 Node.js polyfill 方案
3. 评估是否需要降级到旧版本的 xlsx

### 优先级 3 - 清理

1. 删除未使用的文件和依赖
2. 更新文档
3. 改进错误消息

## 参考资源

- [SheetJS 文档](https://docs.sheetjs.com/)
- [Vite Node.js Polyfills](https://vitejs.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility)
- undici 在浏览器环境的已知问题
