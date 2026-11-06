import assert from "node:assert/strict";
import test from "node:test";
import { convertMarkdownToHtml } from "@/service/markdown/markdown-pdf";

/**
 * The Markdown **export** path (`Export PDF` / `Export HTML` / `Export Docx`) is extension-host
 * code: `verify:ui` cannot see it (it renders webviews) and the smoke layer only asserts that
 * a `.md` file routes to the editor. So nothing has ever watched the plugin chain that turns a
 * document into the HTML that gets printed.
 *
 * That chain is exactly where a silent regression already happened once: `mermaid@12` made
 * `parse()` asynchronous, the fence plugin's `try/catch` stopped firing, and broken diagrams
 * turned into unhandled rejections instead of a `<pre>` fallback.
 *
 * `convertMarkdownToHtml(filename, type, text, config)` is the pure entry point; the fixture
 * filename only matters for image-path rewriting, which is skipped for `type: "html"`.
 */

const config = { breaks: true, type: ["html"] };
const render = (markdown) => convertMarkdownToHtml("/tmp/fixture.md", "html", markdown, config);

test("export: headings render with anchors", () => {
  const html = render("# Export heading\n");
  assert.match(html, /<h1[^>]*id="export-heading"/);
  assert.match(html, /Export heading/);
});

test("export: inline marks and task lists survive the plugin chain", () => {
  const html = render("- [x] done\n- [ ] pending\n\nSome ==marked== text.\n");
  assert.match(html, /<input[^>]*type="checkbox"/i, "the checkbox plugin did not run");
  assert.match(html, /<mark>marked<\/mark>/, "the mark plugin did not run");
});

test("export: katex turns inline math into katex markup", () => {
  const html = render("Euler: $e^{i\\pi}+1=0$\n");
  assert.match(html, /class="katex/, "inline math was not rendered by katex");
});

test("export: a mermaid fence becomes a diagram host, not a broken promise", () => {
  const html = render("```mermaid\ngraph TD; A-->B;\n```\n");
  assert.match(html, /class="mermaid/, "the mermaid fence did not produce a diagram host");
});

test("export: front matter becomes a properties panel and is not printed as body text", () => {
  const html = render("---\ntitle: Fixture\ntags: [a, b]\n---\n\nBody paragraph.\n");
  assert.match(html, /Body paragraph\./);
  assert.ok(!html.includes("title: Fixture"), "front matter leaked into the rendered body");
});

test("export: code fences are highlighted, not escaped into the void", () => {
  const html = render("```js\nconst answer = 42;\n```\n");
  assert.match(html, /<pre class='hljs'>/);
  assert.match(html, /answer/);
});

test("export: an empty document still renders", () => {
  assert.equal(typeof render(""), "string");
});
