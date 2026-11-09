import { decodeBase64, encodeBase64 } from "./base64";

/**
 * What a viewer sends when it saves.
 *
 * Same reason as the open path: `postMessage` is JSON, so a saved workbook used to travel as
 * `number[]` — 5-8x the file — before the host wrote it to disk. Base64 is 4/3.
 */
export interface SaveContentPayload {
  contentBase64: string;
  /** Target format for "save as"; absent for a plain save. */
  ext?: string;
}

export function bytesToSavePayload(bytes: Uint8Array, ext?: string): SaveContentPayload {
  const payload: SaveContentPayload = { contentBase64: encodeBase64(bytes) };
  if (ext) payload.ext = ext;
  return payload;
}

/**
 * Bytes from a save message.
 *
 * The legacy shapes are accepted on purpose: a webview that was loaded before this change can
 * still be alive (a hidden panel, a reload mid-session), and rejecting its save would lose the
 * user's edits rather than the optimisation.
 */
export function saveContentToBytes(payload: SaveContentPayload | number[] | string): Uint8Array {
  if (typeof payload === "string") return new TextEncoder().encode(payload);
  if (Array.isArray(payload)) return Uint8Array.from(payload);
  return decodeBase64(payload.contentBase64);
}
