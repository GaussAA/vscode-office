/**
 * `vscode-html-to-docx` ships no type declarations (and no `@types` package), and its
 * `exports` map points at three builds with different shapes.
 *
 * Only one call site exists: `exportDocx` hands it the rendered HTML and treats the result as
 * a Blob-like with `arrayBuffer()`. Declaring exactly that keeps the surface honest instead of
 * letting the whole module become `any`.
 */
declare module "vscode-html-to-docx" {
  interface DocxResult {
    arrayBuffer(): Promise<ArrayBuffer>;
  }

  function htmlToDocx(
    htmlString: string,
    headerHTMLString?: string | null,
    documentOptions?: Record<string, unknown>,
    footerHTMLString?: string | null,
  ): Promise<DocxResult>;

  export default htmlToDocx;
}
