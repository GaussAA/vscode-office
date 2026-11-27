# ADR-0032 parquet 列工作区：一列冻结、随时收窄可见列

- 状态：已接受（2026-11-27，已实现）
- 日期：2026-11-27
- 与 [ADR-0023](./0023-interaction-and-a11y.md) 的键盘/可听反馈规则共同生效

## 背景

用户要在宽表里读一列：点左栏字段后，这列会被滚到视口中央；继续横向滚动，它又走了。期望
是 Excel 的「冻结窗格」：选中列在即将划出视口时贴住左/右边缘，且能知道它被固定了。

同时，字段一多就需要「只看这几列」；原左栏只有一个按名字过滤字段的输入框，没有列选择，
表格也没有显隐模型。用户明确要求向 Excel 看齐，但先做**列**这一半；按值筛行（漏斗
autofilter）作为下一轮，不混进这次提交。

## 决定

### 1. 冻结只跟随 schema 点击，一次一列

- 点 schema 字段：设置 active、滚动到视口、进入「可冻结」状态；再点同列取消；点另一列替换。
- 点单元格只改变 active tint 与检查面板，**不冻结**。这样浏览数据不会意外钉列。
- 选择后由程序触发的滚动（点击的 glide）不算用户推列；只有第一次 wheel/pointer 手势之后才
  开始判断贴边。否则滚到最右列的 schema 点击会立即把列钉在右边，抢走滚动能力。
- 列第一次将要划出时贴住那一侧（`fixed: "start"` / `"end"`）；保持该侧，直到用户把列滚回
  可见区才释放；释放后继续滚到另一侧才会换边。单列，不做多列/分栏。
- 视觉：固定侧 1px 强调线 + 轻投影，列头出现图钉图标；active 蓝 tint 保留，冻结是位置信号，
  不是第二种选中态。
- 不持久化：active/冻结是当前阅读动作，重开文件从无冻结开始。

实现依赖 antd 6 虚拟表的中间列 `fixed`（`start`/`end` 映射到 sticky）；已实测 body 和 header
同时对齐、无重复 cell、无 tab 序列新增。虚拟表的横向偏移是 `margin-left` 而非 scroll port，
所以贴边由 antd 的 sticky 完成，JS 只在 offset 变化时决定「用哪一侧」和「是否释放」。
原 `.ant-table-cell-fix-left/right` 是不存在的 antd 6 类名，已改成 `-fix-start/end`。

### 2. 列显隐：Ctrl/Shift 多选 + 一个「只看选中」

- 普通点击仍是激活/滚动；Ctrl/Cmd 点击增减选择；Shift 点击从上一个普通点击位置选范围。
- 左栏工具条「只看选中（N）」：选中集为空时禁用；开启后表格只渲染选中列，schema 仍列全部
  字段（未选中项变淡）。点击被隐藏的字段会把它加回可见并激活，而不是把用户困在只看视图里。
- 清空选择/移除最后一列会自动关闭「只看选中」；隐藏只影响显示，搜索仍默认搜全部列，可用
  搜索范围下拉收窄到「可见列」。冻结只对可见列生效；active 被隐藏时自动清除冻结。
- 选中集和开关按文件持久化（和列宽、字段过滤、搜索范围同一层 `parquet-ui:`）；列宽仍按原
  位置保存，隐藏再显示不会丢宽度。
- 表格的 `aria-colcount`/`aria-colindex` 按**渲染顺序**编号；header/cell 另带
  `data-col-position` 保存原始列位置，供 schema 跳转与搜索/冻结使用。

### 3. 验收

- `parquet-pinned-column`：宽表 48 列上，点击 `field_20`、横向滚轮先贴左、再滚回释放、
  反向滚到右侧贴右；再点同列解冻；点击单元格不冻结。
- `parquet-column-visibility`：Ctrl 选两列、只看选中、点隐藏列加回、清空恢复全部、重开文档
  恢复视图。
- `semantic-contrast`：active 列内的链接在 14% 蓝 tint 上仍 ≥4.5:1（body 用 body tint，header
  才用 header tint；冻结不能把 header 的 20% 涂到 body 上）。
- 行筛选（列头漏斗、页内 AND、按文件持久化、搜索跳转清筛选）记录在下一轮，不在本 ADR 实现。

## Considered Options

- **动态每帧选最近侧**：列在左右边缘之间会瞬移，拒绝；采用首次贴边并保持。
- **多列同时冻结**：需要累计宽度、窄视口优先级与取消规则，首版不做。
- **点击单元格也冻结**：浏览数据时频繁误钉，拒绝。
- **只做左侧固定**：列从右侧划出时会先跑到左边再钉住，不符合「即将划出的一侧」，拒绝。
- **用 CSS 手写 sticky**：少 30 行，但失去 antd 的阴影/`--z-offset` 集成，且 fixed 的 header/
  body 对齐需要自己维护；用 antd 的 `fixed` 属性更稳。

## 实施记录

- `src/react/view/parquet/parquetColumns.tsx`：`fixed`、图钉、列头 title、原始列位置 data 属性。
- `src/react/view/parquet/useParquetColumnFocus.ts`：首次贴边/释放、手势 arm、MutationObserver
  读取虚拟表 offset、隐藏列清除。
- `src/react/view/parquet/useParquetColumnLayout.ts`：只对渲染列计算 stretch/filler，宽度按原
  位置合并。
- `src/react/view/parquet/ParquetSchema.tsx` / `Parquet.tsx` / `parquetUiState.ts`：多选、只看选中、
  持久化、隐藏列点击、active 隐藏清理。
- `Parquet.less`：`-fix-start/end` 背景、分隔线/投影、图钉与彩色命中列。
- 测试：`scripts/ui-verify/scenarios/parquet-grid.mjs` 的 `parquet-pinned-column`、
  `parquet-column-visibility`、`parquet-search-scope`、`parquet-search-highlight`；
  `scripts/ui-verify/browser.mjs` 增加真实 wheel 手势（合成 WheelEvent 不会驱动 rc-virtual-list）。
