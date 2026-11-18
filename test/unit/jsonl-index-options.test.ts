import assert from "node:assert/strict";
import test from "node:test";
import { buildJsonlIndexFrom, memoryByteSource } from "@/service/jsonlFile";
import { JsonlIndexCancelled } from "@/service/jsonlIndexCancelled";

test("buildJsonlIndexFrom: calls onProgress after each chunk", async () => {
  const lines = Array.from({ length: 100 }, (_, i) => `{"id":${i}}`).join("\n");
  const source = memoryByteSource(new TextEncoder().encode(lines));
  const progress: number[] = [];

  await buildJsonlIndexFrom(source, 1024, {
    onProgress: (loaded, total) => progress.push(loaded),
  });

  assert.ok(progress.length > 0, "onProgress was called at least once");
  assert.ok(
    progress.every((v) => v <= source.size),
    "loaded never exceeds total",
  );
});

test("buildJsonlIndexFrom: cancel stops scan and throws", async () => {
  const lines = Array.from({ length: 10000 }, (_, i) => `{"id":${i}}`).join("\n");
  const source = memoryByteSource(new TextEncoder().encode(lines));
  let callCount = 0;
  const cancel = { cancelled: false };

  const promise = buildJsonlIndexFrom(source, 1024, {
    onProgress: () => {
      callCount++;
      if (callCount === 3) cancel.cancelled = true; // Cancel after 3rd chunk.
    },
    cancel,
  });

  await assert.rejects(promise, JsonlIndexCancelled, "scan should throw on cancel");
  assert.ok(callCount >= 3, "progress was called at least 3 times before cancel");
});

test("buildJsonlIndexFrom: no progress callback when option omitted", async () => {
  const lines = `{"a":1}\n{"b":2}`;
  const source = memoryByteSource(new TextEncoder().encode(lines));
  const index = await buildJsonlIndexFrom(source); // No options.
  assert.equal(index.lineCount, 2, "index built correctly without progress");
});
