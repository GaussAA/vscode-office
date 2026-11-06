import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ByteSource } from "@/service/jsonlFile";
import { openByteSource, type UriLike } from "@/service/jsonlSource";

const encoder = new TextEncoder();

function tempFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), "jsonl-source-"));
  const path = join(dir, "log.jsonl");
  writeFileSync(path, contents);
  return { dir, path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const readAllBytes = async (
  offset: number,
  length: number,
  source: ByteSource,
): Promise<string> => {
  const chunk = await source.read(offset, length);
  return new TextDecoder().decode(chunk);
};

test("source: a file: document is read from disk, not from the supplied bytes", async () => {
  const { path, cleanup } = tempFile("from-disk\n");
  try {
    // The callback would win if the scheme branch were wrong.
    const source = await openByteSource({ scheme: "file", fsPath: path }, async () =>
      encoder.encode("from-callback\n"),
    );
    assert.equal(await readAllBytes(0, 1024, source), "from-disk\n");
    assert.equal(source.size, "from-disk\n".length);
    await source.close?.();
  } finally {
    cleanup();
  }
});

test("source: any other scheme falls back to the bytes the caller can read", async () => {
  // A closure writes it, so a plain `let` stays narrowed to `null` for the compiler.
  const asked: UriLike[] = [];
  const source = await openByteSource({ scheme: "untitled", fsPath: "Untitled-1" }, async (uri) => {
    asked.push(uri);
    return encoder.encode("virtual\nbytes\n");
  });
  assert.equal(asked.length, 1, "the read callback ran");
  assert.equal(asked[0].scheme, "untitled", "the callback receives the original uri");
  assert.equal(await readAllBytes(0, 1024, source), "virtual\nbytes\n");
  assert.equal(source.size, "virtual\nbytes\n".length);
});

test("source: a pruned read is clamped to the document, never past its end", async () => {
  const source = await openByteSource({ scheme: "memfs", fsPath: "/a" }, async () =>
    encoder.encode("abc"),
  );
  assert.equal(await readAllBytes(2, 100, source), "c");
  assert.equal((await source.read(10, 5)).byteLength, 0, "reading past EOF yields no bytes");
});
