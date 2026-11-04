# packages/ — deep modules

这里的每个子目录都是一个 **deep module**：一个小的 **interface**，背后藏着大量的
**implementation**。接口越小、背后越多，**depth** 越高——调用方和测试为学到的东西付
出的成本就越少，改动的影响面（locality）也越集中。

规则不是靠自觉，而是由根目录的 `.dependency-cruiser.cjs` 强制，跑 `pnpm lint:boundaries`。

## Layout

```
packages/
  <name>/
    index.ts        ← entry point（公开）
    stats.ts        ← 另一个 entry point：一个包可以有多个
    lib/            ← implementation：子目录 = 私有
    tests/          ← 测试与 fixture：子目录 = 私有
```

**entry points 就是包的根文件**，而不是某个指定的 `index.ts`。根文件合起来构成这个包的
全部 interface；任何子目录里的东西都属于 implementation，外部只能通过 entry points 到达。

`lib/`（实现）和 `tests/`（测试）只是约定，规则本身看的是**深度**：包根 = 公开，任意子目录
= 私有。所以加一个新目录不需要改配置。

## 复制这个模板

```
packages/reports/
  index.ts                  ← interface：一小撮函数
  lib/aggregate.ts          ← implementation：真正干活的地方
  tests/reports.test.ts     ← 只 import "../index.ts"
```

```ts
// packages/reports/index.ts —— 根文件即接口
import { aggregate } from "./lib/aggregate.ts";

/** 删掉这个包，调用方就得各自重写一遍聚合逻辑：说明它值得存在。 */
export function buildReport(rows: Record<string, unknown>[]): string {
  return aggregate(rows);
}
```

```ts
// packages/reports/tests/reports.test.ts —— 和所有调用方走同一个 seam
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildReport } from "../index.ts"; // 只走 entry point
```

## 四条规则（全部 `error`）

1. **entry-point boundary**：包外的代码（app 或别的包）只能 import 该包的 entry points（根文件），
   不能碰它的任何子目录。
2. **intra-package freedom**：包自己的文件之间随便 import；`lib/` 里的东西可以自由组合。
3. **tests through entry points**：`<pkg>/tests/` 下的测试像所有调用方一样只走 entry points，
   可以 import 任意包的 entry points 和自己的 `tests/` fixture，但**不能** import 任何包的子目录
   （包括自己包的）。跨包的集成测试没问题，深导入不行。
4. **no cycles**：没有循环依赖。

## 别做 barrel

因为公开面是**每一个**根文件，一个包可以开出多个小 entry points（`index.ts`、`client.ts`、
`server.ts`），而不是把所有东西塞进一个巨大的 `index.ts`。**不要**用 barrel 把整棵子树
re-export 出来：barrel 会让 interface 退化成 implementation 的镜像，把私有面泄漏成公开面。

## 运行

```bash
pnpm lint:boundaries   # depcruise .
```

已接入 pre-commit hook，`git commit` 时会跑。
