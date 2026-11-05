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
 */
import type { AsyncBuffer } from 'hyparquet';

/** Keeps the range cache bounded; pages are read in column-chunk sized slices. */
const RANGE_CACHE_BYTES = 64 * 1024 * 1024;
const RANGE_CACHE_ENTRIES = 48;

export interface ParquetSource {
    file: AsyncBuffer;
    /** True when the resource answered range requests. */
    ranged: boolean;
    byteLength: number;
}

class RangeCache {
    private entries = new Map<string, ArrayBuffer>();
    private bytes = 0;

    get(key: string): ArrayBuffer | undefined {
        const hit = this.entries.get(key);
        if (!hit) return undefined;
        // refresh LRU position
        this.entries.delete(key);
        this.entries.set(key, hit);
        return hit;
    }

    set(key: string, value: ArrayBuffer) {
        if (this.entries.has(key)) return;
        this.entries.set(key, value);
        this.bytes += value.byteLength;
        while ((this.bytes > RANGE_CACHE_BYTES || this.entries.size > RANGE_CACHE_ENTRIES) && this.entries.size > 1) {
            const oldestKey = this.entries.keys().next().value as string;
            const oldest = this.entries.get(oldestKey);
            this.entries.delete(oldestKey);
            this.bytes -= oldest?.byteLength ?? 0;
        }
    }
}

function makeRangeBuffer(url: string, byteLength: number): AsyncBuffer {
    const cache = new RangeCache();
    return {
        byteLength,
        async slice(start: number, end?: number): Promise<ArrayBuffer> {
            const from = Math.max(0, Math.min(start, byteLength));
            const to = Math.max(from, Math.min(end ?? byteLength, byteLength));
            if (to <= from) return new ArrayBuffer(0);
            const key = `${from}-${to}`;
            const cached = cache.get(key);
            if (cached) return cached;

            const response = await fetch(url, {
                headers: { Range: `bytes=${from}-${to - 1}` },
            });
            if (response.status !== 206) {
                throw new Error(`Range request failed (${response.status})`);
            }
            const buffer = await response.arrayBuffer();
            cache.set(key, buffer);
            return buffer;
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
        const probe = await fetch(url, { headers: { Range: 'bytes=0-1' } });
        probeStatus = probe.status;
        const contentRange = probe.headers.get('Content-Range');
        if (probe.status === 206 && contentRange) {
            const total = Number(contentRange.split('/').pop());
            await probe.arrayBuffer();
            if (Number.isFinite(total) && total > 0) {
                console.info('[parquet] source: ranged', total, 'bytes');
                return { file: makeRangeBuffer(url, total), ranged: true, byteLength: total };
            }
        }
        if (probe.status === 200) {
            // The host ignored Range and sent the whole body — that body IS the file,
            // so keep it instead of downloading the same bytes twice.
            const buffer = await probe.arrayBuffer();
            console.info('[parquet] source: full (no range support)', buffer.byteLength, 'bytes');
            return { file: makeBufferFromArrayBuffer(buffer), ranged: false, byteLength: buffer.byteLength };
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
    console.info('[parquet] source: full', buffer.byteLength, 'bytes');
    return { file: makeBufferFromArrayBuffer(buffer), ranged: false, byteLength: buffer.byteLength };
}
