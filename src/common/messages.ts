/**
 * Typed message contract between extension host and webview.
 *
 * Direction: Host→Webview messages are received by the webview via handler.on(event, callback).
 * Direction: Webview→Host messages are emitted by the webview via handler.emit(event, payload)
 * and received on the host via handler.on(event, callback).
 */

import type { OfficeOpenMessage } from "./openPayload";

/** Host → Webview: Initial data after webview mount. */
export type OpenMessage = { event: "open"; payload: OfficeOpenMessage };

/** Host → Webview: Parquet file metadata and initial data. */
export interface ParquetOpenMessage {
  event: "open";
  payload: ParquetOpenPayload;
}

export interface ParquetOpenPayload {
  fileName: string;
  fileSize: number;
  rowCount: number;
  columnCount: number;
  tooLarge?: boolean;
  columns?: Array<{ name: string; type: string }>;
}

/** Host → Webview: JSONL file info. */
export interface JsonlInfoMessage {
  event: "jsonlInfo";
  payload: JsonlInfoPayload;
}

export interface JsonlInfoPayload {
  fileName: string;
  fileSize: number;
  lineCount: number;
  indexed: boolean;
}

/** Host → Webview: JSONL index page. */
export interface JsonlEntriesMessage {
  event: "jsonlEntries";
  payload: JsonlEntriesPayload;
}

export interface JsonlEntriesPayload {
  requestId: number;
  entries: Array<{ index: number; label: string; preview: string }>;
  hasMore: boolean;
}

/** Host → Webview: Single JSONL entry detail. */
export interface JsonlEntryDataMessage {
  event: "jsonlEntryData";
  payload: JsonlEntryPayload;
}

export interface JsonlEntryPayload {
  requestId: number;
  index: number;
  raw: string;
  parsed?: unknown;
  error?: string;
}

/** Host → Webview: JSONL search batch. */
export interface JsonlSearchBatchMessage {
  event: "jsonlSearchBatch";
  payload: JsonlSearchBatch;
}

export interface JsonlSearchBatch {
  requestId: number;
  matches: Array<{ index: number; snippet: string }>;
  done: boolean;
  total?: number;
}

/** Host → Webview: JSON preview info. */
export interface JsonInfoMessage {
  event: "jsonInfo";
  payload: JsonInfo;
}

export interface JsonInfo {
  fileName: string;
  fileSize: number;
  recordCount?: number;
  indexed: boolean;
  rootType: "array" | "object" | "invalid";
  error?: string;
}

/** Host → Webview: JSON root object. */
export interface JsonRootMessage {
  event: "jsonRoot";
  payload: JsonRootPayload;
}

export interface JsonRootPayload {
  entry: unknown;
}

/** Host → Webview: JSON records page. */
export interface JsonRecordsDataMessage {
  event: "jsonRecordsData";
  payload: { requestId?: number; records?: JsonRecordSummary[] };
}

export interface JsonRecordSummary {
  index: number;
  label: string;
}

/** Host → Webview: Single JSON record. */
export interface JsonRecordDataMessage {
  event: "jsonRecordData";
  payload: { requestId?: number; index?: number; entry?: unknown };
}

/** Host → Webview: JSON search batch. */
export interface JsonSearchBatchMessage {
  event: "jsonSearchBatch";
  payload: JsonSearchBatch;
}

export interface JsonSearchBatch {
  requestId: number;
  matches: Array<{ path: string; snippet: string }>;
  done: boolean;
  total?: number;
}

/** Host → Webview: Save completed. */
export interface SaveDoneMessage {
  event: "saveDone";
}

/** Webview → Host: Request initialization. */
export interface InitRequest {
  event: "init";
}

/** Webview → Host: User changed content (mark dirty). */
export interface ChangeNotification {
  event: "change";
}

/** Webview → Host: Request save (Excel/Parquet). */
export interface SaveRequest {
  event: "save";
  payload: { contentBase64?: string; content?: number[] };
}

/** Webview → Host: Request save-as with extension. */
export interface SaveAsRequest {
  event: "saveAs";
  payload: { contentBase64?: string; content?: number[]; ext?: string };
}

/** Webview → Host: Open in text editor (full content). */
export interface EditInVSCodeRequest {
  event: "editInVSCode";
  payload: boolean; // true = full content
}

/** Webview → Host: Force reload after too-large warning. */
export interface OpenForceRequest {
  event: "openForce";
}

/** Webview → Host: Reveal file in Explorer. */
export interface RevealFileRequest {
  event: "revealFile";
}

/** Webview → Host: Open external URL. */
export interface OpenExternalRequest {
  event: "openExternal";
  payload: string; // URL
}

/** Webview → Host: Toggle DevTools (F12). */
export interface DeveloperToolRequest {
  event: "developerTool";
}

/** Webview → Host: Request JSONL index page. */
export interface JsonlIndexRequest {
  event: "jsonlIndex";
  payload: { requestId: number; start: number; count: number };
}

/** Webview → Host: Request single JSONL entry. */
export interface JsonlEntryRequest {
  event: "jsonlEntry";
  payload: { requestId: number; index: number };
}

/** Webview → Host: Start JSONL search. */
export interface JsonlSearchRequest {
  event: "jsonlSearch";
  payload: { requestId: number; query: string };
}

/** Webview → Host: Cancel JSONL search. */
export interface JsonlSearchCancelRequest {
  event: "jsonlSearchCancel";
  payload: { requestId: number };
}

/** Webview → Host: Reload JSONL file. */
export interface JsonlReloadRequest {
  event: "jsonlReload";
}

/** Webview → Host: Request JSON records page. */
export interface JsonRecordsRequest {
  event: "jsonRecords";
  payload: { requestId?: number; start?: number; end?: number };
}

/** Webview → Host: Request single JSON record. */
export interface JsonRecordRequest {
  event: "jsonRecord";
  payload: { requestId?: number; index?: number };
}

/** Webview → Host: Start JSON search. */
export interface JsonSearchRequest {
  event: "jsonSearch";
  payload: { requestId?: number; query?: string };
}

/** Webview → Host: Cancel JSON search. */
export interface JsonSearchCancelRequest {
  event: "jsonSearchCancel";
}

/** Webview → Host: Reload JSON file. */
export interface JsonReloadRequest {
  event: "jsonReload";
}

/** Webview → Host: Open JSON in text editor. */
export interface JsonOpenTextRequest {
  event: "jsonOpenText";
}

/** Host → Webview: File changed externally (trigger reload UI). */
export interface FileChangeNotification {
  event: "fileChange";
}

/**
 * Union of all Host→Webview messages.
 */
export type HostToWebviewMessage =
  | OpenMessage
  | ParquetOpenMessage
  | JsonlInfoMessage
  | JsonlEntriesMessage
  | JsonlEntryDataMessage
  | JsonlSearchBatchMessage
  | JsonInfoMessage
  | JsonRootMessage
  | JsonRecordsDataMessage
  | JsonRecordDataMessage
  | JsonSearchBatchMessage
  | SaveDoneMessage
  | FileChangeNotification;

/**
 * Union of all Webview→Host messages.
 */
export type WebviewToHostMessage =
  | InitRequest
  | ChangeNotification
  | SaveRequest
  | SaveAsRequest
  | EditInVSCodeRequest
  | OpenForceRequest
  | RevealFileRequest
  | OpenExternalRequest
  | DeveloperToolRequest
  | JsonlIndexRequest
  | JsonlEntryRequest
  | JsonlSearchRequest
  | JsonlSearchCancelRequest
  | JsonlReloadRequest
  | JsonRecordsRequest
  | JsonRecordRequest
  | JsonSearchRequest
  | JsonSearchCancelRequest
  | JsonReloadRequest
  | JsonOpenTextRequest;

/**
 * Extract the event name from a message type.
 */
export type EventOf<T> = T extends { event: infer E } ? E : never;

/**
 * Extract the payload type for a given event name from a message union.
 */
export type PayloadOf<TUnion, TEvent extends string> =
  Extract<TUnion, { event: TEvent }> extends { payload: infer P }
    ? P
    : Extract<TUnion, { event: TEvent }> extends { event: TEvent }
      ? void
      : never;
