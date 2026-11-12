/**
 * Host-side parquet column-profile check.
 *
 * The profile is the first parquet capability that lives in the extension host (ADR-0020), so it
 * is measured in Node like the JSON scenarios: esbuild bundles `src/service/parquetProfile.ts`,
 * and the browser does not participate.
 *
 * The invariant is **bytes**, not seconds. The fixture is 4.3 MB and decodes whole in ~1.5 s, so
 * a "≤ 2 s" budget would accept an implementation that decodes every page. A profile is answered
 * from the footer, and this check fails when the byte count climbs into data-page territory —
 * including the regression of dropping the explicit `initialFetchSize` (hyparquet then pulls a
 * 512 KB tail first).
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { repoRoot } from "../ui-verify/fixtures.mjs";
import { expect } from "./expect.mjs";

/**
 * A footer for ten row groups over seven columns is a few KB. 256 KB is deliberately loose: it
 * still rejects a whole-file read (4.3 MB) and hyparquet's default 512 KB tail fetch, while it
 * leaves room for a fixture that grows a few more columns.
 */
const PROFILE_BYTE_CAP = 256 * 1024;
/** Metadata parsing of ten row groups is a few milliseconds; this only catches a decode. */
const PROFILE_BUDGET_MS = 300;

export async function loadProfileHost() {
  const outdir = mkdtempSync(join(tmpdir(), "perf-parquet-profile-"));
  await build({
    entryPoints: [join(repoRoot, "src/service/parquetProfile.ts")],
    outdir,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    tsconfig: join(repoRoot, "tsconfig.json"),
    logLevel: "silent",
  });
  const module = await import(pathToFileURL(join(outdir, "parquetProfile.mjs")).href);
  return {
    readParquetProfile: module.readParquetProfile,
    cleanup: () => rmSync(outdir, { recursive: true, force: true }),
  };
}

function countingSource(bytes) {
  let bytesRead = 0;
  let reads = 0;
  return {
    source: {
      size: bytes.byteLength,
      async read(offset, length) {
        const slice = bytes.subarray(offset, offset + length);
        bytesRead += slice.byteLength;
        reads += 1;
        return slice;
      },
    },
    get bytesRead() {
      return bytesRead;
    },
    get reads() {
      return reads;
    },
  };
}

export const profileScenarios = [
  {
    name: "parquet-profile-metadata-only",
    async run({ fixtures, profileHost }) {
      const bytes = new Uint8Array(readFileSync(fixtures.profile));
      const counter = countingSource(bytes);

      const started = performance.now();
      const profile = await profileHost.readParquetProfile(counter.source);
      const elapsed = Math.round(performance.now() - started);

      expect(
        profile.rowCount === fixtures.profileRows,
        `profile says ${profile.rowCount} rows, the fixture has ${fixtures.profileRows}`,
      );
      expect(
        profile.rowGroupCount === fixtures.profileRowGroups,
        `profile says ${profile.rowGroupCount} row groups, the fixture has ${fixtures.profileRowGroups}`,
      );
      expect(profile.hasAnyStatistics, "the fixture writes statistics; the profile found none");

      const byName = new Map(profile.columns.map((column) => [column.name, column]));
      const name = byName.get("name");
      expect(name?.state === "available", `column \`name\` is ${name?.state ?? "missing"}`);
      expect(
        typeof name.nullCount === "number" && name.nullCount > 0,
        `column \`name\` reported ${name.nullCount} nulls; the fixture has some in every group`,
      );
      expect(
        name.nullRatio === name.nullCount / profile.rowCount,
        `null ratio ${name.nullRatio} does not match ${name.nullCount}/${profile.rowCount}`,
      );
      expect(byName.get("meta_json")?.state === "available", "the JSON column must be profiled");
      expect(
        byName.get("tags_json")?.state === "available",
        "the JSON-array column must be profiled",
      );
      // Statistics exist for a JSON column, but a JSON value has no order, so it has no range.
      // Absent min/max here is the correct answer; fabricated ones would be the bug.
      expect(
        byName.get("tags_json")?.min === undefined,
        `a JSON column reported a range (${byName.get("tags_json")?.min}); values are not ordered`,
      );

      expect(
        elapsed <= PROFILE_BUDGET_MS,
        `profiling took ${elapsed} ms (budget ${PROFILE_BUDGET_MS} ms); metadata parsing is not a decode`,
      );
      expect(
        counter.bytesRead <= PROFILE_BYTE_CAP,
        `profiling read ${counter.bytesRead} of ${bytes.byteLength} bytes ` +
          `(cap ${PROFILE_BYTE_CAP}); that is data pages, not a footer`,
      );

      return (
        `${elapsed} ms / ${counter.bytesRead} bytes in ${counter.reads} reads for ` +
        `${(fixtures.profileBytes / (1024 * 1024)).toFixed(1)} MB, ` +
        `${fixtures.profileRows.toLocaleString()} rows in ${fixtures.profileRowGroups} row groups`
      );
    },
  },
];
