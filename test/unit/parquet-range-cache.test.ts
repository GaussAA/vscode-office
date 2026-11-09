import assert from "node:assert/strict";
import test from "node:test";
import { RangeCache, rangeBackedBuffer } from "@/react/util/parquetSource";

/**
 * The range layer is the difference between "one row group of bytes" and "the file twice"
 * for a big parquet file, so both of its promises are pinned here: identical concurrent
 * requests are one request, and a request a cached interval covers costs nothing.
 */

function bytes(length: number, fill: (index: number) => number): ArrayBuffer {
  const buffer = new ArrayBuffer(length);
  const view = new Uint8Array(buffer);
  for (let index = 0; index < length; index++) view[index] = fill(index);
  return buffer;
}

function text(buffer: ArrayBuffer): string {
  return String.fromCharCode(...new Uint8Array(buffer));
}

test("cache: an exact range is served without copying", () => {
  const cache = new RangeCache();
  const buffer = bytes(10, (index) => 65 + index);

  cache.set(0, 10, buffer);

  assert.equal(cache.get(0, 10), buffer);
});

test("cache: a sub-range of a cached interval is served from memory", () => {
  const cache = new RangeCache();
  cache.set(
    100,
    200,
    bytes(100, (index) => index),
  );

  const slice = cache.get(130, 140);

  assert.ok(slice);
  assert.equal(text(slice), text(bytes(10, (index) => 30 + index)));
});

test("cache: overlapping writes merge into one interval and keep both payloads", () => {
  const cache = new RangeCache();
  cache.set(
    0,
    10,
    bytes(10, () => 1),
  );
  cache.set(
    10,
    20,
    bytes(10, () => 2),
  );
  assert.equal(cache.cachedRanges, 2);

  cache.set(
    5,
    15,
    bytes(10, () => 3),
  );

  assert.equal(cache.cachedRanges, 1, "the three spans cover 0-20 contiguously");
  const all = cache.get(0, 20);
  assert.ok(all);
  // 0-5 from the first write, 5-15 from the last one, 15-20 from the second.
  assert.equal(text(all), "\u0001".repeat(5) + "\u0003".repeat(10) + "\u0002".repeat(5));
  assert.equal(cache.get(0, 10)?.byteLength, 10);
});

test("cache: writing bytes that are already held is ignored", () => {
  const cache = new RangeCache();
  cache.set(
    0,
    10,
    bytes(10, () => 1),
  );
  const before = cache.cachedBytes;

  cache.set(
    2,
    8,
    bytes(6, () => 9),
  );

  assert.equal(cache.cachedBytes, before);
  assert.equal(text(cache.get(2, 8) as ArrayBuffer), "\u0001".repeat(6));
});

test("cache: the range count is bounded and the least recently used interval goes first", () => {
  const cache = new RangeCache({ maxRanges: 2 });
  cache.set(
    0,
    10,
    bytes(10, () => 1),
  );
  cache.set(
    20,
    30,
    bytes(10, () => 2),
  );
  // Touch the first interval so the second one is the coldest.
  assert.ok(cache.get(0, 10));

  cache.set(
    40,
    50,
    bytes(10, () => 3),
  );

  assert.equal(cache.cachedRanges, 2);
  assert.ok(cache.get(0, 10), "the touched interval survives");
  assert.equal(cache.get(20, 30), undefined, "the cold interval was evicted");
});

test("cache: the byte budget evicts whole intervals", () => {
  const cache = new RangeCache({ maxBytes: 16 });
  cache.set(
    0,
    10,
    bytes(10, () => 1),
  );
  cache.set(
    20,
    30,
    bytes(10, () => 2),
  );

  assert.ok(cache.cachedBytes <= 16);
  assert.equal(cache.cachedRanges, 1);
});

/* --------------------------------------------------------------- the AsyncBuffer */

function fakeFetch(total: number) {
  const calls: Array<[number, number]> = [];
  const fetchImpl = async (_url: string, init?: { headers?: Record<string, string> }) => {
    const header = init?.headers?.Range ?? "";
    const match = /bytes=(\d+)-(\d+)/.exec(header);
    const start = Number(match?.[1] ?? 0);
    const end = Number(match?.[2] ?? total - 1);
    calls.push([start, end]);
    // Exactly the requested bytes; each byte encodes its absolute offset so a slice can be
    // checked without trusting the range arithmetic under test.
    const body = new Uint8Array(end - start + 1);
    for (let index = 0; index < body.length; index++) body[index] = (start + index) % 251;
    return {
      status: 206,
      arrayBuffer: async () => body.buffer,
      headers: new Headers({ "Content-Range": `bytes ${start}-${end}/${total}` }),
    };
  };
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function withFakeFetch<T>(
  total: number,
  run: (calls: Array<[number, number]>) => Promise<T>,
) {
  const real = globalThis.fetch;
  const { calls, fetchImpl } = fakeFetch(total);
  globalThis.fetch = fetchImpl;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = real;
  }
}

test("buffer: the same range requested twice at once is fetched once", async () => {
  await withFakeFetch(1000, async (calls) => {
    const file = rangeBackedBuffer("/big.parquet", 1000);

    // This is exactly what the viewer does on first paint: the visible page and the
    // prefetch compute the same plan and issue it before either response lands.
    const [first, second] = await Promise.all([file.slice(0, 400), file.slice(0, 400)]);

    assert.equal(calls.length, 1);
    assert.deepEqual([...new Uint8Array(first)], [...new Uint8Array(second)]);
  });
});

test("buffer: a repeated range is served from the cache", async () => {
  await withFakeFetch(1000, async (calls) => {
    const file = rangeBackedBuffer("/big.parquet", 1000);

    await file.slice(0, 400);
    await file.slice(0, 400);

    assert.equal(calls.length, 1);
  });
});

test("buffer: a narrower range inside a cached read costs no request", async () => {
  await withFakeFetch(1000, async (calls) => {
    const file = rangeBackedBuffer("/big.parquet", 1000);

    await file.slice(100, 500);
    const narrow = new Uint8Array(await file.slice(200, 260));

    assert.equal(calls.length, 1);
    assert.equal(narrow.length, 60);
    assert.ok(
      [...narrow].every((value, index) => value === (200 + index) % 251),
      "the slice must be the requested window, not the head of the cached chunk",
    );
  });
});

test("buffer: ranges are clamped to the file and empty ranges resolve empty", async () => {
  await withFakeFetch(1000, async (calls) => {
    const file = rangeBackedBuffer("/big.parquet", 1000);

    assert.equal((await file.slice(990, 2000)).byteLength, 10);
    assert.equal((await file.slice(500, 500)).byteLength, 0);
    assert.deepEqual(calls, [[990, 999]]);
  });
});

test("buffer: a response that ignores Range is an error, not silent garbage", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => ({
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(4),
    headers: new Headers(),
  })) as unknown as typeof fetch;
  try {
    const file = rangeBackedBuffer("/no-range.parquet", 1000);
    await assert.rejects(() => Promise.resolve(file.slice(0, 10)), /Range request failed/);
  } finally {
    globalThis.fetch = real;
  }
});
