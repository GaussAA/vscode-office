/**
 * Thrown when JSONL index building is cancelled mid-scan.
 * Separated from jsonlFile.ts to avoid circular imports with CancelToken.
 */
export class JsonlIndexCancelled extends Error {
  constructor(message = "JSONL index build was cancelled") {
    super(message);
    this.name = "JsonlIndexCancelled";
  }
}
