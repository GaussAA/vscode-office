import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent,
} from "react";
import { headerCells } from "./sheetView";
import { createSheetWindowReader } from "./sheetWindowReader";
import { scrollTopForRow, type VisibleRange } from "./sheetWindow";
import type { SheetSource } from "./sheetSource";
import { HEADER_HEIGHT, OVERSCAN, ROW_HEIGHT, toBodySource } from "./windowedSheetModel";

export interface WindowedRows {
  scrollerRef: RefObject<HTMLDivElement | null>;
  rows: string[][];
  range: VisibleRange | null;
  headerLabels: string[];
  error: string | null;
  setError: (message: string | null) => void;
  dataRowCount: number;
  columnCount: number;
  dataSource: SheetSource;
  bodyScrollTop: number;
  bodyViewportHeight: number;
  viewportHeight: number;
  viewport: {
    rowHeight: number;
    viewportHeight: number;
    totalRows: number;
    overscan: number;
  };
  totalHeight: number;
  handleScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollToRow: (row: number) => void;
  ensureRowVisible: (row: number) => void;
}

/**
 * Owns the virtual-row window: source offsetting, viewport measurement, the reader cache and
 * scroll coordinates. The component above it only decides what to draw.
 */
export function useWindowedRows(source: SheetSource): WindowedRows {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);
  const latestTopRef = useRef(0);
  const loadSeq = useRef(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [rows, setRows] = useState<string[][]>([]);
  const [range, setRange] = useState<VisibleRange | null>(null);
  const [headerLabels, setHeaderLabels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const dataRowCount = Math.max(0, source.rowCount - 1);
  const columnCount = Math.max(1, source.columnCount);
  const dataSource = useMemo(() => toBodySource(source), [source]);
  const reader = useMemo(() => createSheetWindowReader(dataSource), [dataSource]);
  const bodyViewportHeight = Math.max(0, viewportHeight - HEADER_HEIGHT);
  const viewport = useMemo(
    () => ({
      rowHeight: ROW_HEIGHT,
      viewportHeight: bodyViewportHeight,
      totalRows: dataRowCount,
      overscan: OVERSCAN,
    }),
    [bodyViewportHeight, dataRowCount],
  );
  const bodyScrollTop = Math.max(0, scrollTop - HEADER_HEIGHT);

  // Read the file's first row once. It becomes the frozen column header; the body never sees it.
  useEffect(() => {
    let cancelled = false;
    void source
      .readRows(0, 1)
      .then(([first]) => {
        if (!cancelled) setHeaderLabels(headerCells(first ? [first] : [], columnCount));
      })
      .catch(() => {
        if (!cancelled) setHeaderLabels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [columnCount, source]);

  // The viewport height decides how many rows to ask for; it changes with the panel, not the scroll.
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const measure = () => setViewportHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (viewportHeight <= 0) return;
    const ticket = ++loadSeq.current;
    void reader
      .rowsFor(bodyScrollTop, viewport)
      .then((snapshot) => {
        if (ticket !== loadSeq.current || snapshot.stale) return;
        setRows(snapshot.rows);
        setRange(snapshot.range);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (ticket !== loadSeq.current) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  }, [reader, bodyScrollTop, viewport, viewportHeight]);

  // One state update per frame: a trackpad emits far more scroll events than there are paints,
  // and every update would otherwise queue another window read.
  const handleScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    latestTopRef.current = event.currentTarget.scrollTop;
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      setScrollTop(latestTopRef.current);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, []);

  const scrollToRow = useCallback(
    (row: number) => {
      const top = HEADER_HEIGHT + scrollTopForRow(row, viewport);
      if (scrollerRef.current) scrollerRef.current.scrollTop = top;
      latestTopRef.current = top;
      setScrollTop(top);
    },
    [viewport],
  );

  const ensureRowVisible = useCallback(
    (row: number) => {
      const top = Math.max(0, scrollTop - HEADER_HEIGHT);
      const rowTop = row * ROW_HEIGHT;
      if (rowTop >= top && rowTop + ROW_HEIGHT <= top + bodyViewportHeight) return;
      const desired = rowTop < top ? rowTop : rowTop - bodyViewportHeight + ROW_HEIGHT;
      const maxBody = Math.max(0, dataRowCount * ROW_HEIGHT - bodyViewportHeight);
      const next = HEADER_HEIGHT + Math.min(Math.max(0, desired), maxBody);
      if (scrollerRef.current) scrollerRef.current.scrollTop = next;
      latestTopRef.current = next;
      setScrollTop(next);
    },
    [bodyViewportHeight, dataRowCount, scrollTop],
  );

  return {
    scrollerRef,
    rows,
    range,
    headerLabels,
    error,
    setError,
    dataRowCount,
    columnCount,
    dataSource,
    bodyScrollTop,
    bodyViewportHeight,
    viewportHeight,
    viewport,
    totalHeight: dataRowCount * ROW_HEIGHT,
    handleScroll,
    scrollToRow,
    ensureRowVisible,
  };
}
