/**
 * JSON preview memory measurement (ADR-0019).
 *
 * Follows the production path in `src/provider/jsonPreviewHandlers.ts` (`readJsonSource`):
 * readFile -> TextDecoder.decode -> JsonPreviewSession (record index) -> one whole-file search ->
 * a 100-record window. Every run happens in its own child process so runs do not inherit each
 * other's heap, and the child is started with `--expose-gc` so each sample is taken after a GC.
 *
 *   node scripts/perf/measure-json-memory.mjs [--runs=3] [--variant=ascii|twobyte|both]
 *
 * Variants (same 50,000 records, same size class, different string representation in V8):
 *  - `ascii`   : the perf fixture as is. V8 stores the decoded string one byte per character.
 *  - `twobyte` : the same fixture plus one CJK character in the first record's `message`. One
 *                non-Latin-1 character makes V8 store the *whole* string two bytes per character,
 *                which is the worst case for a mostly-ASCII file.
 *
 * Reported per stage (`process.memoryUsage()`, MB): rss, heapUsed, external, arrayBuffers.
 * `peakRss` is `process.resourceUsage().maxRSS`, the OS-reported high-water mark of the child.
 * Stages:
 *  - baseline     : bundle loaded, nothing read yet
 *  - read         : `readFileSync` Uint8Array alive
 *  - decoded      : Uint8Array and string both alive (the transient peak of `readJsonSource`)
 *  - decodedOnly  : Uint8Array dropped, string alive (what stays resident after `readJsonSource`)
 *  - indexed      : JsonPreviewSession built (record ranges)
 *  - searched     : after one whole-file search
 *  - windowed     : after reading a 100-record window
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJsonPerfFixtures } from "./fixtures.mjs";
import { loadJsonHost } from "./json.mjs";
import { repoRoot } from "../ui-verify/fixtures.mjs";

const MB = 1024 * 1024;
const cacheDir = join(repoRoot, ".perf");
const mb = (bytes) => Math.round((bytes / MB) * 10) / 10;

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

/** The two-byte variant: the perf fixture with one CJK character in the first record. */
function twoByteFixture(base) {
  const path = join(cacheDir, "json-array-100mb-twobyte.json");
  if (!existsSync(path) || statSync(path).size === 0) {
    const text = readFileSync(base, "utf8").replace("processed 0 rows", "processed 0 rows \u4e2d");
    writeFileSync(path, text, "utf8");
  }
  return path;
}

async function gc() {
  global.gc();
  await new Promise((resolve) => setTimeout(resolve, 50));
  global.gc();
}

function snapshot() {
  const usage = process.memoryUsage();
  return {
    rss: mb(usage.rss),
    heapUsed: mb(usage.heapUsed),
    external: mb(usage.external),
    arrayBuffers: mb(usage.arrayBuffers),
    peakRss: mb(process.resourceUsage().maxRSS * 1024),
  };
}

async function child(file) {
  const { JsonPreviewSession, cleanup } = await loadJsonHost();
  await gc();
  const stages = { baseline: snapshot() };

  let bytes = readFileSync(file);
  await gc();
  stages.read = snapshot();

  let text = new TextDecoder().decode(bytes);
  const byteSize = bytes.byteLength;
  await gc();
  stages.decoded = snapshot();

  bytes = null;
  await gc();
  stages.decodedOnly = snapshot();

  const session = new JsonPreviewSession(text, byteSize, "array.json", "measure", false);
  await gc();
  stages.indexed = snapshot();

  await new Promise((resolve, reject) => {
    session.search(1, "final-needle-marker", {
      onBatch: (batch) => {
        if (batch.done) resolve();
      },
    });
    setTimeout(() => reject(new Error("the JSON search did not finish")), 60_000).unref();
  });
  await gc();
  stages.searched = snapshot();

  const window = session.recordsInWindow(0, 100);
  if (window.length !== 100) throw new Error(`expected 100 records, got ${window.length}`);
  await gc();
  stages.windowed = snapshot();

  session.dispose();
  cleanup();
  text = null;
  process.stdout.write(
    JSON.stringify({ byteSize, records: session.info.recordCount, stages }) + "\n",
  );
}

function range(values) {
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? `${low}` : `${low}–${high}`;
}

function runVariant(name, file, runs) {
  const results = [];
  for (let run = 0; run < runs; run++) {
    const output = execFileSync(
      process.execPath,
      ["--expose-gc", fileURLToPath(import.meta.url), "--child", `--file=${file}`],
      { encoding: "utf8", maxBuffer: 1 << 20 },
    );
    results.push(JSON.parse(output.trim().split("\n").at(-1)));
  }

  const first = results[0];
  console.log(
    `\n## ${name}: ${mb(first.byteSize)} MB, ${first.records.toLocaleString()} records, ${runs} runs`,
  );
  console.log("stage         rss            heapUsed       external       arrayBuffers   peakRss");
  for (const stage of Object.keys(first.stages)) {
    const cells = ["rss", "heapUsed", "external", "arrayBuffers", "peakRss"].map((metric) =>
      range(results.map((result) => result.stages[stage][metric])).padEnd(14),
    );
    console.log(`${stage.padEnd(13)} ${cells.join(" ")}`);
  }
  const delta = (stage) =>
    range(
      results.map((result) => mb((result.stages[stage].rss - result.stages.baseline.rss) * MB)),
    );
  const ratio = (stage) =>
    range(
      results.map(
        (result) =>
          Math.round(
            ((result.stages[stage].rss - result.stages.baseline.rss) / mb(result.byteSize)) * 100,
          ) / 100,
      ),
    );
  console.log(
    `rss over baseline (MB):  decoded ${delta("decoded")}  decodedOnly ${delta("decodedOnly")}  indexed ${delta("indexed")}  searched ${delta("searched")}`,
  );
  console.log(
    `as multiple of file:     decoded ${ratio("decoded")}x  decodedOnly ${ratio("decodedOnly")}x  indexed ${ratio("indexed")}x  searched ${ratio("searched")}x`,
  );
  console.log(
    `peakRss over baseline (MB): ${range(results.map((result) => Math.round((result.stages.windowed.peakRss - result.stages.baseline.peakRss) * 10) / 10))}`,
  );
}

if (process.argv.includes("--child")) {
  if (!global.gc) throw new Error("the child needs --expose-gc");
  await child(arg("file"));
} else {
  const runs = Number.parseInt(arg("runs", "3"), 10) || 3;
  const variant = arg("variant", "both");
  const fixtures = createJsonPerfFixtures(cacheDir);
  console.log(`node ${process.version}, ${process.platform} ${process.arch}`);
  if (variant === "ascii" || variant === "both") runVariant("ascii", fixtures.jsonArray, runs);
  if (variant === "twobyte" || variant === "both") {
    runVariant("twobyte", twoByteFixture(fixtures.jsonArray), runs);
  }
}
