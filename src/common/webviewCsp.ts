/**
 * Content-Security-Policy for the webview shell.
 *
 * `default-src 'none'` because every resource this page loads is either its own bundle or an
 * extension resource, both of which arrive through `${cspSource}`. The exceptions are there
 * for specific reasons:
 *
 * - `style-src 'unsafe-inline'`: antd is CSS-in-JS and injects `<style>` at runtime.
 * - `script-src 'wasm-unsafe-eval'`: the font viewer's woff2 decompressor is an Emscripten
 *   module; without it the font route cannot decode woff2 at all.
 * - `frame-src`: the EPUB viewer renders chapters in an iframe.
 * - `data:` / `blob:` on `img-src`, `media-src` and `connect-src`: converted images, archived
 *   entries and `readRange` responses are all served from blob or data URLs.
 *
 * The HTML preview panel is *not* covered by this: an `about:srcdoc` document inherits the
 * embedder's policy, so any `script-src` here would also block the page being previewed.
 * That panel isolates with the iframe sandbox instead — see `htmlPreviewShell.ts`.
 *
 * `'unsafe-eval'` is deliberately absent. epubjs bundles a `globalThis` polyfill that probes
 * with `new Function("return this")` and falls back to `window` when CSP blocks it, so the
 * probe is expected and harmless; `scripts/ui-verify/runner.mjs` filters exactly that one
 * violation and keeps every other one fatal.
 */
export function buildWebviewCsp(cspSource: string): string {
  return [
    `default-src 'none'`,
    `script-src ${cspSource} 'wasm-unsafe-eval'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    `media-src ${cspSource} data: blob:`,
    `frame-src ${cspSource} data: blob:`,
    `connect-src ${cspSource} data: blob:`,
    `worker-src ${cspSource} blob:`,
  ].join("; ");
}
