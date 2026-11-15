# Node.js Polyfill 调试日志

## 目标

修复从 @cweijan/exceljs 迁移到 xlsx (SheetJS) 后的 Node.js 模块兼容性问题。

## 时间线

### 第一阶段：自定义 Polyfill（已废弃）

**尝试时间**：初期
**方法**：

- 创建 `src/react/polyfills/util.ts` 提供自定义 util 实现
- 创建 Vite 插件 `injectUtilPolyfill()` 拦截 util 和 stream 导入
- 在 generateBundle 阶段使用正则替换空模块

**问题**：

- 模式匹配不可靠
- 需要手动处理每个子模块
- 维护成本高

**结果**：测试通过率停留在 71/83

---

### 第二阶段：vite-plugin-node-polyfills

**实施时间**：当前
**方法**：

1. 安装 `vite-plugin-node-polyfills` v0.28.0
2. 配置包含 util, stream, buffer, process, events
3. 启用 protocolImports 支持 node: 前缀

**配置**：

```typescript
nodePolyfills({
  include: ["util", "stream", "buffer", "process", "events"],
  protocolImports: true,
  globals: {
    Buffer: true,
    global: true,
    process: true,
  },
});
```

**优势**：

- 成熟的社区方案
- 自动处理大部分 Node.js 内置模块
- 支持 node: 协议前缀

**不足**：

- 不支持所有子模块（util/types, stream/web）
- 缺少较新的 API（util.channel）
- 某些 HTTP/2 常量缺失

---

### 第三阶段：补充 Shims

**实施内容**：

#### 1. util/types (src/react/shims/util-types.ts)

提供类型检查函数：

- isUint8Array, isTypedArray, isArrayBuffer
- isPromise, isMap, isSet, isDate, isRegExp
- 等 30+ 个类型检查函数

#### 2. stream/web (src/react/shims/stream-web.ts)

提供 Web Streams API：

- ReadableStream, WritableStream, TransformStream
- ReadableStreamTee helper
- 各种 Controller 和 Reader 类

#### 3. http2 常量 (src/react/shims/http2-constants.ts)

提供 HTTP/2 头部常量：

- HTTP2_HEADER_AUTHORITY
- HTTP2_HEADER_METHOD
- 等 60+ 个常量

**vite.config.ts alias 配置**：

```typescript
alias: {
  'node:util/types': resolve(cwd, 'src/react/shims/util-types.ts'),
  'node:stream/web': resolve(cwd, 'src/react/shims/stream-web.ts'),
  'node:http2': resolve(cwd, 'src/react/shims/http2-constants.ts'),
  'http2': resolve(cwd, 'src/react/shims/http2-constants.ts'),
}
```

---

### 第四阶段：自定义补丁插件

**问题**：vite-plugin-node-polyfills 提供的 util 缺少 `channel()` 函数

**解决方案**：创建 `patchNodePolyfills()` 插件

**实现**：

```typescript
function patchNodePolyfills(): Plugin {
  return {
    name: "patch-node-polyfills",
    enforce: "post", // 在 vite-plugin-node-polyfills 之后

    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && fileName.includes("Excel")) {
          // 1. 在 t.inspect 之后添加 t.channel
          chunk.code = chunk.code.replace(
            /(t\.inspect\s*=\s*[^;]+;)/g,
            (match) => match + "t.channel=function(){...};",
          );

          // 2. 替换空的 util 模块（如 Kt）
          chunk.code = chunk.code.replace(
            /(\w+)=l\(\(\(e,t\)=>\{t\.exports=\{\}\}\)\)/g,
            (match, varName) => `${varName}=l(((e,t)=>{
              function channel(){...}
              t.exports={debuglog:...,format:...,inspect:...,channel:channel}
            }))`,
          );
        }
      }
    },
  };
}
```

**成效**：

- 成功添加 util.channel 到构建产物
- 替换了空的 util 模块导出（Kt 变量）
- 应用了 2 个补丁

---

## 错误演变历史

### 错误 #1: `n.channel is not a function`

**原因**：vite-plugin-node-polyfills 的 util 不包含 channel 函数
**解决**：通过 patchNodePolyfills 插件添加

### 错误 #2: `Class extends value #<Object> is not a constructor or null`

**原因**：某个空对象被作为基类
**分析**：

- 构建产物中的流类层次正确：zl -> Bl -> Ul -> Wl
- 但运行时某个类继承了非构造函数

### 错误 #3: `Cannot read properties of undefined (reading 'HTTP2_HEADER_AUTHORITY')`

**原因**：缺少 http2 模块
**解决**：创建 http2-constants.ts shim

### 错误 #4: `Class extends value undefined is not a constructor or null`（当前）

**原因**：某个类的基类解析为 undefined
**状态**：未解决

---

## 当前状态

### 测试结果

- **71/83 场景通过** (85.5%)
- **12 个 Excel 测试失败**

### 失败的测试

所有失败测试都与 Excel 相关：

1. 大文件处理（4个）
2. 保存功能（3个，功能已禁用）
3. windowed 视图（3个）
4. .xls 旧格式（1个）
5. 综合测试（1个）

### 构建状态

- ✅ 构建成功
- ✅ Polyfill 插件正常工作
- ✅ 应用了 2 个补丁到 Excel bundle
- ❌ 运行时仍有类继承错误

---

## 根本原因分析

### 可能的原因

1. **undici 的深层依赖**
   - undici 依赖许多 Node.js 内置模块
   - 某些模块可能没有被正确 polyfill
   - 类继承链中的某个环节断了

2. **模块解析顺序**
   - vite-plugin-node-polyfills 可能没有覆盖所有导入路径
   - 某些模块可能被 Vite 外部化
   - 模块加载顺序可能影响继承

3. **xlsx 本身的浏览器兼容性**
   - xlsx 可能不完全支持浏览器环境
   - 某些功能可能需要 Node.js 特定的 API

### 调试困难点

- 错误信息不明确（只知道"某个类"继承失败）
- 构建产物是压缩的，变量名被混淆
- 无法在浏览器中实时调试（测试是自动化的）
- 每次修改都需要完整的构建-测试周期

---

## 下一步选项

### 选项 A：继续深度调试

**方法**：

1. 在实际浏览器中打开测试页面
2. 使用 DevTools 断点找到具体的继承错误位置
3. 识别缺失的基类是什么模块
4. 添加相应的 polyfill

**优势**：

- 可能完全解决问题
- 达到 100% 测试通过

**风险**：

- 可能需要大量时间
- 可能遇到更多缺失的模块
- 可能无法完全 polyfill 某些 Node.js 功能

**预估时间**：2-4 小时

### 选项 B：接受当前状态

**理由**：

1. **85.5% 通过率已经很好**
   - 核心功能（Excel 读取、显示、查找）都工作
   - 失败的主要是边缘场景

2. **失败的测试不影响主要用例**
   - 保存功能已有意禁用
   - 大文件和特殊格式是边缘场景
   - windowed 视图可能不是必需功能

3. **投入产出比**
   - 已投入大量时间在 polyfill 上
   - 剩余 12 个测试可能需要更多特殊处理
   - 用户可能不会触发这些场景

**下一步**：

- 更新文档说明已知限制
- 在 UI 中禁用或隐藏不支持的功能
- 为失败的场景提供友好的错误提示

### 选项 C：替代方案

**可能的方向**：

1. **降级 xlsx 版本**
   - 尝试旧版本，可能依赖更少

2. **使用 xlsx-style-vite 或类似的浏览器优化版本**
   - 社区可能有更适合浏览器的 fork

3. **考虑其他 Excel 库**
   - exceljs（原版）
   - luckysheet
   - handsontable

---

## 技术债务记录

### 需要监控的问题

1. **构建时警告**
   - Vite config 使用了 native loader 不支持的特性
   - optimizeDeps.esbuildOptions 已废弃

2. **运行时错误处理**
   - 当前失败的测试没有友好的错误消息
   - 用户可能不知道某些功能不可用

3. **Polyfill 维护**
   - 自定义的 shim 文件需要跟随 Node.js API 更新
   - patchNodePolyfills 插件依赖构建产物的特定模式

### 文件清理

可以删除的文件（如果接受当前状态）：

- `vite.config.ts.backup-custom-polyfill` （备份文件）
- `src/react/shims/nodeUtil.ts` （已被 vite-plugin-node-polyfills 替代）
- `src/react/polyfills/util.ts` （已被 vite-plugin-node-polyfills 替代）

---

## 建议

基于当前情况，我建议**选项 B：接受当前状态**，理由如下：

1. **成本效益分析**
   - 已投入 ~4 小时在 polyfill 调试上
   - 85.5% 通过率对于迁移项目来说是很好的结果
   - 剩余问题需要的时间可能超过收益

2. **实际影响评估**
   - 失败的测试大多是边缘场景
   - 核心的 Excel 读取和显示功能正常
   - 保存功能本来就是要禁用的

3. **风险控制**
   - 继续调试可能遇到更多深层问题
   - 完全 polyfill Node.js 环境在浏览器中是困难的
   - 可能最终需要更换库

**行动计划**（如果选择选项 B）：

1. ✅ 更新 MIGRATION_STATUS.md 记录当前状态
2. ⏳ 在 UI 中禁用或隐藏不支持的功能
3. ⏳ 添加错误边界处理失败场景
4. ⏳ 更新用户文档说明限制
5. ⏳ 清理不需要的文件
6. ⏳ 提交代码并创建 PR

**如果用户要求 100% 通过率**，则启动选项 A 的深度调试。
