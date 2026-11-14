/**
 * Column Profiling Management for Parquet Viewer
 *
 * Manages the column profiling panel that shows statistical analysis
 * of column data, including value distributions, top values, and histograms.
 *
 * @module useParquetProfile
 */

import { useCallback, useRef, useState } from "react";
import type { ParquetColumnScan } from "@/common/parquetProfileTypes";
import type { ParquetColumnInfo } from "./parquetParser.ts";

interface ProfilePanel {
  column: ParquetColumnInfo;
}

/**
 * Manages the column profiling panel state and scan requests.
 *
 * The profile panel shows:
 * - Column statistics (min, max, distinct count, etc.)
 * - Top values histogram
 * - Value distribution
 *
 * @returns Profile panel state and control functions
 */
export function useParquetProfile() {
  const [profilePanel, setProfilePanel] = useState<ProfilePanel | null>(null);
  const [columnScan, setColumnScan] = useState<ParquetColumnScan | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const profileRequest = useRef(0);

  const openProfilePanel = useCallback((column: ParquetColumnInfo) => {
    setProfilePanel({ column });
    setColumnScan(null);
    setScanError(null);
  }, []);

  const closeProfilePanel = useCallback(() => {
    setProfilePanel(null);
    setColumnScan(null);
    setScanError(null);
  }, []);

  /**
   * Start a column scan operation.
   *
   * Initiates a request to scan column values for statistical analysis.
   *
   * @param column - The column to scan
   * @param onRequest - Callback to send the scan request to the host
   */
  const startScan = useCallback(
    (column: ParquetColumnInfo, onRequest: (seq: number, column: ParquetColumnInfo) => void) => {
      const seq = ++profileRequest.current;
      setScanLoading(true);
      setScanError(null);
      onRequest(seq, column);
    },
    [],
  );

  /**
   * Handle scan response from host.
   *
   * Updates scan state only if the sequence number matches the current request.
   *
   * @param seq - Sequence number of the scan request
   * @param scan - Scan results (null on error)
   * @param error - Error message (null on success)
   */
  const handleScanReply = useCallback(
    (seq: number, scan: ParquetColumnScan | null, error: string | null) => {
      if (seq !== profileRequest.current) return;

      setScanLoading(false);
      if (error) {
        setScanError(error);
        setColumnScan(null);
      } else {
        setColumnScan(scan);
        setScanError(null);
      }
    },
    [],
  );

  return {
    profilePanel,
    columnScan,
    scanLoading,
    scanError,
    profileRequest,
    openProfilePanel,
    closeProfilePanel,
    startScan,
    handleScanReply,
  };
}
