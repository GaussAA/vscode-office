# x-spreadsheet 优化计划 (3-5 天)

**目标**: 在不改变核心功能的前提下，减少技术债务，提升性能和可维护性。

## 现状调研结果

### 代码规模

- **总行数**: 13,847 行 (JS + TS + LESS)
- **最大文件**:
  - `core/data_proxy.js` (1,626 行)
  - `component/sheet.js` (1,491 行)
  - `index.less` (1,475 行)

### 目录结构

```
x-spreadsheet/
├── assets/icons/          # 48 个 SVG 图标
├── canvas/                # 绘制逻辑 (387 行)
├── component/             # UI 组件 (7,000+ 行)
│   ├── toolbar/          # 工具栏按钮 (27 个文件)
│   ├── sheet.js          # 主表格视图 (1,491 行)
│   ├── editor.js         # 单元格编辑器 (372 行)
│   ├── print.js          # 打印功能 (203 行)
│   └── ...
├── core/                  # 核心逻辑 (3,500+ 行)
│   ├── data_proxy.js     # 数据代理 (1,626 行)
│   ├── formula.js        # 公式引擎 (121 行)
│   ├── clipboard_html.js # HTML 剪贴板 (263 行)
│   └── ...
├── locale/                # 国际化 (5 种语言)
├── data.ts                # TypeScript 类型定义 (119 行)
└── index.ts               # 主入口 (528 行)
```

### 死代码候选

#### 1. **Chart 功能** (未实现)

- `assets/icons/chart.svg` (309 字节)
- `component/sheet.js` 第 1070-1071 行: `// chart` 空实现
- `index.less` 第 1580-1581 行: chart 样式
- **收益**: 删除 ~50 行代码 + 1 个图标

#### 2. **Print 功能** (VS Code 扩展中不需要)

- `component/print.js` (203 行)
- `assets/icons/print.svg` (380 字节)
- 在 VS Code 中打印 Excel 没有意义（用户会用原生 Excel 打印）
- **收益**: 删除 ~250 行代码 + 相关样式

#### 3. **Link 功能** (可能未使用)

- `component/modal_hyperlink.js` (61 行) — 已有外部实现
- `assets/icons/link.svg` (348 字节)
- 需验证是否已被外部 `excel_hyperlink.ts` 替代
- **收益**: 删除 ~100 行代码（如果验证为未使用）

#### 4. **多余的 Locale**

- 当前支持 5 种语言: en, zh-cn, zh-tw, de, nl
- 项目可能只需要 en, zh-cn, zh-tw
- **收益**: 删除 2 个语言文件 (~254 行)

### 包大小分析

当前包含大量资源：

- 48 个 SVG 图标（平均 ~250 字节/个 = ~12KB）
- 5 个语言文件（~1,000 行 = ~30KB）
- 大量 LESS 样式（1,475 行 = ~40KB 未压缩）

**优化方向**：

1. Tree-shake 未使用的图标
2. 懒加载语言包
3. 删除死代码和空实现

---

## 执行计划

### Day 1: 死代码识别与验证 (完成)

✅ **已完成调研**:

- [x] 扫描 x-spreadsheet 目录结构
- [x] 追踪入口文件依赖
- [x] 识别候选删除项

**识别出的死代码**:

1. Chart 功能（空实现）
2. Print 功能（VS Code 中不需要）
3. 部分未使用的 Locale
4. Link modal（需进一步验证）

---

### Day 2: 安全删除死代码

**任务**：

1. 删除 Chart 相关代码
   - [ ] 删除 `assets/icons/chart.svg`
   - [ ] 删除 `component/sheet.js` 中的 chart 空实现
   - [ ] 删除 `index.less` 中的 chart 样式

2. 删除 Print 功能
   - [ ] 删除 `component/print.js`
   - [ ] 删除 `assets/icons/print.svg`
   - [ ] 从 `component/sheet.js` 移除 Print 导入
   - [ ] 删除相关样式

3. 精简 Locale
   - [ ] 保留 en, zh-cn, zh-tw
   - [ ] 删除 de (德语), nl (荷兰语)
   - [ ] 更新 `excel_i18n.ts` 导入

4. 验证与测试
   - [ ] 运行 `pnpm check:full`
   - [ ] 手动测试所有 Excel 功能
   - [ ] 确认无功能损失

**预期收益**: 减少 500-700 行代码，减少 ~15KB 包大小

---

### Day 3: 包大小优化

**任务**：

1. Bundle 分析
   - [ ] 安装 `rollup-plugin-visualizer`
   - [ ] 分析 x-spreadsheet 的实际打包大小
   - [ ] 识别重复依赖或过大的模块

2. 懒加载优化
   - [ ] 将 locale 改为按需加载
   - [ ] 延迟加载 modal 组件（validation, hyperlink）
   - [ ] 延迟加载 sort/filter 组件

3. 资源优化
   - [ ] 确认所有 SVG 图标都被使用
   - [ ] 压缩 LESS 样式（移除冗余规则）

4. 验证
   - [ ] 构建并测量 .vsix 包大小
   - [ ] 对比优化前后差异

**预期收益**: 减少 50-100KB 包大小

---

### Day 4: 性能优化

**任务**：

1. 性能 Profiling
   - [ ] 创建测试用大文件（1MB, 5MB Excel）
   - [ ] 使用 Chrome DevTools 测试打开速度
   - [ ] 识别慢函数（渲染、事件监听器、数据转换）

2. 事件监听器优化
   - [ ] 审计 133 个事件监听器（agent-4 发现的问题）
   - [ ] 添加 cleanup 逻辑（在组件销毁时移除）
   - [ ] 防止内存泄漏

3. 渲染优化
   - [ ] 检查是否有不必要的重绘
   - [ ] 优化 `component/table.js` 渲染逻辑
   - [ ] 添加防抖/节流（如需要）

4. 数据转换优化
   - [ ] 检查 `excel_reader.ts` / `excel_writer.ts` 性能
   - [ ] 优化 `core/cell.js` 和 `core/format.js`

**预期收益**: 20-30% 性能提升

---

### Day 5: 代码质量与文档

**任务**：

1. 代码质量改善
   - [ ] 修复 typecheck 错误（如果有）
   - [ ] 清理注释掉的代码
   - [ ] 添加关键代码注释（尤其是 `data_proxy.js`, `sheet.js`）
   - [ ] 统一代码风格（运行 `oxfmt`）

2. 文档编写
   - [ ] **ADR**: `docs/adr/0016-keep-x-spreadsheet-with-optimization.md`
     - 决策：保留 x-spreadsheet
     - 理由：全面调研后的务实选择
     - 后果：接受技术债务，通过局部优化降低风险

   - [ ] **优化报告**: `docs/x-spreadsheet-optimization-report.md`
     - 优化前后对比（代码行数、包大小、性能）
     - 具体优化措施列表
     - 收益量化

   - [ ] **维护指南**: `docs/x-spreadsheet-maintenance-guide.md`
     - 如何修 bug
     - 如何添加功能
     - 未来迁移的考虑

3. 最终验证
   - [ ] 完整回归测试（`pnpm check:full`）
   - [ ] 打包验证（`pnpm build && pnpm run package`）
   - [ ] 手动功能测试（打开、编辑、保存 Excel）

---

## 验收标准

优化成功 = 满足以下所有条件：

| 指标            | 目标                          | 验证方法             |
| --------------- | ----------------------------- | -------------------- |
| ✅ 所有测试通过 | `pnpm check:full` 全绿        | 运行测试             |
| ✅ 功能无损失   | 所有 Excel 功能正常           | 手动测试             |
| ✅ 代码量减少   | 减少 10-20% (~1,400-2,800 行) | `wc -l` 对比         |
| ✅ 包大小减少   | 减少 50-100KB                 | `.vsix` 文件大小对比 |
| ✅ 性能提升     | 打开大文件快 20%+             | Chrome DevTools 测量 |
| ✅ 文档完整     | ADR + 报告 + 指南             | 文档存在且完整       |

---

## 风险与缓解

| 风险             | 可能性 | 影响 | 缓解措施                   |
| ---------------- | ------ | ---- | -------------------------- |
| 删除了有用的代码 | 中     | 高   | 完整测试 + Git 可回滚      |
| 性能优化引入 bug | 中     | 中   | 渐进式优化 + 每步测试      |
| 时间超预算       | 低     | 低   | 优先级排序，核心优化先做   |
| 破坏现有功能     | 低     | 高   | 每天运行 `pnpm check:full` |

---

## 优先级排序

如果时间不足，按以下优先级执行：

1. **P0 (必做)**: Day 2 删除死代码 — 最安全，ROI 最高
2. **P1 (重要)**: Day 4 事件监听器清理 — 防止内存泄漏
3. **P2 (推荐)**: Day 3 包大小优化 — 用户体验提升
4. **P3 (可选)**: Day 4 性能优化 — 如果没有明显瓶颈可跳过
5. **P4 (必做)**: Day 5 文档 — 记录决策，帮助未来维护

---

## 下一步

立即开始 **Day 2: 安全删除死代码**。这是最安全、ROI 最高的优化。

开始吧！🚀
