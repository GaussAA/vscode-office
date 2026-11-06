import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import hljs from "highlight.js";
import markdownIt from "markdown-it";
import markdownItAnchor from "markdown-it-anchor";
import markdownItMark from "markdown-it-mark";
import markdownItObsidianCallouts from "markdown-it-obsidian-callouts";
import markdownItToc from "markdown-it-toc-done-right";
import mustache from "mustache";
import { parse } from "node-html-parser";
import { toDisplayText } from "@/common/displayText";
import { katex as markdownItKatex } from "@mdit/plugin-katex";
import { plantuml as markdownItPlantuml } from "@mdit/plugin-plantuml";
import { tasklist as markdownItCheckbox } from "@mdit/plugin-tasklist";
import markdownItFrontMatterExport from "./ext/markdown-it-front-matter";
import markdownItMermaid from "./ext/markdown-it-mermaid";
import markdownItObsidian from "./ext/markdown-it-obsidian";
import { exportByType } from "./html-export";

type MarkdownItInstance = InstanceType<typeof markdownIt>;

/**
 * Everything the exporter forwards from `MarkdownService.getConfig()`. The PDF/DOCX branches
 * pass the remaining keys straight through to puppeteer / `vscode-html-to-docx`, so unknown
 * keys are allowed on purpose.
 */
export interface MarkdownExportConfig {
  type: string;
  styles?: string[];
  withoutOutline?: boolean;
  breaks?: boolean;
  executablePath?: string;
  puppeteerArgs?: string[];
  [key: string]: unknown;
}

export interface ConvertMarkdownOptions {
  markdownFilePath: string;
  config: MarkdownExportConfig;
  /** Absolute path of the installed extension (`ExtensionContext.extensionPath`). */
  extensionRoot: string;
  outputFileType?: string;
}

async function convertMarkdown(
  inputMarkdownFile: string,
  config: MarkdownExportConfig,
  extensionRoot: string,
) {
  const type = config.type;
  // Only `fsPath` is ever used (for the document title), so this path needs no `vscode` at all —
  // which is what lets the export chain be unit-tested without a host stub.
  const uri = { fsPath: inputMarkdownFile };
  const text = fs.readFileSync(inputMarkdownFile).toString();
  const content = convertMarkdownToHtml(inputMarkdownFile, type, text, config);
  const html = mergeHtml(content, uri, type, extensionRoot);

  // insert mermaid script
  let outputHtml = html;
  const root = parse(html);
  const containsMermaid = root.querySelector(".mermaid") != null;
  if (containsMermaid) {
    const mermaidScript = `
    <script src="${getMermaidScriptSrc(type, extensionRoot)}"></script>
    <script>mermaid.initialize({startOnLoad:true});</script>
    `;
    outputHtml = appendHtmlToBody(outputHtml, mermaidScript);
  }

  await exportByType(inputMarkdownFile, outputHtml, type, config);
}

function getMermaidScriptSrc(type: string, extensionRoot: string): string {
  if (type === "html") {
    return `https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js`;
  }
  return pathToFileURL(
    path.resolve(extensionRoot, "resource", "markdown", "dist", "js", "mermaid", "mermaid.min.js"),
  ).href;
}

/**
 * create toc if not exists.
 */
function addTocToContent(text: string, config: MarkdownExportConfig): string {
  const needOutline = !text.match(/\[toc\]/i) && !config.withoutOutline;
  if (!needOutline) {
    return text;
  }
  const frontMatterMatch = text.match(/^---[\s\S]*?\n---\s*\n?/);
  if (frontMatterMatch) {
    return frontMatterMatch[0] + "[toc]\n" + text.slice(frontMatterMatch[0].length);
  }
  return `[toc]\n${text}`;
}

/*
 * convert markdown to html (markdown-it)
 */
export function convertMarkdownToHtml(
  filename: string,
  type: string,
  text: string,
  config: MarkdownExportConfig,
): string {
  if (type === "pdf") {
    text = addTocToContent(text, config);
  }

  try {
    console.log("[pretty-md-pdf] Converting (convertMarkdownToHtml) ...");
    const md: MarkdownItInstance = markdownIt({
      html: true,
      breaks: config.breaks,
      highlight(str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            str = hljs.highlight(lang, str, true).value;
          } catch (error) {
            str = md.utils.escapeHtml(str);
            showErrorMessage("markdown-it:highlight", error);
          }
        } else {
          str = md.utils.escapeHtml(str);
        }
        return "<pre class='hljs'><code><div>" + str + "</div></code></pre>";
      },
    });

    // convert the img src of the markdown
    const defaultImageRender = md.renderer.rules.image;
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      const srcIndex = token.attrIndex("src");
      let href = token.attrs && srcIndex >= 0 ? String(token.attrs[srcIndex][1]) : "";
      if (type === "html") {
        href = decodeURIComponent(href).replace(/[""]/g, "");
      } else {
        href = convertImgPath(href, filename);
      }
      if (token.attrs && srcIndex >= 0) {
        token.attrs[srcIndex][1] = href;
      }
      if (!defaultImageRender) {
        return "";
      }
      return defaultImageRender(tokens, idx, options, env, self);
    };

    if (type !== "html") {
      // convert the img src of the html
      md.renderer.rules.html_block = (tokens) => {
        const html = tokens[0].content;
        const root = parse(html);
        root.querySelectorAll("img").forEach((img) => {
          const src = img.getAttribute("src") ?? "";
          img.setAttribute("src", convertImgPath(src, filename));
        });
        return root.toString();
      };
    }

    md.use(markdownItFrontMatterExport)
      .use(markdownItObsidian)
      .use(markdownItObsidianCallouts)
      .use(markdownItMark)
      .use(markdownItCheckbox)
      .use(markdownItAnchor)
      .use(markdownItToc)
      .use(markdownItKatex)
      .use(markdownItPlantuml)
      .use(markdownItMermaid);

    return md.render(text);
  } catch (error) {
    showErrorMessage("convertMarkdownToHtml()", error);
    return "";
  }
}

/*
 * make html
 */
function mergeHtml(
  content: string,
  uri: { fsPath: string },
  type: string,
  extensionRoot: string,
): string {
  try {
    const title = path.basename(uri.fsPath);
    const style = readStyles(type, extensionRoot);
    const templatePath = path.join(extensionRoot, "out", "template", "template.html");
    return mustache.render(readFile(templatePath), { title, style, content });
  } catch (error) {
    showErrorMessage("makeHtml()", error);
    return "";
  }
}

function appendHtmlToBody(html: string, fragment: string): string {
  if (html.includes("</body>")) {
    return html.replace("</body>", `${fragment}</body>`);
  }
  return `${html}${fragment}`;
}

function isExistsPath(target: string): boolean {
  if (target.length === 0) {
    return false;
  }
  try {
    fs.accessSync(target);
    return true;
  } catch (error) {
    console.warn((error as Error).message);
    return false;
  }
}

function readFile(filename: string, encode: BufferEncoding = "utf-8"): string {
  let target = filename;
  if (target.indexOf("file://") === 0) {
    if (process.platform === "win32") {
      target = target.replace(/^file:\/\/\//, "").replace(/^file:\/\//, "");
    } else {
      target = target.replace(/^file:\/\//, "");
    }
  }
  if (isExistsPath(target)) {
    return fs.readFileSync(target, encode);
  }
  return "";
}

/** `new URL()` throws on Windows drive letters, so the protocol probe has to swallow that. */
function protocolOf(href: string): string | null {
  try {
    return new URL(href).protocol;
  } catch {
    return null;
  }
}

function convertImgPath(src: string, filename: string): string {
  try {
    let href = decodeURIComponent(src);
    href = href.replace(/[""]/g, "").replace(/\\/g, "/").replace(/#/g, "%23");
    const protocol = protocolOf(href);
    if (protocol === "file:" && href.indexOf("file:///") !== 0) {
      return href.replace(/^file:\/\//, "file:///");
    } else if (protocol === "file:") {
      return href;
    } else if (!protocol || path.isAbsolute(href)) {
      href = path.resolve(path.dirname(filename), href).replace(/\\/g, "/").replace(/#/g, "%23");
      if (href.indexOf("//") === 0) {
        return "file:" + href;
      } else if (href.indexOf("/") === 0) {
        return "file://" + href;
      }
      return "file:///" + href;
    }
    return src;
  } catch (error) {
    showErrorMessage("convertImgPath()", error);
    return src;
  }
}

function makeCss(filename: string, resolveRelativeUrls = false, type = "pdf"): string {
  try {
    let css = readFile(filename);
    if (css) {
      if (resolveRelativeUrls) {
        css = resolveCssUrls(css, path.dirname(filename), type);
      }
      return "\n<style>\n" + css + "\n</style>\n";
    }
    return "";
  } catch (error) {
    showErrorMessage("makeCss()", error);
    return "";
  }
}

function resolveCssUrls(css: string, basePath: string, type: string): string {
  return css.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, _quote, assetPath: string) => {
    const href = assetPath.trim();
    if (/^(data:|https?:|file:|about:|#)/i.test(href)) {
      return match;
    }
    if (type === "html" && basePath.includes("katex")) {
      return `url("https://cdn.jsdelivr.net/npm/katex@0.16.2/dist/${href.replace(/^\.\//, "")}")`;
    }
    return `url("${pathToFileURL(path.resolve(basePath, href)).href}")`;
  });
}

function readStyles(type: string, extensionRoot: string): string {
  try {
    const basePath = path.join(extensionRoot, "out", "styles");
    const katexPath = path.resolve(
      extensionRoot,
      "resource",
      "markdown",
      "dist",
      "js",
      "katex",
      "katex.min.css",
    );
    const files = ["arduino-light.css", "markdown.css", "markdown-pdf.css"];
    return (
      files.map((file) => makeCss(path.join(basePath, file))).join("") +
      makeCss(katexPath, true, type)
    );
  } catch (error) {
    showErrorMessage("readStyles()", error);
    return "";
  }
}

function showErrorMessage(msg: string, error?: unknown): void {
  console.error("ERROR: " + msg);
  if (error != null) {
    console.error(error instanceof Error ? error.message : toDisplayText(error));
  }
}

export const convertMd = async (options: ConvertMarkdownOptions): Promise<void> => {
  const config = options.config;
  options.outputFileType = config.type[0];
  console.log(`[pretty-md-pdf] Converting markdown file: ${options.markdownFilePath}`);
  await convertMarkdown(path.resolve(options.markdownFilePath), config, options.extensionRoot);
};
