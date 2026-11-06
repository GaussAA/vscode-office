import markdownItFrontMatter from "markdown-it-front-matter";
import type MarkdownIt from "markdown-it";
import { parseYamlProperties, renderPropertiesPanel } from "../yamlProperties.ts";

type MarkdownItInstance = InstanceType<typeof MarkdownIt>;

/**
 * `markdown-it-front-matter` strips the YAML block and hands it to a callback. That callback
 * has to run *before* the render starts, but the panel belongs *above* the rendered body — so
 * the plugin renders the document first, then prepends whatever the callback captured.
 */
export default function markdownItFrontMatterExport(md: MarkdownItInstance): void {
  let frontMatterHtml = "";

  md.use(markdownItFrontMatter as never, (raw: string) => {
    const properties = parseYamlProperties(raw);
    frontMatterHtml = renderPropertiesPanel(properties, md.utils.escapeHtml);
  });

  const defaultRender = md.render.bind(md);
  md.render = function renderWithFrontMatter(src, env) {
    frontMatterHtml = "";
    const html = defaultRender(src, env);
    return frontMatterHtml ? `${frontMatterHtml}\n${html}` : html;
  };
}
