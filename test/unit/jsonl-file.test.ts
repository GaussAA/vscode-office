import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildJsonlIndex } from "@/service/jsonlDocument";
import {
  JsonlFile,
  buildJsonlIndexFrom,
  fileByteSource,
  memoryByteSource,
} from "@/service/jsonlFile";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** A source that refuses to return more than `maxChunk` bytes per read, like a real file. */
function chunkedSource(bytes: Uint8Array, maxChunk: number) {
  const inner = memoryByteSource(bytes);
  let reads = 0;
  return {
    size: inner.size,
    get reads() {
      return reads;
    },
    async read(offset: number, length: number) {
      reads++;
      return inner.read(offset, Math.min(length, maxChunk));
    },
  };
}

for (const [name, text] of [
  ["trailing newline", '{"id":1}\n{"id":2}\n'],
  ["no trailing newline", '{"id":1}\n{"id":2}'],
  ["blank lines", '\n\n{"id":1}\n\n'],
  ["crlf", '{"id":1}\r\n{"id":2}\r\n'],
  ["single line", '{"id":1}'],
]) {
  test(`index: streaming equals the in-memory index (${name})`, async () => {
    const bytes = encode(text);
    const expected = buildJsonlIndex(bytes);
    const streamed = await buildJsonlIndexFrom(memoryByteSource(bytes));
    assert.deepEqual(streamed.offsets, expected.offsets);
    assert.equal(streamed.lineCount, expected.lineCount);
  });
}

test("index: streaming is chunk-size independent", async () => {
  const text = Array.from({ length: 50 }, (_, index) => `{"id":${index}}`).join("\n") + "\n";
  const bytes = encode(text);
  const expected = buildJsonlIndex(bytes);

  for (const chunk of [1, 7, 64, 1 << 20]) {
    const streamed = await buildJsonlIndexFrom(memoryByteSource(bytes), chunk);
    assert.deepEqual(streamed.offsets, expected.offsets, `chunk size ${chunk}`);
  }
});

test("index: an empty file has no lines", async () => {
  const index = await buildJsonlIndexFrom(memoryByteSource(new Uint8Array(0)));
  assert.deepEqual([index.lineCount, index.offsets.length], [0, 0]);
});

test("index: a long line split across reads is still one line", async () => {
  const bytes = encode('{"a":"' + "x".repeat(5000) + '"}\n{"b":1}\n');
  const source = chunkedSource(bytes, 512);
  const index = await buildJsonlIndexFrom(source, 512);

  assert.equal(index.lineCount, 2);
  assert.deepEqual(index.offsets, buildJsonlIndex(bytes).offsets);
  assert.ok(source.reads > 2, "the reader actually had to make several passes");
});

test("window: returns exactly the requested lines and a local index", async () => {
  const file = await JsonlFile.open(memoryByteSource(encode('{"id":1}\n{"id":2}\n{"id":3}\n')));

  const window = await file.window(1, 3);
  assert.equal(window.index.lineCount, 2, "two lines in the window");
  assert.equal(window.bytes.length, '{"id":2}\n{"id":3}\n'.length);
  const first = new TextDecoder().decode(window.bytes.subarray(0, window.index.offsets[1]));
  assert.equal(first, '{"id":2}\n');
});

test("window: an empty or inverted range yields nothing", async () => {
  const file = await JsonlFile.open(memoryByteSource(encode('{"id":1}\n')));
  assert.equal((await file.window(1, 1)).index.lineCount, 0);
  assert.equal((await file.window(2, 1)).index.lineCount, 0);
  assert.equal((await file.window(0, 0)).index.lineCount, 0);
});

test("window: the last window runs to the end of the file", async () => {
  const file = await JsonlFile.open(memoryByteSource(encode('{"id":1}\n{"id":2}')));
  const window = await file.window(1, 2);
  assert.equal(window.index.lineCount, 1);
  assert.equal(new TextDecoder().decode(window.bytes), '{"id":2}');
});

test("lineRange: the last line ends at the file size", async () => {
  const file = await JsonlFile.open(memoryByteSource(encode("aa\nbb")));
  assert.deepEqual(file.lineRange(0), { start: 0, end: 3 });
  assert.deepEqual(file.lineRange(1), { start: 3, end: 5 });
});

test("close: closes the underlying source", async () => {
  let closed = false;
  const source = {
    ...memoryByteSource(encode("x\n")),
    close: () => {
      closed = true;
    },
  };
  const file = await JsonlFile.open(source);
  file.close();
  assert.equal(closed, true);
});

test("fileByteSource: reads a real file by offset, across reads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsonl-src-"));
  const path = join(dir, "events.jsonl");
  const text = '{"id":1}\n{"id":2}\n{"id":3}';
  await writeFile(path, text, "utf8");

  try {
    const source = await fileByteSource(path);
    assert.equal(source.size, Buffer.byteLength(text));

    const head = await source.read(0, 8);
    assert.equal(new TextDecoder().decode(head), '{"id":1}');
    const tail = await source.read(text.length - 8, 100);
    assert.equal(new TextDecoder().decode(tail), '{"id":3}', "a read is clipped at EOF");
    assert.equal((await source.read(text.length, 10)).length, 0, "past the end yields nothing");

    const file = await JsonlFile.open(source);
    assert.equal(file.lineCount, 3);
    const window = await file.window(1, 3);
    assert.equal(window.index.lineCount, 2);
    file.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("window bounds: a byte budget cuts the window before the line count does", async () => {
  const rows = Array.from(
    { length: 20 },
    (_, index) => `{"id":${index},"pad":"${"x".repeat(500)}"}`,
  );
  const file = await JsonlFile.open(memoryByteSource(encode(`${rows.join("\n")}\n`)));

  // Two lines per KB; 2 KB of budget is about four lines even though 20 were requested.
  const end = file.advance(0, 20, 2 * 1024);
  assert.ok(end > 0 && end < 20, `advance returned ${end}`);
  assert.ok(file.byteLength(0, end) <= 2 * 1024);

  // A single line larger than the whole budget is still included.
  const one = await JsonlFile.open(
    memoryByteSource(encode(`{"a":"${"x".repeat(4096)}"}\n{"b":1}\n`)),
  );
  assert.equal(one.advance(0, 2, 1024), 1, "the first line must always be readable");
});

test("window bounds: byteLength is inclusive of the newline the offset covers", async () => {
  const text = '{"a":1}\n{"b":2}\n';
  const file = await JsonlFile.open(memoryByteSource(encode(text)));
  assert.equal(file.byteLength(0, 1), text.indexOf("\n") + 1);
  assert.equal(file.byteLength(0, 2), text.length);
  assert.equal(file.byteLength(1, 1), 0);
  assert.equal(file.byteLength(2, 9), 0, "past the end is empty, not negative");
});
