---
status: accepted
---

# gitHistory 保留自己的 git 执行层，不换 `simple-git`

D6 原先的计划是「gitHistory 换 `simple-git`；`vscode.git` API 定为仓库事实的正统来源」。
动手前先读了现状，结论是**后半句已经成立，前半句不该做**。

## 后半句：已经是事实

`src/gitHistory/service/repoDiscovery.ts` 与 `provider/index.ts` 都走
`vscode.extensions.getExtension("vscode.git").exports.getAPI(1)`，拿不到就回退到自己的目录扫描。
`officeContent.ts` 里也是同一套。仓库「哪个文件夹是仓库」这个判断，正统来源的确是 VS Code 的
Git 扩展。

`findGit.ts` 找的是 **git 可执行文件**（`git.path` 配置 → `git --version` 校验），和
「哪个目录是仓库」是两件事，不冲突。

## 前半句：`simple-git` 会退化

`src/gitHistory/service/gitExecutor.ts` 是 159 行手写代码，其中 26 行是 `decodeGitOutput()`：

```
严格 UTF-8 解码 → 失败则 GBK → BIG5 → Shift_JIS → 最后 buffer.toString("utf-8") 带替换
```

这不是洁癖。git 的 `-c i18n.logOutputEncoding=utf-8` 只对**带 encoding 头**的 commit 生效；
没有该头的旧 commit，git 认为内容本来就是 UTF-8、不做转换，于是原始字节仍是系统区域编码。
在中文/日文 Windows 上那就是 GBK/CP936。

`simple-git@4.0.2` 的输出处理是一行：

```js
function U(t) {
  return (Array.isArray(t) ? Buffer.concat(t) : t).toString("utf-8");
}
```

硬编码 `utf-8`，没有可配的编码参数（`binary` 只影响是否返回 Buffer，不改变解码方式）。
换成它，中文 commit message 与含中文路径的 diff 会变成乱码 —— 而这正是这个 fork 主要用户
所在的环境。用 3.76 MB 的依赖 + 重写 3,933 行调用点，换来一个确定性退化，不值得。

同一文件里还有两个 `simple-git` 不提供的判断：

- `getErrorMessage()` 在 stderr/stdout 里按 `fatal|error|conflict|…` 挑**最能说明问题的那一行**，
  而不是把整段输出甩给用户；
- `getWarningMessage()` 把 warning 和 fatal 分开，前者作为 `GitSpawnResult.warning` 一路上报到 UI。

## Consequences

- `gitHistory/` 的执行层维持自研，理由记在这里，避免下一轮又把它当成「手搓的债」。
- `simple-git` **不进依赖**。将来若它提供了可配的解码方式，这条决定可以被推翻 —— 判据是
  `decodeGitOutput` 的行为能被完整表达，而不是「用了库」这件事本身。
- 与 ADR-0002「站在巨人肩膀上」不冲突：判据是「库能不能表达我们已有的行为」，不是「是不是
  自己写的」。同一个判据也让 `date-format`（50 个月未发布、两个调用点）换成了 6 行本地实现，
  方向相反、依据相同。
