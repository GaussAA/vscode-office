/**
 * Point the webview shell's `<base>` at the URI the host actually serves its assets from.
 *
 * This used to be `html.replace('<base href="/">', …)` — a byte-for-byte match on the tag.
 * `oxfmt` reformatted `index.html`, turned `<base href="/">` into `<base href="/" />`, and the
 * replacement silently stopped matching: the base stayed `/`, every `./assets/*.js` resolved
 * against the webview origin root instead of the extension's `out/webview`, and the parquet
 * viewer rendered a black page. Nothing caught it — the UI suite serves the built HTML itself
 * and the smoke test only asserts which editor routed the file.
 *
 * Two rules follow from that:
 *
 * 1. Match the tag tolerantly (attribute order aside, `>` and ` />` both count), so a
 *    formatter cannot change the meaning of the markup.
 * 2. **Throw when the tag is missing.** A silent no-op is what made this a shipped bug; a
 *    missing `<base>` means the shell cannot work at all, so failing loudly is correct.
 */
const BASE_TAG = /<base\s+href\s*=\s*(["'])[^"']*\1\s*\/?>/i;

export function applyWebviewBase(html: string, baseUrl: string): string {
  if (!BASE_TAG.test(html)) {
    throw new Error(
      "webview shell has no <base href> tag — the webview cannot resolve its own assets",
    );
  }
  // One trailing slash on the base; the HTML uses relative URLs like `./assets/app.js`.
  return html.replace(BASE_TAG, `<base href="${baseUrl.replace(/\/+$/, "")}/" />`);
}

/** Escape a value for a double-quoted HTML attribute. */
export function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Inline the webview config into `data-config`.
 *
 * The shell declares the attribute with double quotes (`data-config="{{configs}}"`). Raw
 * `JSON.stringify` output contains double quotes, so the browser ends the attribute at the
 * first one, `JSON.parse` gets `{`, and the whole React root never mounts — a blank editor.
 * Escape the JSON before it becomes an attribute value instead.
 */
export function applyWebviewConfig(html: string, configs: unknown): string {
  return html.replace("{{configs}}", escapeHtmlAttribute(JSON.stringify(configs)));
}
