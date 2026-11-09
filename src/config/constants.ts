/**
 * 项目全局配置常量
 *
 * 所有硬编码的配置值应集中在此文件中，便于：
 * 1. 统一管理和修改
 * 2. 测试时覆盖配置
 * 3. 文档化配置决策
 *
 * 注意：部分配置已在特定模块中定义（如 previewLimit.ts, sheetView.ts），
 * 此文件主要集中其他分散的硬编码常量。
 */

/**
 * VS Code 平台要求
 */
export const VSCODE = {
  /** 最低支持的 VS Code 版本 */
  MIN_VERSION: "1.125.0",

  /** 引擎声明（用于 package.json engines.vscode） */
  ENGINE: "^1.125.0",
} as const;

/**
 * Git 历史查看器配置
 */
export const GIT_HISTORY = {
  /** 行高（像素） */
  ROW_HEIGHT: 28 as number,

  /** 表头高度（像素） */
  HEADER_HEIGHT: 28 as number,

  /** 初始加载的最大提交数 */
  INITIAL_MAX_COMMITS: 300 as number,

  /** 滚动加载更多时每次加载的提交数 */
  LOAD_MORE_COMMITS: 100 as number,

  /** 需要警告的 Git 操作（如 merge） */
  WARNING_ACTIONS: new Set(["merge"]) as ReadonlySet<string>,
};

/**
 * 性能相关配置
 */
export const PERFORMANCE = {
  /** 主题变化防抖延迟（毫秒） */
  THEME_DEBOUNCE_MS: 120,

  /** 窗口 resize 防抖延迟（毫秒） */
  RESIZE_DEBOUNCE_MS: 150,

  /** 搜索输入防抖延迟（毫秒） */
  SEARCH_DEBOUNCE_MS: 300,
} as const;

/**
 * UI 布局配置
 */
export const UI_LAYOUT = {
  /** Parquet 侧边栏最小宽度（像素） */
  PARQUET_SIDER_MIN: 200,

  /** Parquet 侧边栏最大宽度（像素） */
  PARQUET_SIDER_MAX: 600,

  /** JSONL 分割视图默认左侧宽度比例 */
  JSONL_DEFAULT_LEFT_WIDTH: 0.5,
} as const;

/**
 * 开发/调试配置
 */
export const DEBUG = {
  /** 是否启用详细日志（可通过环境变量覆盖） */
  VERBOSE: process.env.OFFICE_VIEWER_DEBUG === "true",

  /** 是否启用性能监控 */
  PERFORMANCE_MONITORING: false,
} as const;

/**
 * 类型辅助：确保配置对象是只读的
 */
type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends object ? DeepReadonly<T[P]> : T[P];
};

/**
 * 完整的配置对象（类型安全 + 只读）
 */
export const CONFIG: DeepReadonly<{
  VSCODE: typeof VSCODE;
  GIT_HISTORY: typeof GIT_HISTORY;
  PERFORMANCE: typeof PERFORMANCE;
  UI_LAYOUT: typeof UI_LAYOUT;
  DEBUG: typeof DEBUG;
}> = {
  VSCODE,
  GIT_HISTORY,
  PERFORMANCE,
  UI_LAYOUT,
  DEBUG,
} as const;

/**
 * 默认导出配置对象
 */
export default CONFIG;
