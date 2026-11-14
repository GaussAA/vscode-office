import type { ParquetFileInfo, ParquetColumnInfo } from "./parquetParser.ts";
import type { ParquetProfile, ParquetColumnScan } from "@/common/parquetProfileTypes";
import type { CellCursor } from "./parquetCell.tsx";
import type { InspectedCell } from "./useParquetInspector.ts";

/**
 * Centralized state for the Parquet viewer.
 *
 * This replaces multiple useState calls with a single reducer,
 * making state updates more predictable and easier to debug.
 */
export interface ParquetState {
  // Document state
  fileInfo: ParquetFileInfo | null;
  profile: ParquetProfile | null;
  loading: boolean;
  error: Error | null;
  fileName: string;

  // Navigation state
  page: number;
  pageSize: number;
  targetRow: number | null;
  rowJump: string;

  // Selection state
  cursor: CellCursor | null;
  activeColumn: number | null;
  inspected: InspectedCell | null;

  // UI state
  profilePanel: { column: ParquetColumnInfo } | null;
  columnScan: ParquetColumnScan | null;
  scanLoading: boolean;
  scanError: string | null;
  copied: boolean;
  announcement: string;

  // Search state
  searchQuery: string;
  searchActive: boolean;
}

export type ParquetAction =
  // Document actions
  | { type: "DOCUMENT_LOADING" }
  | { type: "DOCUMENT_LOADED"; fileInfo: ParquetFileInfo; fileName: string }
  | { type: "DOCUMENT_ERROR"; error: Error }
  | { type: "PROFILE_LOADED"; profile: ParquetProfile }

  // Navigation actions
  | { type: "SET_PAGE"; page: number }
  | { type: "SET_PAGE_SIZE"; pageSize: number }
  | { type: "JUMP_TO_ROW"; targetRow: number }
  | { type: "SET_ROW_JUMP"; rowJump: string }
  | { type: "CLEAR_TARGET_ROW" }

  // Selection actions
  | { type: "SELECT_CELL"; cursor: CellCursor | null }
  | { type: "SET_ACTIVE_COLUMN"; column: number | null }
  | { type: "INSPECT_CELL"; inspected: InspectedCell | null }
  | { type: "CLEAR_SELECTION" }

  // Profile panel actions
  | { type: "OPEN_PROFILE_PANEL"; column: ParquetColumnInfo }
  | { type: "CLOSE_PROFILE_PANEL" }
  | { type: "START_SCAN" }
  | { type: "SCAN_SUCCESS"; scan: ParquetColumnScan }
  | { type: "SCAN_ERROR"; error: string }

  // UI actions
  | { type: "SET_COPIED"; copied: boolean }
  | { type: "ANNOUNCE"; message: string }

  // Search actions
  | { type: "SET_SEARCH_QUERY"; query: string }
  | { type: "START_SEARCH" }
  | { type: "END_SEARCH" };

export const initialParquetState: ParquetState = {
  fileInfo: null,
  profile: null,
  loading: true,
  error: null,
  fileName: "",

  page: 0,
  pageSize: 100,
  targetRow: null,
  rowJump: "",

  cursor: null,
  activeColumn: null,
  inspected: null,

  profilePanel: null,
  columnScan: null,
  scanLoading: false,
  scanError: null,
  copied: false,
  announcement: "",

  searchQuery: "",
  searchActive: false,
};

/**
 * Parquet viewer reducer.
 *
 * Handles all state transitions in a predictable, testable way.
 */
export function parquetReducer(state: ParquetState, action: ParquetAction): ParquetState {
  switch (action.type) {
    // Document actions
    case "DOCUMENT_LOADING":
      return {
        ...state,
        loading: true,
        error: null,
      };

    case "DOCUMENT_LOADED":
      return {
        ...state,
        fileInfo: action.fileInfo,
        fileName: action.fileName,
        loading: false,
        error: null,
      };

    case "DOCUMENT_ERROR":
      return {
        ...state,
        loading: false,
        error: action.error,
      };

    case "PROFILE_LOADED":
      return {
        ...state,
        profile: action.profile,
      };

    // Navigation actions
    case "SET_PAGE":
      return {
        ...state,
        page: action.page,
        cursor: null,
        inspected: null,
        targetRow: null,
      };

    case "SET_PAGE_SIZE":
      return {
        ...state,
        pageSize: action.pageSize,
      };

    case "JUMP_TO_ROW":
      return {
        ...state,
        targetRow: action.targetRow,
        rowJump: "",
      };

    case "SET_ROW_JUMP":
      return {
        ...state,
        rowJump: action.rowJump,
      };

    case "CLEAR_TARGET_ROW":
      return {
        ...state,
        targetRow: null,
      };

    // Selection actions
    case "SELECT_CELL":
      return {
        ...state,
        cursor: action.cursor,
        profilePanel: null, // Close profile when selecting a cell
      };

    case "SET_ACTIVE_COLUMN":
      return {
        ...state,
        activeColumn: action.column,
      };

    case "INSPECT_CELL":
      return {
        ...state,
        inspected: action.inspected,
        copied: false,
      };

    case "CLEAR_SELECTION":
      return {
        ...state,
        cursor: null,
        inspected: null,
        targetRow: null,
      };

    // Profile panel actions
    case "OPEN_PROFILE_PANEL":
      return {
        ...state,
        profilePanel: { column: action.column },
        columnScan: null,
        scanError: null,
      };

    case "CLOSE_PROFILE_PANEL":
      return {
        ...state,
        profilePanel: null,
        columnScan: null,
        scanError: null,
      };

    case "START_SCAN":
      return {
        ...state,
        scanLoading: true,
        scanError: null,
      };

    case "SCAN_SUCCESS":
      return {
        ...state,
        scanLoading: false,
        columnScan: action.scan,
        scanError: null,
      };

    case "SCAN_ERROR":
      return {
        ...state,
        scanLoading: false,
        scanError: action.error,
      };

    // UI actions
    case "SET_COPIED":
      return {
        ...state,
        copied: action.copied,
      };

    case "ANNOUNCE":
      return {
        ...state,
        announcement: action.message,
      };

    // Search actions
    case "SET_SEARCH_QUERY":
      return {
        ...state,
        searchQuery: action.query,
      };

    case "START_SEARCH":
      return {
        ...state,
        searchActive: true,
      };

    case "END_SEARCH":
      return {
        ...state,
        searchActive: false,
        searchQuery: "",
      };

    default:
      return state;
  }
}
