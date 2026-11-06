/**
 * Byte access for the JSONL viewer: the host must not hold the whole file.
 *
 * A `JsonlFile` is a line-addressable view over a `ByteSource`. It keeps the line-start
 * offsets (8 bytes per line, which is what makes a million-line file cheap) and reads only
 * the byte window a request needs, one window at a time.
 *
 * Two adapters, deliberately: the desktop extension can random-read a `file:` URI in chunks
 * (peak memory is one chunk, regardless of file size), while a virtual/remote file falls back
 * to holding the bytes it was already given. The module itself imports neither `vscode` nor
 * `fs`, so both paths are exercised by `node --test`.
 */
import { buildJsonlIndex, type JsonlIndex } from "@/service/jsonlDocument";

/** Random access to a file's bytes. */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}

/** A window of the file plus an index local to that window. */
export interface ByteWindow {
  bytes: Uint8Array;
  index: JsonlIndex;
}

/** Bytes are already in memory: virtual documents, workspaces, and every unit test. */
export function memoryByteSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.byteLength,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const from = Math.max(0, Math.min(offset, bytes.byteLength));
      const to = Math.max(from, Math.min(offset + length, bytes.byteLength));
      return bytes.subarray(from, to);
    },
  };
}

/**
 * Random access to a real file. Only the desktop host can do this (`file:` URIs); the web
 * bundle maps `node:fs/promises` to a stub that throws if it is ever reached, which it is not.
 */
export async function fileByteSource(fsPath: string): Promise<ByteSource> {
  const { promises: fsp } = await import("node:fs");
  const handle = await fsp.open(fsPath, "r");
  const { size } = await handle.stat();
  return {
    size,
    async read(offset: number, length: number): Promise<Uint8Array> {
      const capacity = Math.min(length, Math.max(0, size - offset));
      if (capacity <= 0) return new Uint8Array(0);
      const buffer = new Uint8Array(capacity);
      const { bytesRead } = await handle.read(buffer, 0, capacity, offset);
      return buffer.subarray(0, bytesRead);
    },
    close: async () => {
      await handle.close();
    },
  };
}

/** Chunk size for the streaming index pass. Big enough to amortise, small enough to bound memory. */
export const INDEX_CHUNK_BYTES = 1024 * 1024;

/**
 * Build the line index without ever holding the file: read it in chunks and remember the
 * absolute offset of every `\n`.
 */
export async function buildJsonlIndexFrom(
  source: ByteSource,
  chunkSize = INDEX_CHUNK_BYTES,
): Promise<JsonlIndex> {
  if (source.size === 0) {
    return { offsets: [], lineCount: 0 };
  }
  const offsets: number[] = [0];
  for (let position = 0; position < source.size; position += chunkSize) {
    const length = Math.min(chunkSize, source.size - position);
    const chunk = await source.read(position, length);
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === 0x0a) offsets.push(position + i + 1);
    }
  }
  // A trailing newline terminates the last line; it does not start an empty one.
  if (offsets.length > 1 && offsets[offsets.length - 1] >= source.size) {
    offsets.pop();
  }
  return { offsets, lineCount: offsets.length };
}

export class JsonlFile {
  private constructor(
    readonly source: ByteSource,
    readonly index: JsonlIndex,
  ) {}

  /** Read the size and build the index. Nothing else is retained. */
  static async open(source: ByteSource): Promise<JsonlFile> {
    return new JsonlFile(source, await buildJsonlIndexFrom(source));
  }

  get lineCount(): number {
    return this.index.lineCount;
  }

  get byteSize(): number {
    return this.source.size;
  }

  /** Byte offset where `line` starts, and where it ends (exclusive, newline included). */
  lineRange(line: number): { start: number; end: number } {
    const start = this.index.offsets[line] ?? this.source.size;
    const end = line + 1 < this.index.lineCount ? this.index.offsets[line + 1] : this.source.size;
    return { start, end };
  }

  /**
   * Read lines `[from, to)` in one call and index them locally. Callers add the line offset
   * back when they build summaries, so absolute line numbers survive.
   */
  async window(from: number, to: number): Promise<ByteWindow> {
    const first = Math.max(0, Math.min(from, this.index.lineCount));
    const last = Math.max(first, Math.min(to, this.index.lineCount));
    if (last <= first) {
      return { bytes: new Uint8Array(0), index: { offsets: [], lineCount: 0 } };
    }
    const start = this.index.offsets[first];
    const end = last < this.index.lineCount ? this.index.offsets[last] : this.source.size;
    const bytes = await this.source.read(start, end - start);
    return { bytes, index: buildJsonlIndex(bytes) };
  }

  close(): void {
    void this.source.close?.();
  }
}
