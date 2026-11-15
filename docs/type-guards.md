# 类型守卫

`src/common/typeGuards.ts` 提供运行时检查，用来代替 `as` 断言。测试在 `test/unit/type-guards.test.ts`。

## 工具函数

| 类别           | 函数                                                                                  |
| -------------- | ------------------------------------------------------------------------------------- |
| 基本类型       | `isString` `isNumber` `isBoolean` `isObject` `isArray` `isNullish` `isNonEmptyString` |
| 属性检查       | `hasProperty` `hasStringProperty` `hasNumberProperty`                                 |
| 带默认值的读取 | `getStringProperty` `getNumberProperty` `getBooleanProperty`                          |
| 断言           | `assertDefined` `assertString` `assertNumber`                                         |
| 穷尽检查       | `assertNever`（放在 `switch` 的 `default`，漏处理新分支时编译失败）                   |

## 用法

```ts
// 不要：(data as any).name
if (hasStringProperty(data, "name")) {
  use(data.name); // 已收窄为 string
}

const timeout = getNumberProperty(raw, "timeout", 5000); // 缺失或类型不对时返回默认值
```

## 重构模式

1. **属性存在性**：`hasProperty(v, "x") && typeof v.x === "string"` 取代 `(v as {x?: string}).x`。
2. **错误消息**：`catch (e)` 里用 `e instanceof Error ? e.message : String(e)`，不要写 `(e as Error).message`。
3. **DOM 目标**：`if (!(event.target instanceof HTMLElement)) return;` 取代 `event.target as HTMLElement`。
4. **复杂转换**：逐层 `instanceof` / `hasProperty`，最后一层给安全回退（例如 `new Uint8Array(0)`），不要假设形状。
5. **必须保留的断言**：第三方类型缺失时允许，但要在上一行写明原因。

## 约定

- 新代码不写 `as`；确实需要时写注释说明。
- 边界处（消息、文件内容、配置）一律先守卫再使用。
