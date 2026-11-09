import assert from "node:assert/strict";
import test from "node:test";
import { decodeBase64, encodeBase64 } from "@/common/base64";

/**
 * The inline-bytes path exists for documents the webview cannot fetch (virtual workspaces).
 * A wrong answer here is not a slow preview, it is a corrupt parquet or a broken CSV, so the
 * round trip is pinned on the shapes that actually occur: empty, all byte values, and a payload
 * larger than the encoder's chunk.
 */

test("base64: round-trips every byte value", () => {
  const bytes = Uint8Array.from({ length: 256 }, (_, index) => index);

  assert.deepEqual([...decodeBase64(encodeBase64(bytes))], [...bytes]);
});

test("base64: round-trips past the chunk boundary", () => {
  const bytes = new Uint8Array(0x8000 * 2 + 7);
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 31) % 256;

  const decoded = decodeBase64(encodeBase64(bytes));

  assert.equal(decoded.length, bytes.length);
  assert.equal(decoded[0x8000], bytes[0x8000]);
  assert.equal(decoded[bytes.length - 1], bytes[bytes.length - 1]);
});

test("base64: an empty document encodes to an empty string", () => {
  assert.equal(encodeBase64(new Uint8Array(0)), "");
  assert.equal(decodeBase64("").length, 0);
});

test("base64: the encoding is standard, not url-safe", () => {
  // 0xfb 0xff is "u/8=" in standard base64; a url-safe encoder would produce "u_8=".
  assert.equal(encodeBase64(Uint8Array.from([0xfb, 0xff])), "+/8=");
});
