---
name: Data File Viewer (Parquet, JSONL, Excel)
description: VS Code 里三件只读预览仪器 + 一件命令式 JSON 检查仪器的视觉体系 —— 主题是机身，颜色只给信号，密度就是效率。
colors:
  editor-surface: "#1e1e1e"
  panel-surface: "#252526"
  panel-surface-strong: "#2d2d2d"
  foreground: "#cccccc"
  foreground-muted: "#9d9d9d"
  accent-navy: "#0e639c"
  focus-azimuth: "#0078d4"
  signal-blue: "#3794ff"
  signal-blue-on-light: "#006ab1"
  skeleton-violet: "#b180d7"
  skeleton-violet-on-light: "#6f2d8a"
  numeric-cyan: "#4ea1ff"
  numeric-cyan-on-light: "#0451a5"
  string-moss: "#89d185"
  string-moss-on-light: "#2e7d32"
  boolean-amber: "#f0a45e"
  boolean-amber-on-light: "#9a5b00"
  datetime-mauve: "#c586c0"
  datetime-mauve-on-light: "#6f2d8a"
  danger-coral: "#f48771"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.6
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  data:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "22px"
  input:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "30px"
  meta-value:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
  chrome-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 600
    letterSpacing: "0.07em"
    lineHeight: 1.4
  badge:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
    fontSize: "9.5px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  surface: "8px"
  control: "6px"
  badge: "4px"
  cell-focus: "3px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  xxl: "24px"
components:
  command-bar:
    backgroundColor: "{colors.panel-surface-strong}"
    height: "52px"
    padding: "8px 16px"
  status-bar:
    backgroundColor: "{colors.panel-surface-strong}"
    height: "44px"
    padding: "6px 16px"
  search-field:
    backgroundColor: "{colors.panel-surface}"
    textColor: "{colors.foreground}"
    typography: "{typography.input}"
    rounded: "{rounded.surface}"
    height: "32px"
    padding: "0 4px 0 10px"
  icon-button:
    textColor: "{colors.foreground-muted}"
    rounded: "{rounded.control}"
    size: "26px"
    height: "26px"
  pager-button:
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "28px"
    padding: "0 5px"
  list-row:
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "6px 8px"
  type-badge:
    backgroundColor: "{colors.panel-surface}"
    textColor: "{colors.foreground-muted}"
    typography: "{typography.badge}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  header-cell:
    backgroundColor: "{colors.panel-surface}"
    textColor: "{colors.foreground-muted}"
    typography: "{typography.chrome-label}"
    padding: "8px 12px"
  data-cell:
    textColor: "{colors.foreground}"
    typography: "{typography.data}"
    padding: "6px 12px"
---

# Design System: Data File Viewer (Parquet, JSONL, Excel)

## Overview

**Creative North Star: "仪器舱 The Instrument Bay"**

VS Code 是机身，每个 viewer 是拧在机身上的仪表。仪表不拥有自己的配色：它读宿主的变量，主题换一次，仪表跟着换一次。颜色因此是稀缺资源，只花在信号上——一个值是什么类型、这里能点、搜索命中了哪几个字、这一列刚被选中。其余一切（面板、表头、工具栏、行底纹）都只是同一块底色被混入不同比例的前景，一个色相都不新增。

JSON 预览不是第四个 viewer，它是同一机身上的检查探头：命令打开，不接管 `.json`，读数语言与 JSONL 同源。记录列表、树、值面板和键盘不另起一套，只是把左栏从“行目录”换成“记录目录”。

密度就是效率。这套界面服务的是「打开一个 377 MB 的文件，三十秒内知道里面有什么」，所以行高、内距、字号都被压到还能读的下限：数据 12px 等宽，标签 10px 大写，顶栏 52px。装饰性留白、卡片、渐变、插画一概没有——它们不承担任何信息。

语气是冷静、精确、不解释。不做引导层、不写欢迎语、不加图标墙；空状态与错误只给一条事实和下一步（`没有匹配的行` + 清除按钮，`这个文件太大` + 用文本编辑器打开）。界面像 IDE 自带的一部分，而不是一个装进去的应用。

**Key Characteristics:**

- 每个表面都是「顶栏 / 主体 / 底栏」的 100vh flex 三件套，只有中间滚动。
- 颜色 100% 来自 `--vscode-*`，缺失时用暗色兜底；自造色只有两处，都必须在这里登记：① light 主题下的对比度修正值（六个数据色 + 一个 `--pv-muted: #5c5c5c`，后者不在调色板里，只修对比度）；② `highlight.less` 的 JSON token 色 `#f2cc60` / `#1f2328`（宿主没有等价的语法高亮 token，理由见该文件注释）。
- 零分割线、零装饰阴影；层次 = 底色亮度差（92% 底 + 8% 前景的那一类混合）。
- 所有数字 `tabular-nums`；所有「值」等宽，所有「标签」非等宽。
- 焦点永远是 1px `focusBorder` 描边（outline 或 inset ring），没有光晕、没有位移。
- JSON 预览是 Command preview：复用 JSONL 的 Splitter、记录行、树、值面板和键盘，不新增视觉世界，也不注册 `.json`。

## Colors

整体性格：**宿主主题的忠实副本，加一组只给信号的数据色。** 界面自己不做调色，只做取舍。

### Primary

- **Signal Blue** (#3794ff): 链接单元格、激活的字段行文字、列高亮底纹的色相来源（以 7%–12% 混入底色）。它是这套界面里唯一「可以点」的颜色。
- **Instrument Navy** (#0e639c): 按钮与文本选区的底色来源（`--vscode-button-background` 的兜底）。用于实心控件，不用于文字。

### Secondary

四个数据色，按「值是什么类型」分配，除此之外不承担任何语义。它们在浅色主题下有独立的深色版本（见下方规则）。

- **Numeric Cyan** (#4ea1ff): 数字单元格；同时是数字列的图标色。
- **String Moss** (#89d185): 字符串单元格、JSON 里的字符串 token、字符串列图标。
- **Boolean Amber** (#f0a45e): `true`；`false` 退成 muted，而不是换一个颜色。
- **Datetime Mauve** (#c586c0): 时间戳单元格与时间列图标。

### Tertiary

- **Skeleton Violet** (#b180d7): JSON 对象的键名、结构列图标。它标记「这是骨架，不是值」。
- **Focus Azimuth** (#0078d4): 所有焦点描边与输入框焦点环，来自 `--vscode-focusBorder`。
- **Danger Coral** (#f48771): 错误正文与错误底色（10% 混入）。错误是唯一允许出现的红色语义。

### Neutral

- **Editor Surface** (#1e1e1e): 数据区底色，`--vscode-editor-background`。
- **Panel Surface** (#252526): 侧栏、表头、类型徽标底，`--vscode-sideBar-background` 混 8% 前景。
- **Tab Surface** (#2d2d2d): 顶栏与底栏，`--vscode-editorGroupHeader-tabsBackground` 混 8% 前景。
- **Foreground** (#cccccc): 一层文字与数据，`--vscode-foreground`。
- **Muted Foreground** (#9d9d9d): 标签、计数、占位符、`false`、`NULL`、省略号 token。

### Named Rules

**The Borrowed Palette Rule.** 界面不拥有任何颜色。每个色值都写成 `var(--vscode-<token>, <兜底>)`；兜底只保证「主题变量缺失时仍然像 VS Code」，不构成一套独立配色。禁止新增与主题无关的品牌色。

**The One Host Lookup Rule.** 同一个宿主变量只读一次，语义差异用别名表达。parquet 的十个图标色原本各自重复读取四个 `--vscode-charts-*`：改一次颜色要改三处，且随时可能漂移。现在六个 `--pv-chart-*` 各读一次，图标色是它们的别名（`--pv-icon-rows` → `--pv-chart-blue`），由 `verify:ui` 的 `parquet-tokens` 断言别名图真的一致 —— 设计 token 只有在解析值一致时才算单一事实来源。

**The One Token Layer Rule.** 这个仓库只有一层 token：各组件的 `--pv-*` / `--jl-*` / 各自前缀，每个都写在**被引入的**样式表里。曾有一个 `viewerTheme.css` 定义十四变量 `--viewer-*` 层，声明得像其它视图在用：没有一处 import，构建产物里一个字都没有，`--viewer-accent` 指 `textLink-foreground` 而 `--pv-accent` 指 `button-background`。已删除；`test/unit/stylesheets.test.ts` 现在断言「`src/react` 下每个样式表都被某处引入」，孤儿样式表读起来像活代码，正是最难被发现的死代码。

若将来真要共享一层 token，顺序是：先把同名不同义的（accent：按钮 vs 链接）拆成两个名字，再让 token 声明**不带任何副作用**（字号、字体、滚动条另行作用域化），最后才谈合并 —— 否则「去重」就是悄悄改配色。

**The Chart-Colour Is Not Text Rule.** `--vscode-charts-*` 是为图形调过的色。12px 文本需要更高的对比度，所以浅色主题下这六个色被显式覆盖为同色相的更深值（`-on-light` 系列），并由 `verify:ui` 的 ≥4.5:1 断言守住。新增数据色必须同时给出浅色值，否则只能在图标上用。

**The Thin Mix Rule.** 层次只允许用 3.5%–22% 的前景混入表达：隔行底纹 3.5%、控件底 8%（hover 13%、按下 18%）、列高亮 7%（hover 11%）、激活行底 12%（hover 16%）、目标行 18%、搜索命中 22%。超过 22% 就不再是层次，而是第二个界面。

命中行原本是 18%，但它混进的 `editor.findMatchHighlightBackground` 自带 33% alpha，二次混合后只剩约 6% 的有效不透明度 —— 数值在规则内，观感在规则外。规则因此改成两条：**百分比按「最终不透明度」算，不按混入比例算**；混入源本身带 alpha 时，先换成不透明 token（`editor.findMatchBackground`）或改用实色兜底。22% 就是这条规则的边界值，不再上调。

## Typography

**Display Font:** 无。这套界面没有一处需要展示级字号。
**Body Font:** -apple-system / Segoe UI（真实来源是 `--vscode-font-family`）
**Label/Mono Font:** ui-monospace / SFMono-Regular / Menlo / Consolas（真实来源是 `--vscode-editor-font-family`）

**Character:** 一个宿主字体，两种用途：讲故事的字（说明、错误、按钮）用 UI 字体；只要是「值」——单元格、徽标、跳转后的行号、选中值预览——一律等宽。字号几乎不承担层级，10–13px 之间靠**大小写、字重、字距**区分层级。

### Hierarchy

- **Title** (600, 16px, 1.6): 只出现在「文件太大」这类决策面板标题。整个扩展最多两处。
- **Body** (400, 13px, 1.5): 顶栏之外的一切说明文字、空状态、错误正文、决策正文。
- **Data** (400, 12px 等宽, 22px 行高): 所有表格单元格与 JSONL 的键值文本。
- **Input** (400, 12px, 30px 行高): 搜索框、行号跳转框。
- **Meta value** (600, 12px, tabular): 顶栏的行数/列数/作者等计数。
- **Micro** (400, 11px): 密集 chrome 的次级元数据——计数、路径、状态、行号、值面板的类型与字符数、截断说明。它不是正文，也不承担层级；正文最低 12px。
- **Chrome label** (600, 10–10.5px, 0.045–0.08em 字距, 大写): 表头、侧栏标题、顶栏字段名。
- **Badge** (400, 9.5px 等宽): 类型徽标（`STRING`、`INT64`、`LIST`）。

### Named Rules

**The Two-Typeface Rule.** 只有两种字体，判据是「这是不是一个值」。把一个标签排成等宽，或把一个值排成 UI 字体，都是错的。

**The Uppercase-at-10px Rule.** 小号大写只允许出现在标签层，并且必须同时带 600 字重与 ≥0.045em 字距。低于这个组合，10px 的大写西文在浅色主题下会糊成一片。

**The Tabular Rule.** 任何可能对齐的数字都加 `font-variant-numeric: tabular-nums`：计数、行号、页码、单元格数字、JSON token 数字。数字在表里跳宽是不可接受的。

## Layout

**The Grid Reaches the Floor Rule.** 网格铺满到视口底部，不是长到内容高度就停。antd 6 把 loading 包装层渲染成 `.ant-spin`（4/5 叫 `.ant-spin-nested-loading`），类名对不上时下面连串的 `height: 100%` 会在 `auto` 父层上退化成内容高度 —— 整页差一行的余数（23px），六行的短页差 703px，露出编辑器底色，读起来像「多了一行空行」。空出来的那一截用行底色收边，再补一条 1px 细线说明表格到此为止；细线用 `box-shadow` 而不是 `border`，否则它会改变决定「一屏装几行」的那个测量值。`verify:ui` 的 `parquet-table-fills-viewport` 按几何断言守住整页与短页两种情况。

每个表面都是一个 `100vh` 的 flex column，`body` 被锁成 `100vw × 100vh` 且 `overflow: hidden`；只有内部容器滚动。

- **顶栏** 52px（`8px 16px`）：搜索框（32px 高，`flex: 0 1 340px`）、计数、元信息；右侧信息用 `margin-left: auto` 推到边缘。
- **主体** `flex: 1`。parquet 是「可拖拽侧栏 + 表格」，JSONL 是「目录 + 详情」，两侧都在自己内部滚。
- **底栏** 44px（`6px 16px`）：选中值预览（等宽、单行省略）+ 分页器（28px 按钮、固定宽度页码，避免翻页时抖动）。
- **可拖拽侧栏**：7px 手柄（`flex: 0 0 7px`，两侧 -3px 外扩命中区），`inset 10px 2.5px` 的 999px 药丸形高亮只在 hover/focus 时出现——手柄本身不可见。
- **密度**：表格 header `8px 12px`、cell `6px 12px`（行高 22px）；字段行最小 32px；JSONL 行 26px。
- **行宽**：单元格超过 420px 就省略号截断，不换行；换行只允许出现在 JSONL 详情树的叶子值。
- **断点**（只在 info-dense 的顶栏上生效）：1080px 隐掉 meta 的字段名、860px 隐掉作者、720px 隐掉整块 meta 并把侧栏压到 40vw、620px（JSONL）再收一档。

### Named Rules

**The Never-Scroll-the-Page Rule.** 页面本身永不滚动。用户在任何状态下都必须看得见顶栏与底栏；滚动条只允许出现在 `.ant-table-body`、`.parquet-viewer__list`、树容器这类明确的内容区内。

**The 420 Rule.** 数据单元格的 `max-width` 是 420px。要在单元格里放下更多信息，办法是点开看全文，不是让它换行把整张表撑高。

## Elevation & Depth

**没有阴影语义。** 层次完全由色调分层表达：同一块底色混入不同比例的前景（见 The Thin Mix Rule），相邻区域之间的边界是「亮度变化 + 8–16px 内距」，没有 1px 分割线。

本仓库自己的样式不再声明浮层阴影。唯一保留的 `box-shadow` 是 antd 自带的弹层/下拉菜单；表格铺满视口后底部那条 1px 内阴影（`inset 0 -1px 0`）只是收边，不是层级。输入类控件的「描边」用 `inset 0 0 0 1px` 模拟，不是阴影。

### Named Rules

**The No-Divider Rule.** 区域之间不加 1px 线。觉得两块区域糊在一起，就调混合比例或加内距，不要画线。

**The Inset Focus Rule.** 输入类焦点的表现是 `inset 0 0 0 1px var(--focus)` 的环；可聚焦的按钮/行是 `outline: 1px solid var(--focus)` 加 1px 或 -1px 偏移。两者都不加 blur、chevron、位移或颜色渐变。

## Shapes

形态语言是**方块 + 小圆角**，没有斜角、没有裁切、没有装饰性轮廓。

- 表面与浮层：**8px**（搜索框、错误条、决策面板）。
- 控件：**6px**（图标按钮、分页按钮、字段行、文本输入）。
- 徽标与工具提示内的小块：**4px**；单元格焦点：**3px**；高亮 `<mark>`：**2px**。
- 药丸 **999px** 只给三种：滚动条滑块、侧栏计数、拖拽手柄的高亮条。
- 边框几乎为零：控件是「有底色的块」，不是「有描边的框」；唯一例外是焦点环本身。
- 滚动条：10px 轨道全透明，滑块 999px 药丸 + 3px 透明边框（视觉上是 4px 细条），最小高度 32px。

## Components

### Buttons

- **Shape:** 小圆角方块（6px），无边框、无阴影。
- **Icon button**（搜索清除/上一个/下一个）: 26 × 26，图标 14px，默认 muted 前景，hover 时前景变亮且底变 `control-hover`，按下 `control-active`，禁用时 `opacity: 0.4`。
- **Pager button**: 28px 高、`0 5px` 内距、11px/500 文字；当前页码组用「固定宽度信息块」呈现（`min-width: 106px`），保证翻页时按钮不位移。
- **Hover / Focus**: 背景 0.12s ease 过渡；`focus-visible` 是 1px focusBorder outline。
- **Primary 实心按钮**只出现在决策面板（「用文本编辑器打开」），底色 `accent-navy`，形状同 6px。

### Inputs / Fields

- **Search field**: 32px 高、8px 圆角、底色 `--vscode-input-background`，内部是图标 + 无边框 `<input>` + 清除键。
- **Focus**: `:focus-within` 时加 `inset 0 0 0 1px var(--focus)`，**不加外发光**。
- **Row-jump field**: 92px 宽、28px 高、6px 圆角、11px 等宽数字，聚焦同样用 inset ring。
- **Placeholder**: muted 前景；**没有**错误态红色描边——错误用文字与 10% 底色的条，不用输入框变色。

### Field rows (signature)

侧栏的 schema 字段行是一个 `<button>`，整行可点，`aria-pressed` 表示当前列。

- **Shape:** 6px 圆角、`6px 8px` 内距、最小高度 32px、行间 1px 空隙。
- **Contents:** 类型图标（14px，按类型取色）+ 字段名（12px/500，单行省略）+ 空值率徽标（有统计时）+ 类型徽标（右对齐）。
- **Null share:** `null 12%`（9.5px 等宽、muted、无底色、`tabular-nums`）。它是视觉徽标，无统计时退成 `—`；整句走字段行的 `aria-label`（"Jump to column name — 12% of rows are null"），所以读者不需要猜这个百分数是什么。低于 1% 且非零显示 `null <1%`，不四舍五入成 0。
- **States:** hover 用 `list-hoverBackground`；激活行用 Signal Blue 12% 混入底色、字段名转 Signal Blue；`focus-visible` 用 `outline-offset: -1px`（贴内边，避免与相邻行粘连）。

### Type badges

等宽 9.5px、`2px 6px` 内距、4px 圆角、8% 前景的底色、muted 文字、最大宽度 94px 后省略号。它的职责是让「这一列是什么类型」不需要读图例。

### Table cells

- **Header:** `8px 12px`、10.5px/600/0.045em 大写、muted 前景、`panel` 底色；antd 自带的分隔线被强制移除。
- **Data cell:** `6px 12px`、12px 等宽、22px 行高、`editor-surface` 底色；隔行 3.5% 混入；hover 用 `list-hoverBackground`；命中行 18% 搜索色；目标行 18% accent。
- **Alignment:** 数字右对齐并等宽；布尔、时间、空值、链接、JSON 各自继承上面的数据色；`NULL` 是斜体 muted。
- **Link cell:** 整值是 `http(s)` 时立刻表现为链接：文字用 Signal Blue、下划线用 `currentColor` 45% 的 `text-decoration-color`（hover 时升到 100% 且加粗到 1.5px）。**不给链接加图标、不在单元格里导航。**
- **JSON cell:** 键名 Skeleton Violet、字符串 String Moss、数字 Numeric Cyan、布尔 Boolean Amber、标点与省略号 muted；超出 80 token / 320 字符即截断并补一个斜体省略号。

### Command bar & status bar

两条全宽条是唯一的「横向贯穿」元素，都使用 `panel-surface-strong`。它们之间的差别只有高度（52 / 44）与内距（`8px 16px` / `6px 16px`）——不做不同的底色、不加投影。

### Selection panel (JSONL, signature)

详情树的行只承担摘要：一行、单行省略、120 字符。**选中行之后，完整值在树的下沿一块停靠面板里读**，它不遮住树，也不是弹窗——检查值本来就是「读一个、对照下一个」的任务。

- **位置与形态**：停靠在底栏正上方，全宽，底色 `panel`；收起时 34px 一行，展开时正文 `max-height: 200px` 并在内部滚动。它属于详情面板，不改变底栏的 44px 结构。
- **收起行**：`路径`（11px 等宽、Skeleton Violet，最多 34% 宽、超出省略）＋`预览`（12px 等宽、单行省略）＋`类型 · 字符数`（11px 等宽、muted、tabular）＋方向朝上的 chevron。整行是一个 `<button>`，`aria-expanded` 说明状态；动作名走 `aria-label`（"Show full value" / "Collapse value"），视觉文本已经是路径和值、不再重复。
- **窄窗口**：≤720px 时隐藏字符数（它是最可牺牲的一段），把宽度让给路径与预览；路径仍最多 34%。
- **展开正文**：`pre-wrap` + `overflow-wrap: anywhere` 的等宽文本，最多 200,000 字符；超过时正文之前给一条 `--jl-warn` 的字符数说明。**复制永远是整值**，不是这个被截断的正文。正文是滚动区，`tabIndex=0`，否则键盘无法到达滚出 200px 的那部分。
- **交互**：点击收起行或按 `Enter` 切换；`Esc` 收起并把焦点还给收起行；`Ctrl+C` 复制值、`Ctrl+Shift+C` 复制路径。焦点用 1px `focusBorder` 内描边。
- **标量根**：一条记录本身就是长字符串时没有树行可选，面板直接把该条目当作选中值（路径显示 `L<n>`）。

### Directory load-more row (JSONL)

目录窗口按字节预算，极端行下可能只返回一两行；这种窗口填不满一屏，滚动条不会出现，滚动事件永远不会触发。因此目录末尾有一行显式的 **Load more entries**：11px、muted、hover 转前景色、加载中显示 `Loading…` 且禁用；它只在还有未加载条目时出现，不替代滚动到底自动加载。面板先自动补最多四轮，仍填不满就交给这一行。

- **禁止**：不要用 `title`、tooltip 或「复制到别处再读」承担这个职责；也不要把树改成换行来塞下全文（那会把虚拟列表和密度一起拆掉）。

### Reading a value (parquet)

单元格只负责「看一眼」，读全文的唯一通道是底栏的值面板：点底栏的值（或它自己的按钮）展开，浮在底栏上沿而不是挤进 flex 列 —— 挤进去会缩小被测量的表格高度，一页一屏的语义会让读者刚看的行被重新分页走。

面板三件事必须同时存在，缺一件就等于没有通道：**折行**（`white-space: pre-wrap`，3–6 行后滚动）、**两种形态**（格式化 / 原始：容器分别是缩进 JSON 与紧凑 JSON，字符串分别是原文与转义形式）、**尺寸与行号**（字符数、UTF-8 字节数、第几行），复制始终给未截断的值。

渲染上限 20 000 字符只约束面板，不约束复制 —— 一个 5 000 元素的 LIST 不能因为按了方向键就把整串塞进布局。

**禁止**：不要用 `title`、tooltip 或「复制到别处再读」承担这个职责（这也是 [P1-4](#) 的来源）；单元格与底栏都不再挂原生 `title`。

### JSON Preview (command surface, not a viewer)

**Mode:** Operate。它是同一机身上的命令式检查探头，不是第四个 viewer：不注册 `.json`、不改默认编辑器，也不新增视觉世界。打开后复用 JSONL 的 Splitter、树、值面板和键盘；左栏从“行目录”换成“记录目录”。

- **Shell**：与 JSONL 相同的 100vh 三件套；左栏默认 340px，可拖、按文件记住宽度；右栏是选中记录的树与底栏动作；值面板停靠在底栏上方。命令栏加文件身份（文件名、记录数）、搜索、刷新、“Open in Text Editor”；编辑器 buffer 来源用一枚 `--jl-warn` 小标记说明。
- **Record rail**：虚拟列表，行高与 JSONL 目录一致；`[index]`（11px 等宽、muted、tabular）＋身份标签（12px 等宽、单行省略）；无身份时回退原始 JSON 头；选中态用同款底色，不使用类型徽标（类型在记录头里说）。
- **Record detail**：复用 JSONL 的 `NodeModel` / `toAntdNodes` / 值面板；记录头显示 `[index] · type · size`；Tree/Raw 切换、Expand all/Collapse all、Copy value/path 全部复用。严格 JSON 的解析错误给行/列和“Open in Text Editor”。
- **Search**：全文件记录级；结果替换左栏，每行是 `[index]` ＋片段（`highlightRuns` 的 `<mark>`）＋命中数；选中结果后右栏展开到首个命中并高亮，其他可见命中同色；`Esc`/清空恢复记录列表。无命中只给事实和“清除搜索”，不写欢迎语。
- **Object root**：不显示记录列表，直接一棵树；对象根 ≤20 MB。搜索时左栏显示命中路径（不是记录），选中后展开并高亮；超过 20 MB 显示 too-large。
- **States**：索引中给一条状态（不显示百分比、不挡内容）；空数组/空对象、无命中、文件读取失败、数组 >100 MB、对象根 >20 MB 分别有明确事实和出口；不能编辑，不能 `title` 代替全文。
- **Entry**：命令面板 `Data File Viewer: Preview JSON`、资源管理器右键、JSON 编辑器标题三处；面板 tab 用文件名，不伪装成 `.json` 的默认编辑器。

### Empty & error states

- **Empty:** 居中、muted、13px、`min-height: 200px`；不带插画，不带「开始使用吧」这类话术。
- **No rows:** 28px 图标（opacity 0.65）+ 一句事实 + 一个「清除搜索」的出口。
- **Error:** 左对齐的条，8px 圆角、Danger Coral 10% 底色、13px/1.5 文字、16px 图标；按钮贴右（`margin-left: auto`）。
- **Overlay（加载中）:** 78% 底色 + `blur(2px)`，28px 图标 + 一句状态；不接受点击，也不显示进度百分比。

## Do's and Don'ts

### Do:

- **Do** 给每个新颜色写 `var(--vscode-<token>, <暗色兜底>)`，并在浅色主题的头像块里给出同色相的 text-safe 值。
- **Do** 用 8px 包表面、6px 包控件、4px 包徽标、3px 包单元格焦点；不要发明第四种半径。
- **Do** 给每个可交互元素同时写 `:hover`、`:active`、`:focus-visible` 三态，焦点用 1px `focusBorder`。
- **Do** 让所有数字带 `tabular-nums`，让所有「值」用等宽字体。
- **Do** 用 10px 大写 + 600 字重 + ≥0.045em 字距表达标签层级，并把其余文字留给 12–13px 常规字重。
- **Do** 用 `color-mix(in srgb, var(--fg) 8%, var(--panel))` 这一族混合造控件底，让深浅主题自动成立。
- **Do** 在新增数据色时同时更新 `scripts/ui-verify` 的对比度断言（浅色主题 ≥ 4.5:1），否则闸门会红。
- **Do** 给每个被摘要截断的值一条可选中、可复制的全文通道（JSONL 的停靠值面板），而不是 `title`、tooltip 或「复制出去再看」。
- **Do** 让窗口化视图的 `aria-rowcount` / `aria-colcount` 说**文件**的行列数，不是 DOM 里渲染的那一窗；`aria-rowindex` 与 `aria-colindex` 在表头与单元格两侧都要写。
- **Do** 让 JSON 预览复用 JSONL 的机身、记录行、树、值面板和键盘；它是命令打开的检查面，不注册 `.json`，也不改默认编辑器。

### Don't:

- **Don't** 引入自带配色、明暗开关或品牌渐变；主题是唯一色源。
- **Don't** 用 `box-shadow` 表达层级或 hover 抬起；只有真正浮在所有内容之上的东西才能有阴影。
- **Don't** 在区域之间加 1px 分割线——用底色混合与内距。
- **Don't** 用 `--vscode-charts-*` 直接渲染 12px 文本而不给浅色覆盖；那是为图形调的色。
- **Don't** 让 antd 的默认字号、颜色或边框漏出来；antd 只提供结构与交互，样式必须被 `--pv-*` / `--jl-*` 接管。
- **Don't** 让超过 420px 的单元格换行，或用 tooltip 代替「点开看全文」。
- **Don't** 加引导层、欢迎语、插画或空状态营销文案；空状态只给事实和下一步。
- **Don't** 把继承来的 `x-spreadsheet` 网格当作参照——它是遗留例外（只被部分重新着色），不属于这套系统。
- **Don't** 为 JSON 预览新造布局、颜色或字体，或把它写成第四个 viewer；也不要把 JSON 数组做成表格（本轮不是数据表）。
