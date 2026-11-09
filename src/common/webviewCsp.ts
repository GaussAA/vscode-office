/**
 * Content-Security-Policy for the webview shell.
 *
 * `default-src 'none'` because every resource this page loads is either its own bundle or an
 * extension resource, both of which arrive through `${cspSource}`. The exceptions are there
 * for specific reasons:
 *
 * - `style-src 'unsafe-inline'`: antd is CSS-in-JS and injects `<style>` at runtime.
 * - `script-src 'wasm-unsafe-eval'`: `hyparquet-compressors` compiles a WebAssembly module to
 *   decode SNAPPY/ZSTD/BROTLI/LZ4 column chunks. Without it the parquet viewer cannot open a
 *   compressed file at all.
 * - `data:` / `blob:` on `img-src` and `connect-src`: spreadsheet images and the parquet
 *   viewer's `readRange` responses are served from blob or data URLs.
 *
 * `'unsafe-eval'` stays blocked. `frame-src`, `media-src` and `worker-src` used to exist for the
 * HTML preview panel, the archive viewer and pdf.js; all three were removed in 6.0.0, and
 * `webview-csp.test.ts` now asserts those directives are absent so they cannot quietly return.
 */
export function buildWebviewCsp(cspSource: string): string {
  return [
    `default-src 'none'`,
    `script-src ${cspSource} 'wasm-unsafe-eval'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    `connect-src ${cspSource} data: blob:`,
  ].join("; ");
}
