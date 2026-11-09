/**
 * Base64 for the webview bridge.
 *
 * `Webview.postMessage` is JSON, so the only two ways to ship a document's bytes inline are
 * an array of numbers (`JSON.stringify` turns each byte into up to 3 digits plus a comma) or a
 * base64 string (4 characters per 3 bytes). For a virtual document — GitHub Repos, a `git:`
 * history entry — the host has to send the bytes inline because the webview cannot `fetch`
 * them, so the array cost 5-8x the file in the message and in the webview's heap. A 20 MB
 * parquet spent ~70 MB of JSON on the bridge; it is ~27 MB as base64.
 *
 * `btoa`/`atob` exist in both the extension host (Node) and the webview, which is why this
 * module has no imports and is unit-testable without a browser.
 */

/** Encode bytes as standard base64. Chunked because `fromCharCode(...)` has an argument cap. */
export function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
