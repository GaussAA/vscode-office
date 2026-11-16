/**
 * Host-side JSONL session: owns the file view and answers the three questions the webview
 * can ask — a window of directory summaries, one full entry, and a whole-file search.
 *
 * Reads go through `JsonlFile`, which keeps only the line index and fetches one byte window
 * per request, so a 500 MB file costs a few megabytes of host memory instead of its own size.
 *
 * Every answer carries the `requestId` of the request that caused it, and a scan can be
 * cancelled — correlation and cancellation belong with the state they describe, not with the
 * provider that happens to receive the message.
 */
import {
  JSONL_RANGE_BYTE_BUDGET,
  type JsonlEntriesPayload,
  type JsonlEntryPayload,
  type JsonlSearchBatch,
} from "@/common/jsonlTypes";
import { buildJsonlEntry, buildJsonlSummaries } from "@/service/jsonlDocument";
import type { JsonlFile } from "@/service/jsonlFile";
import { jsonlAdapter, type JsonlAdapter } from "@/service/jsonlAdapter";
import { createCancelToken } from "@/service/recordAddressableDocument";

export interface JsonlSearchOptions {
  /** Lines decoded per event-loop turn; keeps a scan responsive on a huge file. */
  step?: number;
  /** Matches per message. */
  batchSize?: number;
  /** Hard stop, so a broad query cannot exhaust memory. */
  maxMatches?: number;
  /** Called for every batch, including the final `done` one. */
  onBatch: (batch: JsonlSearchBatch) => void;
  /** Injected so tests can drive the scan without real timers. */
  schedule?: (run: () => void) => void;
}

export interface JsonlSearchHandle {
  cancel(): void;
  readonly done: boolean;
  /** Resolves when the scan finished or was cancelled — handy for tests and callers. */
  readonly finished: Promise<void>;
}

export class JsonlSession {
  private readonly document: JsonlAdapter;
  private cancelToken: ReturnType<typeof createCancelToken> | null = null;
  private currentSettle: (() => void) | null = null;

  constructor(readonly file: JsonlFile) {
    this.document = jsonlAdapter(file);
  }

  get lineCount(): number {
    return this.file.lineCount;
  }

  get byteSize(): number {
    return this.file.byteSize;
  }

  cancelSearch(): void {
    if (this.cancelToken) {
      this.cancelToken.cancel();
      this.cancelToken = null;
    }
    if (this.currentSettle) {
      this.currentSettle();
      this.currentSettle = null;
    }
  }

  dispose(): void {
    this.cancelSearch();
    this.document.dispose?.();
  }

  async readRange(
    requestId: number,
    start: number,
    end: number,
    anchor?: number,
  ): Promise<JsonlEntriesPayload> {
    const requestedFrom = Math.max(0, Math.min(start, this.file.lineCount));
    const requestedTo = Math.max(requestedFrom, Math.min(end, this.file.lineCount));
    if (requestedTo <= requestedFrom) return { requestId, start: requestedFrom, entries: [] };

    // Keep the selected line inside the window. Without this, a 4 MB budget over 500 KB
    // records would return the first eight rows and leave the row the user jumped to
    // outside the directory. For ordinary files the bytes fit and `from` does not move.
    let from = requestedFrom;
    if (
      typeof anchor === "number" &&
      Number.isInteger(anchor) &&
      anchor >= requestedFrom &&
      anchor < requestedTo
    ) {
      if (this.file.byteLength(requestedFrom, anchor + 1) > JSONL_RANGE_BYTE_BUDGET) {
        from = anchor;
        // Walk back for context while it stays inside half the budget (at most 40 rows).
        while (
          from > requestedFrom &&
          anchor - from < 40 &&
          this.file.byteLength(from - 1, anchor + 1) <= JSONL_RANGE_BYTE_BUDGET / 2
        ) {
          from--;
        }
      }
    }

    const to = this.file.advance(from, requestedTo - from, JSONL_RANGE_BYTE_BUDGET);
    if (to <= from) return { requestId, start: from, entries: [] };
    const window = await this.file.window(from, to);
    return {
      requestId,
      start: from,
      // baseLine keeps the absolute line numbers even though the index is local to the window.
      entries: buildJsonlSummaries(window.bytes, window.index, 0, window.index.lineCount, from),
    };
  }

  async readEntry(requestId: number, line: number): Promise<JsonlEntryPayload | null> {
    if (!Number.isInteger(line) || line < 0 || line >= this.file.lineCount) return null;
    const window = await this.file.window(line, line + 1);
    if (window.index.lineCount === 0) return null;
    return { requestId, index: line, entry: buildJsonlEntry(window.bytes, window.index, 0, line) };
  }

  /**
   * Scan every line for `query` (case-insensitive substring of the raw text), emitting
   * batches as matches are found. A newer search cancels this one: the scan stops on its
   * next turn instead of reading the rest of the file for output nobody will use.
   */
  search(requestId: number, query: string, options: JsonlSearchOptions): JsonlSearchHandle {
    this.cancelSearch();
    const token = createCancelToken();
    this.cancelToken = token;

    let settle: () => void = () => undefined;
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });
    this.currentSettle = settle;

    const onBatch = (batch: JsonlSearchBatch) => {
      options.onBatch(batch);
      if (batch.done) {
        this.cancelToken = null;
        this.currentSettle = null;
        settle();
      }
    };

    this.document.search(
      requestId,
      query,
      {
        step: options.step,
        batchSize: options.batchSize,
        maxMatches: options.maxMatches,
        onBatch,
        schedule: options.schedule,
      },
      token,
    );

    const isDone = () => this.cancelToken !== token;
    return {
      cancel: () => {
        token.cancel();
        if (this.cancelToken === token) {
          this.cancelToken = null;
          this.currentSettle = null;
        }
        settle();
      },
      get done() {
        return isDone();
      },
      finished,
    };
  }
}
