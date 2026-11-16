/**
 * One Excel document's open/guard/load decisions, with no React, no DOM and no vscode bridge,
 * so `node --test` can drive it with fake readers.
 *
 * Invariants this module owns (they used to be spread over refs and closures in the hook):
 *
 *  1. Generation fence. Every `open()` / `openAnyway()` / `invalidate()` starts a new
 *     generation. A load that was started under an older generation resolves as `stale` and
 *     must not touch any state, whether it succeeded or failed.
 *  2. "Open anyway" is a property of the current document, not of the session. `forced` is
 *     cleared when a payload with a different `documentCacheId` arrives. The same id keeps it,
 *     because that is how the host answers `openForce`: it re-sends `open` for the same
 *     document, and that message must not be guarded again.
 *  3. "Open anyway" only lifts the guard. Which view the document gets (grid or windowed) is
 *     still decided by `sheetViewFor`.
 */
import type { OfficeOpenMessage } from "@/common/openPayload";
import type { ExcelData } from "./excel_reader";
import { excelWindowKind, planExcelOpen } from "./excelOpenPlan";
import { createTextSheetSource, type SheetSource } from "./sheetSource";
import { limitForView, sheetViewFor } from "./sheetView";
import type { WorkbookSheetRows } from "./workbookRows";
import { createWorkbookSheetSource, type WorkbookSheetSource } from "./workbookSource";

export type ExcelOpenPayload = OfficeOpenMessage;

/** What the refusal panel needs to describe the file it refused. */
export interface ExcelTooLarge {
  size: number;
  name: string;
  ext: string;
  /** The limit this file missed; local text and virtual text have different ones. */
  limit: number;
}

export type ExcelOpenResult =
  | { kind: "guard"; seq: number; tooLarge: ExcelTooLarge }
  | { kind: "load"; seq: number; payload: ExcelOpenPayload };

export type ExcelOpenAnywayResult =
  | { kind: "load"; seq: number; payload: ExcelOpenPayload }
  /** The bytes were never sent (a refused virtual document); ask the host to send them. */
  | { kind: "request-force" };

/** The I/O a load needs, injected so a test never reads a real file or parses a real workbook. */
export interface ExcelLoadDeps {
  loadBuffer(payload: ExcelOpenPayload): Promise<ArrayBuffer>;
  loadWorkbookRows(buffer: ArrayBuffer): Promise<WorkbookSheetRows[]>;
  loadSheets(buffer: ArrayBuffer, ext: string): Promise<ExcelData>;
}

export type ExcelLoadOutcome =
  /** A newer generation exists; apply nothing. */
  | { kind: "stale" }
  | { kind: "workbook"; source: WorkbookSheetSource }
  | { kind: "text"; source: SheetSource }
  | { kind: "grid"; data: ExcelData }
  | { kind: "error"; message: string; cause: unknown };

export function loadErrorMessage(cause: unknown): string {
  return (cause as Error | null | undefined)?.message || String(cause);
}

function isVirtual(payload: ExcelOpenPayload): boolean {
  return payload.scheme !== "file";
}

/** Whether the payload already carries (or can fetch) its bytes without asking the host again. */
function hasReadableBytes(payload: ExcelOpenPayload): boolean {
  return payload.scheme === "file" || Boolean(payload.bufferBase64) || !!payload.buffer?.length;
}

export class ExcelSession {
  private generation = 0;
  private forced = false;
  private cacheId = "";
  private current: ExcelOpenPayload | null = null;

  /** The newest payload the host sent, or null before the first `open`. */
  get payload(): ExcelOpenPayload | null {
    return this.current;
  }

  get documentCacheId(): string {
    return this.cacheId;
  }

  get isForced(): boolean {
    return this.forced;
  }

  isCurrent(seq: number): boolean {
    return seq === this.generation;
  }

  /** Supersede every load in flight (the viewer is being torn down). */
  invalidate(): void {
    this.generation += 1;
  }

  /** A new payload from the host: start a generation and decide guard or load. */
  open(payload: ExcelOpenPayload): ExcelOpenResult {
    const seq = ++this.generation;
    const nextCacheId = payload.documentCacheId ?? "";
    if (nextCacheId !== this.cacheId) this.forced = false;
    this.cacheId = nextCacheId;
    this.current = payload;

    const ext = payload.ext ?? "";
    const virtual = isVirtual(payload);
    const view = sheetViewFor(ext, payload.size, { virtual });
    if (planExcelOpen({ forced: this.forced, tooLarge: payload.tooLarge, view }) === "guard") {
      return {
        kind: "guard",
        seq,
        tooLarge: {
          size: payload.size ?? 0,
          name: payload.fileName ?? "",
          ext,
          limit: limitForView(ext, { virtual }),
        },
      };
    }
    return { kind: "load", seq, payload };
  }

  /** The user asked to open the refused document. Null when no document has arrived yet. */
  openAnyway(): ExcelOpenAnywayResult | null {
    const payload = this.current;
    if (!payload) return null;
    this.forced = true;
    const seq = ++this.generation;
    if (hasReadableBytes(payload)) return { kind: "load", seq, payload };
    return { kind: "request-force" };
  }

  /**
   * Read the payload and decide how to show it. Never rejects: a failure becomes an `error`
   * outcome, and anything that finishes under an old generation becomes `stale`.
   */
  async load(
    payload: ExcelOpenPayload,
    seq: number,
    deps: ExcelLoadDeps,
  ): Promise<ExcelLoadOutcome> {
    try {
      const buffer = await deps.loadBuffer(payload);
      if (!this.isCurrent(seq)) return { kind: "stale" };
      const ext = payload.ext ?? "";
      const view = sheetViewFor(ext, payload.size, { virtual: isVirtual(payload) });
      if (view === "window") {
        if (excelWindowKind(ext) === "workbook") {
          const rows = await deps.loadWorkbookRows(buffer);
          if (!this.isCurrent(seq)) return { kind: "stale" };
          return { kind: "workbook", source: createWorkbookSheetSource(rows) };
        }
        return { kind: "text", source: createTextSheetSource(buffer) };
      }
      const data = await deps.loadSheets(buffer, payload.ext);
      if (!this.isCurrent(seq)) return { kind: "stale" };
      return { kind: "grid", data };
    } catch (cause) {
      if (!this.isCurrent(seq)) return { kind: "stale" };
      return { kind: "error", message: loadErrorMessage(cause), cause };
    }
  }
}
