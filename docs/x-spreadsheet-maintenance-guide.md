# x-spreadsheet 维护指南

本文档提供 x-spreadsheet 的维护、调试和扩展指南。

---

## 概述

x-spreadsheet 是一个第三方电子表格库，位于 `src/react/view/excel/x-spreadsheet/`。它是一个 vendored 的依赖（供应商化），这意味着：

- ✅ 我们完全控制代码，可以直接修改
- ✅ 不依赖上游更新
- ❌ 我们负责所有 bug 修复
- ❌ 我们不会自动获得上游的新特性

**原始仓库**: https://github.com/myliang/x-spreadsheet  
**Vendored 版本**: 已优化，删除了 Print、Chart 等未使用功能

---

## 架构概览

### 目录结构

```
x-spreadsheet/
├── assets/icons/          # 46 个 SVG 图标
├── canvas/                # Canvas 绘制逻辑
│   └── draw.js           # (387 行) 表格渲染
├── component/             # UI 组件
│   ├── toolbar/          # 工具栏按钮 (25 个文件)
│   ├── sheet.js          # (1,487 行) 主表格视图
│   ├── editor.js         # (372 行) 单元格编辑器
│   ├── table.js          # (354 行) 表格渲染
│   ├── bottombar.js      # (476 行) Sheet 标签栏
│   └── ...               # 其他 UI 组件
├── core/                  # 核心逻辑
│   ├── data_proxy.js     # (1,626 行) 数据代理 - 核心状态管理
│   ├── formula.js        # (121 行) 公式引擎
│   ├── clipboard_html.js # (263 行) HTML 剪贴板
│   ├── cell.js           # (177 行) 单元格计算
│   └── ...
├── locale/                # 国际化 (3 种语言: en, zh-cn, zh-tw)
├── data.ts                # (119 行) TypeScript 类型定义
└── index.ts               # (528 行) 主入口
```

### 核心组件

#### 1. **DataProxy** (`core/data_proxy.js`)

- **职责**: 管理整个工作簿的状态（数据、样式、合并单元格等）
- **关键方法**:
  - `setCellText()` - 设置单元格文本
  - `setSelectedCellAttr()` - 设置单元格属性
  - `changeData()` - 批量修改数据
  - `getData()` / `setData()` - 获取/设置工作表数据
- **重要性**: ⭐⭐⭐⭐⭐ 几乎所有操作都通过这里

#### 2. **Sheet** (`component/sheet.js`)

- **职责**: 主视图容器，协调所有子组件
- **子组件**: Toolbar, FormulaBar, Table, Editor, Selector, Scrollbar, ContextMenu
- **事件处理**: 键盘、鼠标、滚动、缩放
- **重要性**: ⭐⭐⭐⭐⭐ 视图层的核心

#### 3. **Table** (`component/table.js`)

- **职责**: Canvas 渲染表格
- **性能关键**: 大文件的渲染性能取决于这里
- **重要性**: ⭐⭐⭐⭐ 性能优化的重点

#### 4. **Editor** (`component/editor.js`)

- **职责**: 单元格编辑器（输入框）
- **特性**: 公式补全、日期选择器、建议框
- **重要性**: ⭐⭐⭐ 用户交互的核心

---

## 常见维护任务

### 如何修复 Bug

#### 1. **单元格显示问题**

**症状**: 单元格内容不正确或样式错误

**可能原因**:

- `core/cell.js` - 单元格计算逻辑
- `core/format.js` - 数字格式化
- `canvas/draw.js` - 渲染逻辑

**调试步骤**:

```javascript
// 在 core/data_proxy.js 的 getCell() 中打印
getCell(ri, ci) {
  const cell = this.rows.getCell(ri, ci);
  console.log('getCell', { ri, ci, cell }); // 添加日志
  return cell;
}
```

#### 2. **工具栏按钮不工作**

**症状**: 点击工具栏按钮无效果

**可能原因**:

- `component/toolbar/index.js` - 工具栏注册
- `component/sheet.js` - 事件处理 (第 1053-1090 行)

**调试步骤**:

```javascript
// 在 component/sheet.js 的 toolbarChange() 中打印
toolbarChange(type, value) {
  console.log('toolbarChange', { type, value }); // 添加日志
  const { data } = this;
  // ...
}
```

#### 3. **保存/读取数据问题**

**症状**: 保存后重新打开，数据丢失或错误

**可能原因**:

- `excel_reader.ts` - Excel 读取
- `excel_writer.ts` - Excel 写入
- `core/data_proxy.js` - 数据序列化

**调试步骤**:

```javascript
// 在 excel_writer.ts 中打印
export async function writeExcel(data, filename) {
  console.log("writeExcel", { data, filename }); // 检查输入数据
  // ...
}
```

#### 4. **性能问题**

**症状**: 打开大文件卡顿

**可能瓶颈**:

- `component/table.js` - Canvas 渲染
- `component/sheet.js` - 事件监听器过多
- `core/data_proxy.js` - 数据处理

**性能分析**:

```javascript
// 使用 Chrome DevTools Performance Profiler
// 1. 打开 VS Code 开发者工具
// 2. 打开 Performance 标签
// 3. 开始录制
// 4. 打开大 Excel 文件
// 5. 停止录制，分析耗时函数
```

---

## 如何添加功能

### 示例 1: 添加新的工具栏按钮

**步骤**:

1. **创建按钮组件** (`component/toolbar/my_button.js`):

```javascript
import Item from "./item";

export default class MyButton extends Item {
  constructor() {
    super("icon", "my-button");
  }
}
```

2. **注册按钮** (`component/toolbar/index.js`):

```javascript
import MyButton from "./my_button";

// 在 constructor 中添加
this.myButton = new MyButton();
this.el.child(this.myButton.el);

// 监听点击
this.myButton.click(() => {
  this.change("my-button");
});
```

3. **处理事件** (`component/sheet.js`):

```javascript
// 在 toolbarChange() 中添加
else if (type === "my-button") {
  // 你的逻辑
  data.setSelectedCellAttr("customAttr", value);
}
```

4. **添加图标** (`assets/icons/my-button.svg`):

```svg
<svg>...</svg>
```

5. **添加样式** (`index.less`):

```less
&.my-button {
  background-image: url("./assets/icons/my-button.svg");
}
```

### 示例 2: 添加新的单元格属性

**步骤**:

1. **更新类型定义** (`data.ts`):

```typescript
export interface CellStyle {
  // ... 现有属性
  customAttr?: string; // 添加新属性
}
```

2. **更新渲染逻辑** (`canvas/draw.js`):

```javascript
function renderCell(cell, style) {
  // ... 现有渲染
  if (style.customAttr) {
    // 自定义渲染逻辑
  }
}
```

3. **更新读取逻辑** (`excel_reader.ts`):

```typescript
// 从 Excel 读取自定义属性
if (excelCell.customAttr) {
  cell.customAttr = excelCell.customAttr;
}
```

4. **更新写入逻辑** (`excel_writer.ts`):

```typescript
// 写入自定义属性到 Excel
if (cell.customAttr) {
  excelCell.customAttr = cell.customAttr;
}
```

---

## 常见陷阱

### 1. **事件监听器泄漏**

**问题**: x-spreadsheet 创建了大量事件监听器，但没有清理

**解决方案**:

```javascript
// 在组件销毁时移除监听器
class MyComponent {
  constructor() {
    this.listeners = [];
  }

  on(event, handler) {
    window.addEventListener(event, handler);
    this.listeners.push({ event, handler });
  }

  destroy() {
    this.listeners.forEach(({ event, handler }) => {
      window.removeEventListener(event, handler);
    });
  }
}
```

### 2. **直接修改 data_proxy 内部状态**

**问题**: 绕过 `changeData()` 直接修改会导致撤销/重做失败

**错误做法**:

```javascript
data.rows.data[0].cells[0].text = "新值"; // ❌ 不会记录历史
```

**正确做法**:

```javascript
data.changeData(() => {
  data.rows.data[0].cells[0].text = "新值"; // ✅ 记录历史
});
```

### 3. **忽略 TypeScript 错误**

**问题**: `index.ts` 顶部有 `// @ts-nocheck`，但其他文件不应忽略类型错误

**规则**:

- ✅ `x-spreadsheet/index.ts` 可以有 `@ts-nocheck`（vendored JS 代码）
- ❌ 我们的集成代码（`excel_reader.ts`, `excel_writer.ts`）不应忽略类型错误
- ✅ 优先修复类型错误，而不是添加 `@ts-ignore`

---

## 性能优化建议

### 1. **减少重绘**

```javascript
// ❌ 每次改变都重绘
for (let i = 0; i < 1000; i++) {
  data.setCellText(i, 0, `Cell ${i}`);
  // 每次调用都触发 reRender()
}

// ✅ 批量修改后一次重绘
data.changeData(() => {
  for (let i = 0; i < 1000; i++) {
    data.setCellText(i, 0, `Cell ${i}`);
  }
});
// 只在最后重绘一次
```

### 2. **懒加载组件**

```javascript
// ❌ 立即加载所有组件
import ModalValidation from "./modal_validation";
const modal = new ModalValidation();

// ✅ 按需加载
let modal = null;
function showValidation() {
  if (!modal) {
    modal = import("./modal_validation").then((m) => new m.default());
  }
  return modal.then((m) => m.show());
}
```

### 3. **虚拟化渲染**

x-spreadsheet 已经实现了虚拟滚动（只渲染可见单元格），但可以进一步优化：

```javascript
// 在 component/table.js 中
// 调整 OVERSCAN_ROW_COUNT 和 OVERSCAN_COL_COUNT
const OVERSCAN_ROW_COUNT = 5; // 减少 overscan 可以提升性能
```

---

## 测试策略

### 单元测试

暂时没有 x-spreadsheet 的单元测试，但建议添加：

```typescript
// test/unit/x-spreadsheet.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import Spreadsheet from "../../src/react/view/excel/x-spreadsheet/index";

describe("x-spreadsheet", () => {
  it("should create a spreadsheet instance", () => {
    const container = document.createElement("div");
    const ss = new Spreadsheet(container);
    assert(ss instanceof Spreadsheet);
  });
});
```

### 集成测试

使用现有的 smoke 测试和 UI 验证：

```bash
pnpm test:smoke        # 真实 VS Code 中测试
pnpm verify:ui         # 无头浏览器验证
```

### 手动测试清单

每次修改后验证：

- [ ] 打开 .xlsx 文件
- [ ] 打开 .xls 文件（SheetJS）
- [ ] 编辑单元格
- [ ] 复制/粘贴
- [ ] 撤销/重做
- [ ] 切换 Sheet
- [ ] 保存文件
- [ ] 使用工具栏（加粗、斜体、对齐等）
- [ ] 使用公式
- [ ] 冻结行/列

---

## 未来迁移考虑

如果未来需要迁移到其他库（如 fortune-sheet），记录以下信息：

### 需要迁移的功能

1. Excel 读取/写入（ExcelJS 集成）
2. 单元格编辑
3. 样式支持（字体、颜色、边框等）
4. 公式计算
5. 冻结行/列
6. 工作表管理
7. 撤销/重做
8. 复制/粘贴

### 迁移清单

- [ ] 评估新库的 bundle 大小
- [ ] 验证新库的 TypeScript 支持
- [ ] 测试新库的渲染性能
- [ ] 检查新库的可访问性
- [ ] 评估新库的维护状态
- [ ] 创建 POC（概念验证）
- [ ] 对比功能覆盖度
- [ ] 估算迁移工作量

---

## 常用命令

```bash
# 构建
pnpm build

# 运行测试
pnpm check:full

# 打包扩展
pnpm run package

# 格式化代码
pnpm format

# 类型检查
pnpm typecheck

# 查看 x-spreadsheet 代码行数
find src/react/view/excel/x-spreadsheet -name "*.js" -o -name "*.ts" | xargs wc -l
```

---

## 相关文档

- [ADR-0024: Keep x-spreadsheet with Optimization](./adr/0024-keep-x-spreadsheet-with-optimization.md)
- [优化计划](./x-spreadsheet-optimization-plan.md)
- [优化进度](./x-spreadsheet-optimization-progress.md)
- [fortune-sheet 评估](./fortunesheet-quick-assessment.md)
- [wolf-table 评估](./wolf-table-assessment.md)

---

## 获取帮助

### 内部资源

- 检查 `docs/adr/` 中的架构决策记录
- 搜索 GitHub Issues（原始仓库）: https://github.com/myliang/x-spreadsheet/issues
- 查看本项目的 Git 历史: `git log src/react/view/excel/x-spreadsheet/`

### 外部资源

- x-spreadsheet 原始文档: https://github.com/myliang/x-spreadsheet
- ExcelJS 文档: https://github.com/exceljs/exceljs
- Canvas API 参考: https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API

---

## 维护原则

1. **渐进式改进**: 小步快跑，每次改动可单独回退
2. **测试先行**: 修改前先跑 `pnpm check:full`，修改后再跑一次
3. **文档同步**: 重大修改要更新这份维护指南
4. **性能意识**: 大文件是瓶颈，优化时优先考虑性能
5. **类型安全**: 新代码必须通过 `pnpm typecheck`

---

**最后更新**: 2024-11-15  
**维护者**: Development Team
