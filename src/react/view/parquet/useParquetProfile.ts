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

  const startScan = useCallback(
    (column: ParquetColumnInfo, onRequest: (seq: number, column: ParquetColumnInfo) => void) => {
      const seq = ++profileRequest.current;
      setScanLoading(true);
      setScanError(null);
      onRequest(seq, column);
    },
    [],
  );

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
