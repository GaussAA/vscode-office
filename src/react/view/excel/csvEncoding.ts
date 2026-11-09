import iconv from "iconv-lite";

export type CsvEncoding = "utf8" | "gbk";

/** iconv-lite's signature wants a Node Buffer; a webview only has Uint8Array. */
type IconvInput = Parameters<typeof iconv.decode>[0];

function toUint8Array(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function stripUtf8Bom(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3);
  }
  return bytes;
}

export function isValidUtf8(buffer: ArrayBuffer): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(toUint8Array(buffer));
    return true;
  } catch {
    return false;
  }
}

export function detectCsvEncoding(buffer: ArrayBuffer): CsvEncoding {
  const bytes = toUint8Array(buffer);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf8";
  }
  return isValidUtf8(buffer) ? "utf8" : "gbk";
}

export function decodeCsvBuffer(buffer: ArrayBuffer): string {
  const encoding = detectCsvEncoding(buffer);
  if (encoding === "utf8") {
    return new TextDecoder("utf-8").decode(stripUtf8Bom(toUint8Array(buffer)));
  }
  // iconv-lite asks for a Node Buffer; it reads a Uint8Array fine, and a webview has no Buffer.
  return iconv.decode(toUint8Array(buffer) as unknown as IconvInput, "gbk");
}

/**
 * Decode once and report which encoding won.
 *
 * The old path decoded the whole file with `fatal: true` to test it, threw that string away and
 * decoded again: on a 152 MB CSV, 108 ms and a second full-size string for nothing.
 */
export function decodeCsvBufferWithEncoding(buffer: ArrayBuffer): {
  text: string;
  encoding: CsvEncoding;
} {
  const bytes = stripUtf8Bom(toUint8Array(buffer));
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf8" };
  } catch {
    return { text: iconv.decode(bytes as unknown as IconvInput, "gbk"), encoding: "gbk" };
  }
}

export function encodeCsvText(text: string, encoding: CsvEncoding): Uint8Array {
  if (encoding === "utf8") {
    return new TextEncoder().encode(text);
  }
  return new Uint8Array(iconv.encode(text, "gbk"));
}
