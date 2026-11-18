/**
 * The `open` message every office viewer receives from the host.
 *
 * Typed in one place because it has two producers — a real file URI and a virtual document
 * read into memory — and one consumer per viewer. When these were `Record<string, unknown>`,
 * a host that forgot `size` still compiled and the viewer's size guard silently stopped
 * firing; now the omission is a type error.
 */
export interface OfficeOpenMessage {
  /** Lowercase extension including the dot (`.csv`). */
  ext: string;
  /** A webview URI for `file:` documents, the document URI string otherwise. */
  path: string;
  fileName: string;
  /** `file`, `vscode-vfs`, `git`, … — decides how "open anyway" fetches the bytes. */
  scheme: string;
  documentCacheId: string;
  readOnly: boolean;
  /** Byte size when the scheme can answer; undefined means "unknown", never "small". */
  size?: number;
  /**
   * Last-modified time in milliseconds when the host could stat the document. Together with
   * `size` it is the fingerprint the parquet share cache uses; absent means "cannot validate",
   * so a cached scan is not reused.
   */
  mtimeMs?: number;
  /** Set when the host refused to read an oversized virtual document. */
  tooLarge?: boolean;
  /**
   * Clear parquet-derived caches before rendering this document.
   *
   * Set by the Clear cache command when it ran with no parquet view open; the next parquet
   * open then removes the stored shares/UI state before it can paint the old ones. Other
   * viewers ignore it.
   */
  clearCache?: boolean;
  /**
   * The host has a workbook row cache for this document (ADR-0027). The webview asks for the
   * cached metadata before fetching/parsing; absent means the path is unavailable (virtual
   * documents, harness stubs, CSV/TSV) and the viewer fetches and parses as before.
   */
  hostWorkbook?: boolean;
  /**
   * The host has a cached CSV record index for this document (ADR-0028). The webview asks for
   * it before scanning; absent means scan as before (virtual documents, harness stubs, TSV is
   * included only when the provider sets it).
   */
  hostCsv?: boolean;
  /**
   * Inline bytes for a virtual document, base64-encoded.
   *
   * A `number[]` costs 5-8x the file on the JSON bridge; base64 costs 4/3.
   */
  bufferBase64?: string;
  /** Legacy inline bytes (harness stubs and older senders). Prefer `bufferBase64`. */
  buffer?: number[];
  /** Read failure, rendered instead of the file. */
  error?: string;
  nonce?: number;
}
