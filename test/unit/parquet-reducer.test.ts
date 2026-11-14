import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parquetReducer,
  initialParquetState,
} from "../../src/react/view/parquet/parquetReducer.ts";

test("parquetReducer: DOCUMENT_LOADING sets loading state", () => {
  const state = parquetReducer(initialParquetState, { type: "DOCUMENT_LOADING" });
  assert.strictEqual(state.loading, true);
  assert.strictEqual(state.error, null);
});

test("parquetReducer: DOCUMENT_LOADED updates fileInfo", () => {
  const fileInfo = {
    rowCount: 100,
    columns: [],
    metadata: null,
  } as any;

  const state = parquetReducer(initialParquetState, {
    type: "DOCUMENT_LOADED",
    fileInfo,
    fileName: "test.parquet",
  });

  assert.strictEqual(state.fileInfo, fileInfo);
  assert.strictEqual(state.fileName, "test.parquet");
  assert.strictEqual(state.loading, false);
  assert.strictEqual(state.error, null);
});

test("parquetReducer: DOCUMENT_ERROR sets error state", () => {
  const error = new Error("Failed to load");
  const state = parquetReducer(initialParquetState, {
    type: "DOCUMENT_ERROR",
    error,
  });

  assert.strictEqual(state.error, error);
  assert.strictEqual(state.loading, false);
});

test("parquetReducer: SET_PAGE clears cursor and inspected", () => {
  const stateWithCursor = {
    ...initialParquetState,
    cursor: { row: 5, col: 2 },
    inspected: { row: 5, column: "name", value: "test" },
    targetRow: 10,
  };

  const state = parquetReducer(stateWithCursor, { type: "SET_PAGE", page: 2 });

  assert.strictEqual(state.page, 2);
  assert.strictEqual(state.cursor, null);
  assert.strictEqual(state.inspected, null);
  assert.strictEqual(state.targetRow, null);
});

test("parquetReducer: SELECT_CELL closes profile panel", () => {
  const stateWithProfile = {
    ...initialParquetState,
    profilePanel: { column: { name: "test", type: "string" } as any },
  };

  const state = parquetReducer(stateWithProfile, {
    type: "SELECT_CELL",
    cursor: { row: 1, col: 2 },
  });

  assert.deepStrictEqual(state.cursor, { row: 1, col: 2 });
  assert.strictEqual(state.profilePanel, null);
});

test("parquetReducer: OPEN_PROFILE_PANEL clears scan state", () => {
  const stateWithScan = {
    ...initialParquetState,
    columnScan: { topValues: [] } as any,
    scanError: "Previous error",
  };

  const column = { name: "age", type: "int64" } as any;
  const state = parquetReducer(stateWithScan, {
    type: "OPEN_PROFILE_PANEL",
    column,
  });

  assert.deepStrictEqual(state.profilePanel, { column });
  assert.strictEqual(state.columnScan, null);
  assert.strictEqual(state.scanError, null);
});

test("parquetReducer: CLOSE_PROFILE_PANEL clears all profile state", () => {
  const stateWithProfile = {
    ...initialParquetState,
    profilePanel: { column: { name: "test" } as any },
    columnScan: { topValues: [] } as any,
    scanError: "Error",
  };

  const state = parquetReducer(stateWithProfile, { type: "CLOSE_PROFILE_PANEL" });

  assert.strictEqual(state.profilePanel, null);
  assert.strictEqual(state.columnScan, null);
  assert.strictEqual(state.scanError, null);
});

test("parquetReducer: SCAN_SUCCESS updates scan state", () => {
  const scan = { topValues: [{ value: "test", count: 10 }] } as any;
  const state = parquetReducer(initialParquetState, {
    type: "SCAN_SUCCESS",
    scan,
  });

  assert.strictEqual(state.columnScan, scan);
  assert.strictEqual(state.scanLoading, false);
  assert.strictEqual(state.scanError, null);
});

test("parquetReducer: SCAN_ERROR sets error", () => {
  const state = parquetReducer(initialParquetState, {
    type: "SCAN_ERROR",
    error: "Scan failed",
  });

  assert.strictEqual(state.scanError, "Scan failed");
  assert.strictEqual(state.scanLoading, false);
});

test("parquetReducer: JUMP_TO_ROW clears rowJump input", () => {
  const stateWithInput = {
    ...initialParquetState,
    rowJump: "42",
  };

  const state = parquetReducer(stateWithInput, {
    type: "JUMP_TO_ROW",
    targetRow: 41, // 0-based
  });

  assert.strictEqual(state.targetRow, 41);
  assert.strictEqual(state.rowJump, "");
});

test("parquetReducer: CLEAR_SELECTION clears cursor, inspected, and targetRow", () => {
  const stateWithSelection = {
    ...initialParquetState,
    cursor: { row: 5, col: 2 },
    inspected: { row: 5, column: "name", value: "test" },
    targetRow: 10,
  };

  const state = parquetReducer(stateWithSelection, { type: "CLEAR_SELECTION" });

  assert.strictEqual(state.cursor, null);
  assert.strictEqual(state.inspected, null);
  assert.strictEqual(state.targetRow, null);
});

test("parquetReducer: ANNOUNCE sets announcement message", () => {
  const state = parquetReducer(initialParquetState, {
    type: "ANNOUNCE",
    message: "Rows 1-100 of 1,000",
  });

  assert.strictEqual(state.announcement, "Rows 1-100 of 1,000");
});

test("parquetReducer: SET_SEARCH_QUERY updates search query", () => {
  const state = parquetReducer(initialParquetState, {
    type: "SET_SEARCH_QUERY",
    query: "test",
  });

  assert.strictEqual(state.searchQuery, "test");
});

test("parquetReducer: START_SEARCH activates search", () => {
  const state = parquetReducer(initialParquetState, { type: "START_SEARCH" });
  assert.strictEqual(state.searchActive, true);
});

test("parquetReducer: END_SEARCH clears search state", () => {
  const stateWithSearch = {
    ...initialParquetState,
    searchActive: true,
    searchQuery: "test",
  };

  const state = parquetReducer(stateWithSearch, { type: "END_SEARCH" });

  assert.strictEqual(state.searchActive, false);
  assert.strictEqual(state.searchQuery, "");
});

test("parquetReducer: unknown action returns same state", () => {
  const state = parquetReducer(initialParquetState, { type: "UNKNOWN" } as any);
  assert.strictEqual(state, initialParquetState);
});
