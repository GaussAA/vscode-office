---
status: accepted
---

# 模块系统：整棵树 ESM，`out/` 用 `package.json` 划回 CommonJS

D9-step2。仓库此前是「ESM 语法 + 默认 CJS 语义」：`src/**/*.ts` 全用 `import`/`export`，但
`package.json` 没有 `type`，于是 Node 把每个 `.js` 都当 CJS。这带来两个具体代价：

1. **`tsx` 用不了。** 同一个 `.ts` 在测试里被当成 CJS，`import` 被降级成 `require`，
   默认导出的 ESM 模块会多包一层 `{ default: … }`，`hyparquet` 这类只暴露子路径的包直接
   `ERR_PACKAGE_PATH_NOT_EXPORTED`。想跑 `tsx --test` 就得先让 `.ts` 真的是 ESM。
2. **半吊子的混合模块。** `src/service/markdown/*.js` 曾经同时出现 `require`、`import` 和
   `export` —— 只有 esbuild 能读懂它们，`tsc`、`oxlint`、Node 都读不懂。

## 决定

根 `package.json` 加 `"type": "module"`，同时**在 `out/` 里生成一个
`{"type": "commonjs"}` 的 `package.json`**。

`out/` 那个文件是整条决定的支点。扩展宿主是 CommonJS：VS Code 用 `require()` 加载 `main`，
而重依赖被打成扁平文件 `out/node_modules/<name>.js`，也靠 `require()` 解析。根变成 ESM 后，
`out/` 下所有 `.js` 会跟着变成 ESM —— `require()` 会走 Node 的 ESM 互操作，`module.exports`
直接失效。

在 `out/` 放一个 `package.json` 把作用域划回 CJS，就能同时满足三件事：

- `main` 保持 `./out/extension.js`，不动打包路径、不动 `.vscodeignore`、不动 `vsce`；
- 扁平 external 继续用 `out/node_modules/<name>.js` 命名（换成 `.cjs` 后 CJS 解析器就找不到
  它们了，因为 `LOAD_AS_FILE` 只补 `.js`/`.json`/`.node`）；
- `scripts/check-bundled-imports.mjs` 监控的路径与语义都不变。

它由 `build.ts` 的 `writeOutPackageJson()` 每次构建生成 —— `vite.config.ts` 会先 `rm -rf out`，
所以不能只写一次。

## Consequences

- `.ts`/`.mjs` 全部按 ESM 解析，`tsx` 的前置条件就位（D9a）。
- `out/` 里多一个 4 行的 `package.json`，随 vsix 发布。**打包后必须验**：解压 vsix，从
  `extension/out/` 里 `require()` 每个 external —— 五个全部 OK（见本次提交的验证）。
- 「`out/` 是 CJS 作用域」这件事没有类型系统保护。防线是两层：smoke 会真的让 VS Code 加载
  扩展（`out/package.json` 丢了就是加载失败），以及 `check-bundled-imports.mjs` 保证不会出现
  只有 ESM 解析器才认的裸动态 `import()`。
