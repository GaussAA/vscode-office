import { useEffect, useRef, useState, type RefObject } from "react";
import type { ParquetFileInfo } from "./parquetParser";
import type { ParquetSession } from "./parquetSession";
import { MIN_ROWS_PER_PAGE, PARQUET_MAX_PAGE_SIZE, ROW_HEIGHT } from "./parquetLayout";

export function pageSizeForBodyHeight(bodyHeight: number): number {
  return Math.min(
    PARQUET_MAX_PAGE_SIZE,
    Math.max(MIN_ROWS_PER_PAGE, Math.floor(bodyHeight / ROW_HEIGHT)),
  );
}

interface UseParquetTableSizeArgs {
  tableWrapRef: RefObject<HTMLDivElement | null>;
  fileInfo: ParquetFileInfo | null;
  siderWidth: number;
  sessionRef: RefObject<ParquetSession | null>;
  restoreRowRef: RefObject<number>;
  loadedStartRef: RefObject<number>;
  onPageChange: (page: number) => void;
}

/**
 * The table body is the available flex height, and that height decides how many rows a page
 * holds. Keeping the measurement and page-size transition here means a sidebar drag or a window
 * resize cannot leave the pager describing a different slice than the one on screen.
 */
export function useParquetTableSize({
  tableWrapRef,
  fileInfo,
  siderWidth,
  sessionRef,
  restoreRowRef,
  loadedStartRef,
  onPageChange,
}: UseParquetTableSizeArgs) {
  const [pageSize, setPageSize] = useState(MIN_ROWS_PER_PAGE);
  const pageSizeRef = useRef(MIN_ROWS_PER_PAGE);
  const [tableBodyHeight, setTableBodyHeight] = useState(320);
  const [tableBodyWidth, setTableBodyWidth] = useState(0);
  /** Bumped when the page size changes, so the page loader runs against the new slicing. */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const element = tableWrapRef.current;
    if (!element || !fileInfo) return;
    const update = () => {
      const header = element.querySelector<HTMLElement>(".ant-table-header");
      const headerHeight = header?.offsetHeight ?? 38;
      const bodyHeight = Math.max(80, Math.round(element.clientHeight - headerHeight));
      setTableBodyHeight(bodyHeight);
      setTableBodyWidth(element.clientWidth);
      // A page is one screenful: the pager's row range should describe the rows you can see.
      const rows = pageSizeForBodyHeight(bodyHeight);
      if (rows !== pageSizeRef.current) {
        pageSizeRef.current = rows;
        // Which page holds the row we want? On the first sizing that is the persisted row
        // (a page cannot be computed before the size is known); afterwards it is the row
        // already on screen, so a resize does not move the reader.
        const keepRow = restoreRowRef.current || loadedStartRef.current;
        restoreRowRef.current = 0;
        const session = sessionRef.current;
        if (session) onPageChange(session.setPageSize(rows, keepRow));
        setPageSize(rows);
        setReloadToken((token) => token + 1);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [fileInfo, loadedStartRef, onPageChange, restoreRowRef, sessionRef, siderWidth, tableWrapRef]);

  return {
    pageSize,
    pageSizeRef,
    tableBodyHeight,
    tableBodyWidth,
    reloadToken,
  };
}
