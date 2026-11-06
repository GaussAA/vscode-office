/**
 * `markdown-it-mark` (==highlight==) ships no types and no `@types` package.
 *
 * The surface is one plugin function plus an optional options object; a `unknown`-free
 * signature is enough for `md.use()`.
 */
declare module "markdown-it-mark" {
  import type MarkdownIt from "markdown-it";
  const markPlugin: (
    md: InstanceType<typeof MarkdownIt>,
    options?: Record<string, unknown>,
  ) => void;
  export default markPlugin;
}

/**
 * `markdown-it-obsidian-callouts` ships no types.
 *
 * Option names come from its README: `inline` turns `[!note]` prefixes inside a blockquote
 * into a callout box, `tagName` changes the wrapper element.
 */
declare module "markdown-it-obsidian-callouts" {
  import type MarkdownIt from "markdown-it";
  interface ObsidianCalloutsOptions {
    tagName?: string;
    inline?: boolean;
    callouts?: Array<{
      keyword: string;
      color?: string;
      svg?: string;
      title?: string;
    }>;
  }
  const obsidianCalloutsPlugin: (
    md: InstanceType<typeof MarkdownIt>,
    options?: ObsidianCalloutsOptions,
  ) => void;
  export default obsidianCalloutsPlugin;
}
