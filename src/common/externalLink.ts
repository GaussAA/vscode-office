/**
 * The one place a string becomes an openable external URL.
 *
 * Webview values are untrusted: a parquet cell can contain `javascript:`, `file:` or a URL
 * carrying credentials. The webview decides whether a cell looks like a link with this
 * helper, and the host validates the message again before calling `env.openExternal`.
 * Keeping both sides on the same predicate is what makes the second check meaningful.
 */

const MAX_URL_LENGTH = 2_048;

/** C0/C1 controls are never part of a URL we want to hand to the operating system. */
function hasControlCharacters(text: string): boolean {
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

export function normalizeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > MAX_URL_LENGTH || hasControlCharacters(text)) return null;
  // Cheap prefix check first: a 2,000-character description should not pay for URL parsing
  // on every cell render just to learn it is not a link.
  const prefix = text.slice(0, 8).toLowerCase();
  if (!prefix.startsWith("http://") && !prefix.startsWith("https://")) return null;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  // Userinfo can leak credentials through the title bar, history and OS handlers. A data
  // cell has no reason to open such a URL; reject it rather than asking the user to judge.
  if (url.username || url.password) return null;
  return url.href;
}
