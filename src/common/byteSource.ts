/**
 * Random access to a file's bytes.
 *
 * Lives in `common` because both the host services (JSONL, parquet profile) and the shared
 * parquet reader need it; none of them should reach into another feature's module for a type.
 */
export interface ByteSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
  close?(): Promise<void> | void;
}
