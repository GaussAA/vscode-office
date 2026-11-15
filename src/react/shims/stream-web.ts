// Stub for node:stream/web
// Provides minimal Web Streams API polyfill for browser environment

// Most modern browsers support Web Streams API natively
// This is mainly a re-export or minimal stub for compatibility

export const ReadableStream = globalThis.ReadableStream || class ReadableStream {};
export const WritableStream = globalThis.WritableStream || class WritableStream {};
export const TransformStream = globalThis.TransformStream || class TransformStream {};
export const ReadableStreamDefaultReader =
  globalThis.ReadableStreamDefaultReader || class ReadableStreamDefaultReader {};
export const ReadableStreamBYOBReader =
  globalThis.ReadableStreamBYOBReader || class ReadableStreamBYOBReader {};
export const ReadableStreamDefaultController =
  globalThis.ReadableStreamDefaultController || class ReadableStreamDefaultController {};
export const ReadableByteStreamController =
  globalThis.ReadableByteStreamController || class ReadableByteStreamController {};
export const WritableStreamDefaultWriter =
  globalThis.WritableStreamDefaultWriter || class WritableStreamDefaultWriter {};
export const WritableStreamDefaultController =
  globalThis.WritableStreamDefaultController || class WritableStreamDefaultController {};
export const TransformStreamDefaultController =
  globalThis.TransformStreamDefaultController || class TransformStreamDefaultController {};
export const ByteLengthQueuingStrategy =
  globalThis.ByteLengthQueuingStrategy || class ByteLengthQueuingStrategy {};
export const CountQueuingStrategy =
  globalThis.CountQueuingStrategy || class CountQueuingStrategy {};

// Helper function from Node.js stream/web
export function ReadableStreamTee(stream: any) {
  if (stream.tee) {
    return stream.tee();
  }
  // Fallback: return the same stream twice (not ideal but prevents crashes)
  return [stream, stream];
}

// Export all
export default {
  ReadableStream,
  WritableStream,
  TransformStream,
  ReadableStreamDefaultReader,
  ReadableStreamBYOBReader,
  ReadableStreamDefaultController,
  ReadableByteStreamController,
  WritableStreamDefaultWriter,
  WritableStreamDefaultController,
  TransformStreamDefaultController,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableStreamTee,
};
