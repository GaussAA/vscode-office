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
import type { WorkbookSheetRows } from "@/common/workbookRows";
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
  /**
   * Ask the host for a cached workbook (ADR-0027). `null` means miss/unavailable; the caller
   * then fetches and parses as before. Only called for file workbooks that advertise
   * `hostWorkbook`.
   */
  loadHostWorkbook?(payload: ExcelOpenPayload): Promise<WorkbookSheetSource | null>;
  /** Hand the freshly parsed rows to the host cache; the current view keeps its local source. */
  storeHostWorkbook?(payload: ExcelOpenPayload, sheets: WorkbookSheetRows[]): void;
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

export type DirtyState = "clean" | "dirty" | "pending-save";

export interface DirtyEffect {
  saveEnabled: boolean;
  notifyHost: "dirty" | "clean" | null;
}

type DirtyEvent =
  | { type: "edit" }
  | { type: "saveRequested" }
  | { type: "saveDone" }
  | { type: "saveFailed" }
  | { type: "opened"; readOnly: boolean };

export interface DirtyContext {
  state: DirtyState;
  readOnly: boolean;
}

export function dirtyTransition(ctx: DirtyContext, event: DirtyEvent): [DirtyContext, DirtyEffect] {
  const { state, readOnly } = ctx;

  if (event.type === "opened") {
    const newCtx = { state: "clean" as DirtyState, readOnly: event.readOnly };
    return [newCtx, { saveEnabled: false, notifyHost: null }];
  }

  if (event.type === "edit") {
    if (readOnly) return [ctx, { saveEnabled: false, notifyHost: null }];
    if (state === "clean") {
      return [
        { ...ctx, state: "dirty" },
        { saveEnabled: true, notifyHost: "dirty" },
      ];
    }
    if (state === "pending-save") {
      return [
        { ...ctx, state: "dirty" },
        { saveEnabled: true, notifyHost: "dirty" },
      ];
    }
    return [ctx, { saveEnabled: true, notifyHost: null }];
  }

  if (event.type === "saveRequested") {
    if (readOnly) return [ctx, { saveEnabled: false, notifyHost: null }];
    if (state === "clean" || state === "dirty") {
      return [
        { ...ctx, state: "pending-save" },
        { saveEnabled: false, notifyHost: null },
      ];
    }
    return [ctx, { saveEnabled: false, notifyHost: null }];
  }

  if (event.type === "saveDone") {
    if (state === "pending-save") {
      return [
        { ...ctx, state: "clean" },
        { saveEnabled: false, notifyHost: "clean" },
      ];
    }
    if (state === "dirty") {
      return [ctx, { saveEnabled: true, notifyHost: "dirty" }];
    }
    return [ctx, { saveEnabled: false, notifyHost: null }];
  }

  if (event.type === "saveFailed") {
    if (state === "pending-save") {
      // Save failed: revert to dirty, re-enable save, notify host
      return [
        { ...ctx, state: "dirty" },
        { saveEnabled: true, notifyHost: "dirty" },
      ];
    }
    // Already dirty: stay dirty with save enabled; clean: stay clean with save disabled
    return [ctx, { saveEnabled: state === "dirty", notifyHost: null }];
  }

  return [ctx, { saveEnabled: false, notifyHost: null }];
}

export class ExcelSession {
  private generation = 0;
  private forced = false;
  private cacheId = "";
  private current: ExcelOpenPayload | null = null;
  private dirtyCtx: DirtyContext = { state: "clean", readOnly: false };

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

  get dirtyState(): DirtyState {
    return this.dirtyCtx.state;
  }

  get isReadOnly(): boolean {
    return this.dirtyCtx.readOnly;
  }

  markEdited(): DirtyEffect {
    const [newCtx, effect] = dirtyTransition(this.dirtyCtx, { type: "edit" });
    this.dirtyCtx = newCtx;
    return effect;
  }

  markSaveRequested(): DirtyEffect {
    const [newCtx, effect] = dirtyTransition(this.dirtyCtx, { type: "saveRequested" });
    this.dirtyCtx = newCtx;
    return effect;
  }

  markSaveDone(): DirtyEffect {
    const [newCtx, effect] = dirtyTransition(this.dirtyCtx, { type: "saveDone" });
    this.dirtyCtx = newCtx;
    return effect;
  }

  markSaveFailed(): DirtyEffect {
    const [newCtx, effect] = dirtyTransition(this.dirtyCtx, { type: "saveFailed" });
    this.dirtyCtx = newCtx;
    return effect;
  }

  /** A new payload from the host: start a generation and decide guard or load. */
  open(payload: ExcelOpenPayload): ExcelOpenResult {
    const seq = ++this.generation;
    const nextCacheId = payload.documentCacheId ?? "";
    if (nextCacheId !== this.cacheId) this.forced = false;
    this.cacheId = nextCacheId;
    this.current = payload;

    // Reset dirty state on open
    const [newDirtyCtx] = dirtyTransition(this.dirtyCtx, {
      type: "opened",
      readOnly: payload.readOnly === true,
    });
    this.dirtyCtx = newDirtyCtx;

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
      const ext = payload.ext ?? "";
      const view = sheetViewFor(ext, payload.size, { virtual: isVirtual(payload) });

      // The host cache is the only path that avoids the whole-workbook parse. A miss falls
      // through to the existing fetch + parse, so a host problem can never block opening.
      if (view === "window" && excelWindowKind(ext) === "workbook" && payload.hostWorkbook) {
        let hostSource: WorkbookSheetSource | null = null;
        try {
          hostSource = (await deps.loadHostWorkbook?.(payload)) ?? null;
        } catch {
          hostSource = null;
        }
        if (!this.isCurrent(seq)) return { kind: "stale" };
        if (hostSource) return { kind: "workbook", source: hostSource };
      }

      const buffer = await deps.loadBuffer(payload);
      if (!this.isCurrent(seq)) return { kind: "stale" };
      if (view === "window") {
        if (excelWindowKind(ext) === "workbook") {
          const rows = await deps.loadWorkbookRows(buffer);
          if (!this.isCurrent(seq)) return { kind: "stale" };
          if (payload.hostWorkbook) {
            try {
              deps.storeHostWorkbook?.(payload, rows);
            } catch {
              // Caching is a convenience; the local source already has the rows.
            }
          }
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
