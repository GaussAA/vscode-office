import assert from "node:assert/strict";
import test from "node:test";
import { openParquetSource } from "@/react/util/parquetSource";

/**
 * openParquetSource branch coverage: probe responses, fallback paths, and error handling.
 *
 * The logic has five outcomes:
 *  1. 206 + valid Content-Range → rangeBackedBuffer (lazy fetch per hyparquet request)
 *  2. 200 (ignores Range) → asyncBufferFrom(probe body) (keep the full response)
 *  3. 206 but invalid/missing total → fallback fetch → asyncBufferFrom
 *  4. Probe throws → fallback fetch → asyncBufferFrom
 *  5. Both probe and fallback fail → throw with status
 */

function stubFetch(
  probeResponse: {
    status: number;
    headers?: Record<string, string>;
    body?: ArrayBuffer;
    throwOnArrayBuffer?: boolean;
  },
  fallbackResponse?: { status: number; body?: ArrayBuffer },
): typeof fetch {
  let calls = 0;
  return (async (url: string, init?: RequestInit) => {
    calls++;
    if (calls === 1) {
      // Probe request
      if (probeResponse.status === 0) throw new Error("Network error");
      const headers = new Headers(probeResponse.headers ?? {});
      return {
        status: probeResponse.status,
        headers,
        ok: probeResponse.status >= 200 && probeResponse.status < 300,
        async arrayBuffer() {
          if (probeResponse.throwOnArrayBuffer) throw new Error("Body already consumed");
          return probeResponse.body ?? new ArrayBuffer(2);
        },
      } as Response;
    } else {
      // Fallback fetch
      if (!fallbackResponse) throw new Error("Unexpected fallback fetch");
      if (fallbackResponse.status === 0) throw new Error("Fallback network error");
      return {
        status: fallbackResponse.status,
        ok: fallbackResponse.status >= 200 && fallbackResponse.status < 300,
        async arrayBuffer() {
          return fallbackResponse.body ?? new ArrayBuffer(10);
        },
      } as Response;
    }
  }) as unknown as typeof fetch;
}

async function withFetch<T>(stub: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

test("openParquetSource: 206 with valid Content-Range returns rangeBackedBuffer", async () => {
  const stub = stubFetch({
    status: 206,
    headers: { "Content-Range": "bytes 0-1/1000" },
  });

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 1000);
  // rangeBackedBuffer is lazy; confirm it by checking that a slice triggers a fetch
  const realFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return {
      status: 206,
      headers: new Headers({ "Content-Range": "bytes 0-9/1000" }),
      async arrayBuffer() {
        return new ArrayBuffer(10);
      },
    } as Response;
  }) as unknown as typeof fetch;
  await source.file.slice(0, 10);
  globalThis.fetch = realFetch;
  assert.equal(fetchCalled, true, "rangeBackedBuffer should fetch lazily");
});

test("openParquetSource: 200 response keeps the probe body", async () => {
  const body = new ArrayBuffer(1234);
  const stub = stubFetch({ status: 200, body });

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 1234);
  // Confirm it's the same buffer by slicing it
  const slice = await source.file.slice(0, 100);
  assert.equal(slice.byteLength, 100);
});

test("openParquetSource: 206 without Content-Range falls back to full fetch", async () => {
  const stub = stubFetch({ status: 206 }, { status: 200, body: new ArrayBuffer(500) });

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 500);
});

test("openParquetSource: 206 with unparseable total falls back to full fetch", async () => {
  const stub = stubFetch(
    { status: 206, headers: { "Content-Range": "bytes 0-1/*" } },
    { status: 200, body: new ArrayBuffer(600) },
  );

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 600);
});

test("openParquetSource: 206 with zero total falls back to full fetch", async () => {
  const stub = stubFetch(
    { status: 206, headers: { "Content-Range": "bytes 0-1/0" } },
    { status: 200, body: new ArrayBuffer(700) },
  );

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 700);
});

test("openParquetSource: probe network error falls back to full fetch", async () => {
  const stub = stubFetch({ status: 0 }, { status: 200, body: new ArrayBuffer(800) });

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 800);
});

test("openParquetSource: 416 Range Not Satisfiable falls back to full fetch", async () => {
  const stub = stubFetch({ status: 416 }, { status: 200, body: new ArrayBuffer(900) });

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 900);
});

test("openParquetSource: fallback fetch failure throws with both statuses", async () => {
  const stub = stubFetch(
    { status: 206, headers: { "Content-Range": "bytes 0-1/*" } },
    { status: 404 },
  );

  await assert.rejects(
    () => withFetch(stub, () => openParquetSource("/test.parquet")),
    /Failed to fetch \(404, probe 206\)/,
  );
});

test("openParquetSource: both probe and fallback throw", async () => {
  const stub = stubFetch({ status: 0 }, { status: 0 });

  await assert.rejects(
    () => withFetch(stub, () => openParquetSource("/test.parquet")),
    /network error/i,
  );
});

test("openParquetSource: 206 with negative total falls back", async () => {
  const stub = stubFetch(
    { status: 206, headers: { "Content-Range": "bytes 0-1/-5" } },
    { status: 200, body: new ArrayBuffer(100) },
  );

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 100);
});

test("openParquetSource: 206 missing Content-Range header falls back", async () => {
  const stub = stubFetch({ status: 206, headers: {} }, { status: 200, body: new ArrayBuffer(200) });

  const source = await withFetch(stub, () => openParquetSource("/test.parquet"));

  assert.equal(source.file.byteLength, 200);
});
