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
  /** Set when the host refused to read an oversized virtual document. */
  tooLarge?: boolean;
  /** Inline bytes, used for virtual documents instead of a fetchable path. */
  buffer?: number[];
  /** Read failure, rendered instead of the file. */
  error?: string;
  nonce?: number;
}
