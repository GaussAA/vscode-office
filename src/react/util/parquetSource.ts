/**
 * Parquet source for the webview.
 *
 * Opening a file used to mean `fetch(uri)` → the whole byte range in memory. That is
 * fine for a 5 MB file and fatal for a 500 MB one. So: probe the resource with a tiny
 * `Range` request first.
 *
 *  - 206 + `Content-Range` → the host honours ranges; back hyparquet with a lazy
 *    AsyncBuffer so it only ever pulls the footer and the pages it needs.
 *  - anything else (or a network error) → fall back to the single full fetch, which is
 *    exactly the old behaviour.
 *
 * Whether `vscode-webview://` honours `Range` differs per VS Code version and host
 * (desktop vs web), which is why this probes instead of assuming.
 *
 * Two things about *how* the bytes are cached, both learned from measuring a real file:
 *
 *  1. The same byte range may be asked for twice at the same time. hyparquet plans a read
 *     per call, and the viewer issues the visible page and its prefetch back to back; both
 *     compute the same plan, so both fetch it. Measured on a 12.6 MB file: 26.9 MB of
 *     traffic for the first page, i.e. exactly two copies. A write-after-response cache
 *     cannot help there — the second request starts before the first one lands — so
 *     requests are deduplicated while in flight.
 *  2. A later request may be *smaller* than what is already cached (the footer inside a
 *     column chunk, or page 1's 50 rows inside page 2's range). An exact-key cache misses
 *     those; the cache is a set of intervals now, and a request that a cached interval
 *     covers is served from memory.
 */
import type { AsyncBuffer } from "hyparquet";

/** Keeps the range cache bounded; pages are read in column-chunk sized slices. */
const RANGE_CACHE_BYTES = 64 * 1024 * 1024;
const RANGE_CACHE_RANGES = 48;

export interface ParquetSource {
  file: AsyncBuffer;
}

/** One contiguous span of bytes already in memory. Intervals never overlap. */
interface CachedRange {
  start: number;
  end: number;
  buffer: ArrayBuffer;
  /** Monotonic access stamp; the lowest one is evicted first. */
  used: number;
}

export interface RangeCacheOptions {
  maxBytes?: number;
  maxRanges?: number;
}

/**
 * LRU over byte intervals rather than over exact keys.
 *
 * `get` accepts any range a cached interval contains, and `set` merges overlapping
 * intervals into one buffer so a hover-repeated pattern (footer, then the chunk that
 * contains it) keeps a single copy.
 */
export class RangeCache {
  private readonly ranges: CachedRange[] = [];
  private readonly maxBytes: number;
  private readonly maxRanges: number;
  private bytes = 0;
  private clock = 0;

  constructor(options: RangeCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? RANGE_CACHE_BYTES;
    this.maxRanges = options.maxRanges ?? RANGE_CACHE_RANGES;
  }

  /** Bytes for `[start, end)`, or undefined when no cached interval covers all of it. */
  get(start: number, end: number): ArrayBuffer | undefined {
    for (const range of this.ranges) {
      if (range.start > start || range.end < end) continue;
      range.used = ++this.clock;
      if (range.start === start && range.end === end) return range.buffer;
      return range.buffer.slice(start - range.start, end - range.start);
    }
    return undefined;
  }

  set(start: number, end: number, buffer: ArrayBuffer): void {
    if (end <= start || buffer.byteLength < end - start) return;
    // Already held: copying a second copy of the same bytes is pure waste.
    if (this.get(start, end)) return;

    const overlapping = this.ranges.filter((range) => range.start < end && range.end > start);
    const unionStart = Math.min(start, ...overlapping.map((range) => range.start));
    const unionEnd = Math.max(end, ...overlapping.map((range) => range.end));
    // A fetch returns exactly the requested bytes; keeping the buffer avoids copying every
    // chunk a second time on the way into the cache.
    const payload = buffer.byteLength === end - start ? buffer : buffer.slice(0, end - start);

    if (overlapping.length === 0) {
      const entry = { start, end, buffer: payload, used: ++this.clock };
      this.ranges.push(entry);
      this.bytes += entry.buffer.byteLength;
      this.evict();
      return;
    }

    const merged = new ArrayBuffer(unionEnd - unionStart);
    const view = new Uint8Array(merged);
    for (const range of overlapping) {
      view.set(new Uint8Array(range.buffer), range.start - unionStart);
      this.bytes -= range.buffer.byteLength;
      this.ranges.splice(this.ranges.indexOf(range), 1);
    }
    // Written last: the freshly fetched bytes win over anything they overlap.
    view.set(new Uint8Array(payload), start - unionStart);
    this.ranges.push({ start: unionStart, end: unionEnd, buffer: merged, used: ++this.clock });
    this.bytes += merged.byteLength;
    this.evict();
  }

  /** Visible for tests and for reasoning about the budget. */
  get cachedBytes(): number {
    return this.bytes;
  }

  get cachedRanges(): number {
    return this.ranges.length;
  }

  private evict(): void {
    while (
      (this.bytes > this.maxBytes || this.ranges.length > this.maxRanges) &&
      this.ranges.length > 1
    ) {
      let oldest = 0;
      for (let index = 1; index < this.ranges.length; index++) {
        if (this.ranges[index].used < this.ranges[oldest].used) oldest = index;
      }
      this.bytes -= this.ranges[oldest].buffer.byteLength;
      this.ranges.splice(oldest, 1);
    }
  }
}

/**
 * An `AsyncBuffer` over a URL that only fetches the byte ranges hyparquet asks for.
 *
 * Identical concurrent requests share one promise: the viewer's first paint asks for the
 * same plan twice (visible page + prefetch), and without this the file is downloaded twice.
 */
export function rangeBackedBuffer(url: string, byteLength: number): AsyncBuffer {
  const cache = new RangeCache();
  const inFlight = new Map<string, Promise<ArrayBuffer>>();
  return {
    byteLength,
    slice(start: number, end?: number): Promise<ArrayBuffer> {
      const from = Math.max(0, Math.min(start, byteLength));
      const to = Math.max(from, Math.min(end ?? byteLength, byteLength));
      if (to <= from) return Promise.resolve(new ArrayBuffer(0));
      const cached = cache.get(from, to);
      if (cached) return Promise.resolve(cached);

      const key = `${from}-${to}`;
      const existing = inFlight.get(key);
      if (existing) return existing;

      const request = fetch(url, { headers: { Range: `bytes=${from}-${to - 1}` } }).then(
        async (response) => {
          if (response.status !== 206) {
            throw new Error(`Range request failed (${response.status})`);
          }
          const buffer = await response.arrayBuffer();
          cache.set(from, to, buffer);
          return buffer;
        },
      );
      inFlight.set(key, request);
      // Settle the bookkeeping on both outcomes; the caller still sees the rejection.
      void request.then(
        () => inFlight.delete(key),
        () => inFlight.delete(key),
      );
      return request;
    },
  };
}

function makeBufferFromArrayBuffer(buffer: ArrayBuffer): AsyncBuffer {
  return {
    byteLength: buffer.byteLength,
    slice(start: number, end?: number) {
      return buffer.slice(start, end ?? buffer.byteLength);
    },
  };
}

export async function openParquetSource(url: string): Promise<ParquetSource> {
  // Probe with the smallest useful request: two bytes.
  let probeStatus = 0;
  try {
    const probe = await fetch(url, { headers: { Range: "bytes=0-1" } });
    probeStatus = probe.status;
    const contentRange = probe.headers.get("Content-Range");
    if (probe.status === 206 && contentRange) {
      const total = Number(contentRange.split("/").pop());
      await probe.arrayBuffer();
      if (Number.isFinite(total) && total > 0) {
        console.info("[parquet] source: ranged", total, "bytes");
        return { file: rangeBackedBuffer(url, total) };
      }
    }
    if (probe.status === 200) {
      // The host ignored Range and sent the whole body — that body IS the file,
      // so keep it instead of downloading the same bytes twice.
      const buffer = await probe.arrayBuffer();
      console.info("[parquet] source: full (no range support)", buffer.byteLength, "bytes");
      return { file: makeBufferFromArrayBuffer(buffer) };
    }
    await probe.arrayBuffer().catch(() => undefined);
  } catch {
    // fall through to the plain fetch below
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch (${response.status}, probe ${probeStatus})`);
  }
  const buffer = await response.arrayBuffer();
  console.info("[parquet] source: full", buffer.byteLength, "bytes");
  return { file: makeBufferFromArrayBuffer(buffer) };
}
