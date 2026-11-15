# Excel UI 测试修复进度

## 问题描述

Excel 相关的 UI 测试全部失败，错误信息从 "SharedArrayBuffer is not defined" 演变为 "process is not defined" 再到 "r.debuglog is not a function"。

## 已完成的修复

### 1. SharedArrayBuffer 支持 ✅

**问题**：xlsx 库需要 SharedArrayBuffer，但浏览器环境默认不启用。

**解决方案**：在 `scripts/ui-verify/harness.mjs` 中添加了必需的 HTTP 响应头：

```javascript
res.writeHead(200, {
  "content-type": "text/html; charset=utf-8",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
});
```

**相关文件**：

- `scripts/ui-verify/harness.mjs` (行 1143-1148)

### 2. 所有资源的 CORP 头 ✅

**问题**：COEP 要求所有资源都有 Cross-Origin-Resource-Policy 头。

**解决方案**：创建了 `addCrossOriginHeaders` 辅助函数，并应用到所有静态资源响应：

```javascript
const addCrossOriginHeaders = (headers) => ({
  ...headers,
  "Cross-Origin-Resource-Policy": "cross-origin",
});
```

**受影响的资源**：

- `/stats` (JSON)
- `/codicon.ttf` (字体)
- `/smoke.docx` (Word 文档)
- `/edit.csv`, `/huge.csv`, `/window.csv` (CSV 文件)
- `/edit.xls`, `/window.xls`, `/window.xlsx` (Excel 文件)
- Parquet 文件
- JSONL 文件
- 所有 webview 静态资源

**相关文件**：

- `scripts/ui-verify/harness.mjs` (行 1057-1061, 1064, 等)

### 3. process 全局变量 ✅

**问题**：打包后的代码引用了 `process.platform`、`process.arch` 等。

**解决方案**：在 HTML 中注入 process shim：

```javascript
const processShim = `<script nonce="${nonce}">window.process={env:{},platform:"browser",arch:"x64",version:"",versions:{},emit:()=>false};</script>`;
```

**相关文件**：

- `scripts/ui-verify/harness.mjs` (行 1136)

## 当前障碍 ❌

### Class extends value is not a constructor (最新)

**问题**：

- 错误信息：`Class extends value #<Object> is not a constructor or null`
- 已经成功注入了 EventEmitter 类到 util 模块
- 验证显示 EventEmitter 类定义正确，有构造函数
- 所有 `{EventEmitter:n}=Wt()` 解构都在 Wt 定义之后
- 但运行时仍然报告基类不是构造函数

**已修复的前置问题**：

- ✅ `r.debuglog is not a function` - 通过注入 debuglog 方法修复
- ✅ `n.channel is not a function` - 通过注入 channel 方法修复
- ✅ 语法错误 - 修复了闭合括号数量

### 已实现的解决方案：Vite 插件后处理

**方法**：使用 Vite 插件在 `generateBundle` 阶段替换空的 util 模块定义。

```typescript
function nodePolyfills(): Plugin {
  return {
    name: "node-polyfills",
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && fileName.includes("Excel")) {
          // 替换空模块为包含 EventEmitter 的完整 shim
          const utilShim = `Wt=e(((e,t)=>{...EventEmitter 类定义...}))`;
          chunk.code = chunk.code.replace(/Wt=e\(\(\(e,t\)=>\{t\.exports=\{\}\}\)\)/g, utilShim);
        }
      }
    },
  };
}
```

**注入的内容**：

- `debuglog(section)` - 返回 no-op 函数
- `format(formatter, ...args)` - 简单字符串格式化
- `inspect(value)` - 简单对象检查
- `channel(name)` - 返回假的 diagnostics_channel 对象
- `EventEmitter` 类 - 完整的事件发射器实现，包括 on, once, off, emit, removeAllListeners

**验证**：

- ✅ EventEmitter 类被正确注入到打包文件中
- ✅ `t.exports={...EventEmitter:EventEmitter}` 正确导出
- ✅ 类定义语法正确，包含构造函数
- ✅ 解构调用在模块定义之后

**根本原因**：

- Vite/Rollup 自动将 Node.js 内置模块（如 `util`）externalize 或替换成空对象
- `@cweijan/exceljs` 或其依赖（如 `undici`）在浏览器构建中仍然引用了 `util` 模块
- 我们的 util shim (`src/react/shims/nodeUtil.ts`) 没有被使用

**尝试过的方案**：

1. ❌ **Vite alias 配置**：在 `resolve.alias` 中将 `util` 映射到 shim
   - 未生效，因为 Vite 在处理 node_modules 依赖时不应用 alias

2. ❌ **Vite 插件**：创建自定义插件拦截 `util` 模块的 resolveId 和 load
   - 未生效，被 Vite 的内置 `rolldown:vite-resolve` 插件绕过

3. ❌ **optimizeDeps.esbuildOptions.alias**：在依赖预构建阶段注入 alias
   - 未生效

4. ❌ **define 配置**：使用 `define` 将 `process.env` 等注入
   - 只能注入常量，无法注入函数（如 `debuglog`）

5. ❌ **window.require 注入**：在 HTML 中注入全局 `require` 函数
   - 未被打包后的模块加载器调用

6. ❌ **Object.defineProperty monkey-patch**：在运行时拦截对象属性定义
   - 时机不对，无法拦截到模块初始化时的对象创建

## 下一步方向

### 当前问题分析

`Class extends value #<Object> is not a constructor or null` 错误表明，在运行时某个类试图继承一个不是构造函数的值。虽然我们已经验证：

1. EventEmitter 类被正确注入
2. 语法正确，有构造函数
3. 导出正确：`EventEmitter:EventEmitter`
4. 解构顺序正确

但仍然失败，可能的原因：

### 可能的根本原因

1. **作用域问题**：EventEmitter 类在模块包装器内部定义，可能在导出时作用域丢失
2. **Minifier 问题**：类名可能被混淆或重命名，导致 `EventEmitter:EventEmitter` 引用了错误的变量
3. **多次打包**：可能有其他构建步骤修改了生成的代码
4. **浏览器兼容性**：某些浏览器可能不支持我们使用的语法

### 建议的调试步骤

1. **直接测试生成的代码**
   - 在浏览器控制台手动执行注入的 Wt 模块代码
   - 验证 `Wt()` 返回值包含可用的 EventEmitter
   - 测试 `new (Wt().EventEmitter)()` 是否成功

2. **检查构建流程**
   - 确认没有其他插件或步骤修改了我们的注入代码
   - 检查是否有代码压缩器改变了类定义

3. **简化 EventEmitter**
   - 使用更简单的实现，避免箭头函数和高级语法
   - 使用 `function` 而不是 `class`

4. **替代方案**
   - 考虑使用浏览器原生的 EventTarget 作为基类
   - 或者完全避免使用 exceljs，只用 SheetJS (xlsx)

### 建议的下一步操作

**选项 A：简化 EventEmitter 实现（推荐尝试）**

使用更传统的语法，避免潜在的作用域或压缩问题：

```javascript
function EventEmitter() {
  this._events = {};
}
EventEmitter.prototype.on = function (e, t) {
  (this._events[e] = this._events[e] || []).push(t);
  return this;
};
EventEmitter.prototype.emit = function (e) {
  var t = Array.prototype.slice.call(arguments, 1);
  if (!this._events[e]) return false;
  this._events[e].forEach(function (e) {
    e.apply(null, t);
  });
  return true;
};
// ... 其他方法
```

**选项 B：使用浏览器原生 API**

如果 undici 或 exceljs 的某些部分可以适配，考虑使用：

- `EventTarget` 而不是 `EventEmitter`
- 或者提供一个适配器

**选项 C：Fork 和修补 exceljs**

如果问题确实来自 exceljs 对 Node.js 模块的依赖：

- Fork `@cweijan/exceljs`
- 创建真正的浏览器构建，移除所有 Node.js 依赖
- 或切换到其他库

**选项 D：只使用 SheetJS**

最激进但最可靠的方案：

- 移除 `@cweijan/exceljs` 依赖
- 只使用 SheetJS (xlsx) 处理所有 Excel 格式
- 可能会失去某些可编辑功能，需要评估影响

## 相关文件

- `scripts/ui-verify/harness.mjs` - 测试服务器和 HTML 注入
- `vite.config.ts` - Vite 构建配置
- `src/react/shims/nodeUtil.ts` - util 模块的浏览器 shim
- `src/react/shims/process.ts` - process 的浏览器 shim
- `package.json` - 依赖配置（exceljs 和 xlsx）

## 测试命令

```bash
# 构建
pnpm build

# 运行 UI 测试
pnpm verify:ui

# 运行单个 Excel 测试（用于快速验证）
TEST_PATTERN=excel-reduced-motion pnpm verify:ui
```

## 参考资料

- [MDN: SharedArrayBuffer Security Requirements](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)
- [Vite: Module Resolution](https://vite.dev/guide/features.html#module-resolution)
- [Node.js util module](https://nodejs.org/api/util.html)
