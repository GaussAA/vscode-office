/**
 * Document Loading Management for Parquet Viewer
 *
 * Manages the lifecycle of Parquet file loading, including:
 * - File opening and reopening
 * - Loading and error states
 * - File metadata and column profiling data
 * - Sequence tracking to handle concurrent requests
 *
 * @module useParquetDocument
 */

import { useCallback, useRef, useState } from "react";
import type { ParquetFileInfo } from "./parquetParser.ts";
import type { ParquetProfile } from "@/common/parquetProfileTypes";

/**
 * Manages Parquet file loading and metadata state.
 *
 * Handles:
 * - File opening and reopening
 * - Loading states
 * - Error states
 * - File metadata (row count, columns, codecs)
 * - Column profiling data
 *
 * @returns Document state and control functions
 */
export function useParquetDocument() {
  const [fileInfo, setFileInfo] = useState<ParquetFileInfo | null>(null);
  const [profile, setProfile] = useState<ParquetProfile | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  const fileInfoRef = useRef<ParquetFileInfo | null>(null);
  const documentKeyRef = useRef<string | undefined>(undefined);
  const openSeqRef = useRef(0);

  const updateFileInfo = useCallback((info: ParquetFileInfo | null) => {
    setFileInfo(info);
    fileInfoRef.current = info;
  }, []);

  const updateProfile = useCallback((prof: ParquetProfile | null) => {
    setProfile(prof);
  }, []);

  const updateError = useCallback((err: Error | null) => {
    setError(err);
    setLoading(false);
  }, []);

  const updateLoading = useCallback((isLoading: boolean) => {
    setLoading(isLoading);
  }, []);

  const startOpen = useCallback(() => {
    const seq = ++openSeqRef.current;
    setLoading(true);
    setError(null);
    return seq;
  }, []);

  const isCurrentOpen = useCallback((seq: number) => {
    return seq === openSeqRef.current;
  }, []);

  const setDocumentKey = useCallback((key: string | undefined) => {
    documentKeyRef.current = key;
  }, []);

  return {
    fileInfo,
    fileInfoRef,
    profile,
    error,
    loading,
    documentKeyRef,
    openSeqRef,
    updateFileInfo,
    updateProfile,
    updateError,
    updateLoading,
    startOpen,
    isCurrentOpen,
    setDocumentKey,
  };
}
