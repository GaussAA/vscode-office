/**
 * A file identity that is cheap to compare across the host and the webview.
 *
 * `key` is the stable document identity (scheme + URI); `size` and `mtimeMs` answer
 * "are these the same bytes?" without reading them. A missing mtime is represented by
 * `null` and means "do not disk-cache this document" — virtual documents have no stat.
 */
export interface FileFingerprint {
  key: string;
  size: number;
  mtimeMs: number;
}

/** Same document, same bytes? Used by cache lookups before decoding a stored payload. */
export function sameFileFingerprint(
  left: Pick<FileFingerprint, "size" | "mtimeMs"> | null | undefined,
  right: Pick<FileFingerprint, "size" | "mtimeMs"> | null | undefined,
): boolean {
  if (!left || !right) return false;
  return left.size === right.size && left.mtimeMs === right.mtimeMs;
}
