import { decodeBase64 } from "@/common/base64";

export interface OfficeOpenPayload {
  path?: string;
  /** Inline bytes for a virtual document, base64-encoded by the host. */
  bufferBase64?: string;
  /** Legacy inline bytes (harness stubs). The host sends `bufferBase64`. */
  buffer?: number[];
  error?: string;
}

export function arrayBufferFromPayload(payload: OfficeOpenPayload): ArrayBuffer {
  if (payload.error) {
    throw new Error(payload.error);
  }
  if (payload.bufferBase64) {
    const bytes = decodeBase64(payload.bufferBase64);
    if (bytes.byteLength > 0) return bytes.buffer as ArrayBuffer;
  }
  if (payload.buffer?.length) {
    const bytes = new Uint8Array(payload.buffer.length);
    for (let i = 0; i < payload.buffer.length; i++) {
      bytes[i] = payload.buffer[i];
    }
    return bytes.buffer;
  }
  throw new Error("Empty file content");
}

export async function loadOfficeBuffer(payload: OfficeOpenPayload): Promise<ArrayBuffer> {
  if (payload.bufferBase64 || payload.buffer) {
    return arrayBufferFromPayload(payload);
  }
  if (!payload.path) {
    throw new Error(payload.error ?? "No file path");
  }
  const response = await fetch(payload.path);
  if (!response.ok) {
    throw new Error(`Failed to fetch (${response.status})`);
  }
  return response.arrayBuffer();
}
