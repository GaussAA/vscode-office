/**
 * The comparison panel's message loop, without `vscode` (ADR-0021).
 *
 * Same split as `parquetHandlers`: which side failed, and that a failure still answers, are
 * decided here; `comparePanel.ts` keeps the panel and the wiring. Each side is a name plus a
 * way to open its bytes, so a test can hand in memory sources instead of two files on disk.
 */
import type { NamedParquetProfile, ParquetComparePayload } from "@/common/parquetCompareTypes";
import type { ByteSource } from "@/common/byteSource";
import { compareParquetProfiles } from "@/service/parquetCompare";
import { readParquetProfile } from "@/service/parquetProfile";

export type CompareSide = "left" | "right";

export interface CompareSideContext {
  fileName: string;
  /** Open the side's bytes: the provider owns the scheme decision (`openDocumentSource`). */
  open: () => Promise<ByteSource>;
}

export interface CompareHandlerContext {
  left: CompareSideContext;
  right: CompareSideContext;
  emit: (type: string, payload: unknown) => void;
}

export function createCompareHandlers(context: CompareHandlerContext) {
  /** Opening, reading and closing are all part of "this side could not be read". */
  async function profileOf(side: CompareSideContext): Promise<NamedParquetProfile> {
    const source = await side.open();
    try {
      return { fileName: side.fileName, profile: await readParquetProfile(source) };
    } finally {
      await source.close?.();
    }
  }

  function fail(requestId: number, failedSide: CompareSide, error: unknown) {
    context.emit("compareData", {
      requestId,
      compare: null,
      failedSide,
      error: error instanceof Error ? error.message : String(error),
    } satisfies ParquetComparePayload);
  }

  /**
   * Read both sides and answer.
   *
   * The sides are read separately so a failure can name the file that failed: "the left one
   * could not be read" sends the reader to the right place, "comparison failed" does not. The
   * left side goes first, so when both fail the left one is the one reported.
   */
  async function answer(requestId: number) {
    let left: NamedParquetProfile;
    try {
      left = await profileOf(context.left);
    } catch (error) {
      fail(requestId, "left", error);
      return;
    }
    let right: NamedParquetProfile;
    try {
      right = await profileOf(context.right);
    } catch (error) {
      fail(requestId, "right", error);
      return;
    }
    context.emit("compareData", {
      requestId,
      compare: compareParquetProfiles(left, right),
    } satisfies ParquetComparePayload);
  }

  return {
    /** The first answer; the webview has no request id yet. */
    init: () => answer(0),

    /** A reload echoes the caller's id; without one the answer is addressed to 0, as `init`. */
    reload: (request?: { requestId?: number }) =>
      answer(typeof request?.requestId === "number" ? request.requestId : 0),
  };
}
