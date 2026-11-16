/**
 * The save rules of the spreadsheet viewer, without `vscode`.
 *
 * `commonHandler` used to hold these inline, next to a module-level `fileSaveTimes` map, so
 * the rules that decide whether a user's edit is written (read-only reroute, "save as" default
 * name, the window in which our own write must not trigger a reload) could only be reached by
 * running a real VS Code window. They are here, parameterised over the document type and the
 * dialog/fs calls, and `commonHandler` is left with the wiring.
 */
import {
  bytesToSavePayload,
  saveContentToBytes,
  type SaveContentPayload,
} from "@/common/saveContent";

/** A file-change event this soon after our own write is the echo of that write. */
export const INTERNAL_SAVE_CHANGE_WINDOW_MS = 1500;

/**
 * When each document was last written by this extension.
 *
 * It is shared between panels on purpose: "save as" stamps the *target*, so a panel that
 * already shows that file ignores the change event our own write is about to cause. That is
 * why the owner of the tracker (the provider) injects one instance instead of every panel
 * creating its own.
 */
export interface SaveTracker {
  /** Record that we wrote `key` just now. */
  markSaved(key: string): void;
  /** True while a change event for `key` is still the echo of our own write. */
  shouldSkip(key: string): boolean;
  /** Drop `key`, when its panel is gone. */
  forget(key: string): void;
}

export function createSaveTracker(now: () => number = Date.now): SaveTracker {
  const savedAt = new Map<string, number>();
  return {
    markSaved(key) {
      savedAt.set(key, now());
    },
    shouldSkip(key) {
      const last = savedAt.get(key);
      return last !== undefined && now() - last < INTERNAL_SAVE_CHANGE_WINDOW_MS;
    },
    forget(key) {
      savedAt.delete(key);
    },
  };
}

export interface SaveFilter {
  label: string;
  exts: string[];
}

const SAVE_FILTERS = new Map<string, SaveFilter>([
  ["xlsx", { label: "Excel Workbook", exts: ["xlsx"] }],
  ["xlsm", { label: "Excel Macro-Enabled Workbook", exts: ["xlsm"] }],
  ["xls", { label: "Excel 97-2003 Workbook", exts: ["xls"] }],
  ["ods", { label: "OpenDocument Spreadsheet", exts: ["ods"] }],
  ["csv", { label: "CSV (Comma delimited)", exts: ["csv"] }],
]);

/** What the "save as" dialog starts from, derived from the document name and the asked format. */
export function saveTargetFor(
  baseName: string,
  ext?: string,
): { ext: string; defaultFileName: string; filter: SaveFilter } {
  const normalized = (ext ?? "xlsx").toLowerCase();
  return {
    ext: normalized,
    defaultFileName: `${baseName}.${normalized}`,
    filter: SAVE_FILTERS.get(normalized) ?? { label: normalized.toUpperCase(), exts: [normalized] },
  };
}

export interface SaveTargetRequest {
  defaultFileName: string;
  /** Dialog filters: label -> extensions. */
  filters: Record<string, string[]>;
}

/** What the webview sends for "save as"; the legacy `content` shape is kept as it was. */
export interface SaveAsPayload {
  contentBase64?: string;
  content?: number[];
  ext?: string;
}

export interface SaveHandlerContext<Target> {
  /** The document the viewer shows (a `vscode.Uri` in the provider). */
  document: Target;
  /** The document's file name without its extension. */
  baseName: string;
  saves: SaveTracker;
  /** Identity under which a target is tracked (`uri.toString()`). */
  keyOf: (target: Target) => string;
  /** Read at call time: the open path decides it and it can change between messages. */
  isReadOnly: () => boolean;
  writeFile: (target: Target, bytes: Uint8Array) => PromiseLike<void>;
  /** The "save as" dialog; resolves `undefined` when the user cancels. */
  pickTarget: (request: SaveTargetRequest) => PromiseLike<Target | undefined>;
  /** The editor no longer has unsaved edits (clears the `*` in the tab title). */
  markClean: () => void;
  openTarget: (target: Target) => PromiseLike<unknown>;
  emit: (type: string, payload?: unknown) => void;
}

export function createSaveHandlers<Target>(context: SaveHandlerContext<Target>) {
  const { document, baseName, saves, keyOf, isReadOnly, writeFile, pickTarget, markClean } =
    context;
  const { openTarget, emit } = context;

  return {
    /**
     * A read-only document is never written: the webview is asked to save under another name
     * instead. Anything else is written in place; the document is stamped before the write
     * (so an event that arrives while it runs is skipped) and again after it (so the window is
     * measured from when the write finished).
     */
    async save(content: SaveContentPayload | number[] | string) {
      const bytes = saveContentToBytes(content);
      if (isReadOnly()) {
        emit("saveAs", bytesToSavePayload(bytes));
        return;
      }
      const key = keyOf(document);
      saves.markSaved(key);
      await writeFile(document, bytes);
      saves.markSaved(key);
      markClean();
      emit("saveDone");
    },

    /**
     * Write to a place the user picked, then open it. The *target* is stamped, not the
     * document: the target is the file whose change event we are about to cause.
     *
     * Save As does NOT mark the original document clean or emit saveDone, since the original
     * file was not saved — only a copy was written elsewhere. The original document keeps its
     * unsaved edits.
     */
    async saveAs(payload: SaveAsPayload) {
      const bytes = saveContentToBytes(payload as Parameters<typeof saveContentToBytes>[0]);
      const { defaultFileName, filter } = saveTargetFor(baseName, payload.ext);
      const target = await pickTarget({
        defaultFileName,
        filters: { [filter.label]: filter.exts },
      });
      if (!target) return;
      const key = keyOf(target);
      saves.markSaved(key);
      await writeFile(target, bytes);
      saves.markSaved(key);
      // The original document was not saved, so don't mark it clean or emit saveDone.
      await openTarget(target);
    },
  };
}
