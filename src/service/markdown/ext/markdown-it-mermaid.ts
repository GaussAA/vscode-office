import mermaid from "mermaid";
import MarkdownIt from "markdown-it";

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

interface PreferenceStore {
  get(key: string): string | undefined;
}

/**
 * `mermaid.loadPreferences` is a Vditor-era extension of the mermaid API: the editor calls it
 * when a user changes the diagram theme, and it expects the current values back.
 */
type MermaidWithPreferences = typeof mermaid & {
  loadPreferences?: (store: PreferenceStore) => Record<string, string>;
};

const mermaidRuntime = mermaid as MermaidWithPreferences;

const mermaidChart = (code: string): string => {
  // mermaid 12 made `parse()` asynchronous. A Markdown-It fence rule has to return a string
  // synchronously, so the result can no longer gate the output: the old `try { parse } catch`
  // would never fire and a bad diagram became an unhandled rejection. Validate for the sake
  // of surfacing nothing, absorb the rejection, and let the mermaid runtime in the exported
  // page report the error itself — it already renders its own error diagram.
  try {
    Promise.resolve(mermaid.parse(code)).catch(() => {});
  } catch {
    // Older synchronous throw paths (if any) must not escape either.
  }
  return `<div class="mermaid">${code}</div>`;
};

const MermaidPlugin = (md: MarkdownItInstance): void => {
  (md as MarkdownItInstance & { mermaid?: typeof mermaid }).mermaid = mermaid;
  mermaidRuntime.loadPreferences = (preferenceStore) => {
    let mermaidTheme = preferenceStore.get("mermaid-theme");
    if (mermaidTheme === undefined) {
      mermaidTheme = "default";
    }
    let ganttAxisFormat = preferenceStore.get("gantt-axis-format");
    if (ganttAxisFormat === undefined) {
      ganttAxisFormat = "%Y-%m-%d";
    }
    // `axisFormatter` was removed from mermaid's Gantt config in v10; the object is built
    // dynamically so the field survives for older runtimes that still read it.
    const config: Record<string, unknown> = {
      theme: mermaidTheme,
      gantt: {
        axisFormatter: [
          [
            ganttAxisFormat,
            (d: Date) => {
              return d.getDay() === 1;
            },
          ],
        ],
      },
    };
    mermaid.initialize(config as never);
    return {
      "mermaid-theme": mermaidTheme,
      "gantt-axis-format": ganttAxisFormat,
    };
  };

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
