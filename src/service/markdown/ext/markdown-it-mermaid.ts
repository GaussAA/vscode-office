import type MarkdownIt from "markdown-it";

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

/**
 * Turn mermaid fences (and bare `graph`/`gantt`/`sequenceDiagram` blocks) into a host element
 * that the *rendered page* draws: `markdown-export` injects `mermaid.min.js` and
 * `mermaid.initialize({ startOnLoad: true })` next to the output whenever a `.mermaid` host
 * exists, so the diagram is rendered by the page's mermaid, not by the extension.
 *
 * There used to be an `import mermaid from "mermaid"` here, used only to call `mermaid.parse()`
 * and discard the result — a Markdown-It fence rule must return a string synchronously, so the
 * verdict could never reach the output, and the promise was swallowed anyway (mermaid 12 made
 * `parse()` async). It added ~1 MB to the extension bundle for a validation that changed
 * nothing, plus a `import("katex")` that could not resolve from the packaged layout. Both gone.
 */
const mermaidChart = (code: string): string => `<div class="mermaid">${code}</div>`;

const MermaidPlugin = (md: MarkdownItInstance): void => {
  const rules = md.renderer.rules;
  const defaultFence = rules.fence!;
  rules.fence = (tokens, idx, options, env, slf) => {
    const token = tokens[idx];
    const code = token.content.trim();
    if (token.info === "mermaid") {
      return mermaidChart(code);
    }
    const firstLine = code.split(/\n/)[0].trim();
    if (
      firstLine === "gantt" ||
      firstLine === "sequenceDiagram" ||
      firstLine.match(/^graph (?:TB|BT|RL|LR|TD);?$/)
    ) {
      return mermaidChart(code);
    }
    return defaultFence(tokens, idx, options, env, slf);
  };
};

export default MermaidPlugin;
