/**
 * Node-side measurement of JSONL full-text search on the 1 GB fixture.
 *
 *   pnpm exec tsx scripts/perf/jsonl-search-breakdown.mts            # every scenario, 3 runs each
 *   pnpm exec tsx scripts/perf/jsonl-search-breakdown.mts --reps=5 --only=few
 *   pnpm exec tsx scripts/perf/jsonl-search-breakdown.mts --file=C:\path\to\other.jsonl
 *
 * It imports the real modules through tsx (no bundling) and reports two things per scenario:
 *
 *   e2e        the production `JsonlAdapter.search` end to end (default scheduler, default limits)
 *   breakdown  the same loop re-run phase by phase with the legacy primitives that `stepOnce`
 *              used to call: disk read, window-local index, UTF-8 decode, match, summary. It
 *              exists to answer "where do the seconds go"; it does not replace the adapter.
 *
 * Every run is a fresh child process, so JIT warm-up and V8 heap growth are paid each time
 * and the median is not flattered by a hot second run. The fixture comes from
 * `node scripts/perf/fixtures-1gb.mjs --only=jsonl1g` (output in `.perf/`, gitignored).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JSONL_SEARCH_BATCH,
  JSONL_SEARCH_BYTE_BUDGET,
  JSONL_SEARCH_MAX_MATCHES,
  type JsonlSearchBatch,
} from "@/common/jsonlTypes";
import { jsonlAdapter } from "@/service/jsonlAdapter";
import {
  buildJsonlIndex,
  matchSnippet,
  readJsonlLineText,
  summarizeDecodedLine,
} from "@/service/jsonlDocument";
import { fileByteSource, JsonlFile } from "@/service/jsonlFile";
import { createCancelToken, foldNeedle } from "@/service/recordAddressableDocument";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const option = (name: string): string | undefined =>
  args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);

const fixture = option("file") ?? join(root, ".perf", "jsonl-1gib-5m.jsonl");
const STEP = 20_000;

interface Scenario {
  key: string;
  label: string;
  query: string;
  /** Raise the match cap so a dense needle is not stopped after 10,000 hits. */
  maxMatches?: number;
}

function scenarios(): Scenario[] {
  const meta = JSON.parse(readFileSync(`${fixture}.meta.json`, "utf8")) as {
    needleFew: string;
    needleMany: string;
    needleNone: string;
  };
  return [
    { key: "few", label: "1 hit, last line", query: meta.needleFew },
    { key: "few-upper", label: "1 hit, query upper-cased", query: meta.needleFew.toUpperCase() },
    { key: "none", label: "0 hits, full scan", query: meta.needleNone },
    { key: "many", label: "capped at 10,000 hits", query: meta.needleMany },
    {
      key: "dense",
      label: "250,000 hits (1 in 20), cap raised",
      query: '"service":"worker-7"',
      maxMatches: 10_000_000,
    },
  ];
}

const ms = (from: number) => performance.now() - from;

async function runE2e(scenario: Scenario) {
  const openStart = performance.now();
  const file = await JsonlFile.open(await fileByteSource(fixture));
  const openMs = ms(openStart);
  const adapter = jsonlAdapter(file);
  const hash = createHash("sha256");
  let batches = 0;
  let last: JsonlSearchBatch | undefined;
  const start = performance.now();
  await new Promise<void>((resolve) => {
    adapter.search(
      1,
      scenario.query,
      {
        maxMatches: scenario.maxMatches,
        onBatch: (batch) => {
          batches++;
          hash.update(JSON.stringify(batch));
          if (batch.done) {
            last = batch;
            resolve();
          }
        },
      },
      createCancelToken(),
    );
  });
  const totalMs = ms(start);
  adapter.dispose();
  return {
    openMs,
    totalMs,
    batches,
    matches: last?.matches,
    scanned: last?.scanned,
    capped: last?.capped,
    digest: hash.digest("hex").slice(0, 16),
  };
}

async function runBreakdown(scenario: Scenario) {
  const file = await JsonlFile.open(await fileByteSource(fixture));
  const needle = foldNeedle(scenario.query);
  const maxMatches = scenario.maxMatches ?? JSONL_SEARCH_MAX_MATCHES;
  const t = { read: 0, localIndex: 0, decode: 0, match: 0, summary: 0 };
  let scanned = 0;
  let matches = 0;
  let bytes = 0;
  const wall = performance.now();
  while (scanned < file.lineCount && matches < maxMatches) {
    const until = Math.max(
      scanned + 1,
      Math.min(file.lineCount, file.advance(scanned, STEP, JSONL_SEARCH_BYTE_BUDGET)),
    );
    const range = file.lineRange(scanned);
    const end = until < file.lineCount ? file.index.offsets[until] : file.byteSize;

    let mark = performance.now();
    const chunk = await file.source.read(range.start, end - range.start);
    t.read += ms(mark);
    bytes += chunk.byteLength;

    mark = performance.now();
    const local = buildJsonlIndex(chunk);
    t.localIndex += ms(mark);

    mark = performance.now();
    const texts: string[] = new Array(local.lineCount);
    for (let line = 0; line < local.lineCount; line++) {
      texts[line] = readJsonlLineText(chunk, local, line);
    }
    t.decode += ms(mark);

    mark = performance.now();
    const hits: number[] = [];
    for (let line = 0; line < texts.length; line++) {
      if (matchSnippet(texts[line], needle) !== undefined) hits.push(line);
    }
    t.match += ms(mark);

    mark = performance.now();
    for (const line of hits) {
      summarizeDecodedLine(scanned + line, texts[line], needle);
      matches++;
      if (matches >= maxMatches) break;
    }
    t.summary += ms(mark);
    scanned = until;
  }
  return { ...t, wallMs: ms(wall), matches, scanned, mib: bytes / 1048576 };
}

async function child(mode: string, key: string) {
  const scenario = scenarios().find((candidate) => candidate.key === key);
  if (!scenario) throw new Error(`unknown scenario ${key}`);
  const result = mode === "e2e" ? await runE2e(scenario) : await runBreakdown(scenario);
  process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function spawnChild(mode: string, key: string): Record<string, number | string | boolean> {
  const run = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      fileURLToPath(import.meta.url),
      `--child=${mode}:${key}`,
      `--file=${fixture}`,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  const line = run.stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (!line) throw new Error(`child ${mode}:${key} failed\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(line.slice("RESULT ".length));
}

async function main() {
  const childArg = option("child");
  if (childArg) {
    const [mode, key] = childArg.split(":");
    await child(mode, key);
    return;
  }
  if (!existsSync(fixture)) {
    throw new Error(`missing ${fixture}; run: node scripts/perf/fixtures-1gb.mjs --only=jsonl1g`);
  }
  const reps = Number(option("reps") ?? 3);
  const only = option("only")?.split(",");
  const skipBreakdown = args.includes("--no-breakdown");
  console.log(
    `fixture ${fixture}\nnode ${process.version}, step ${STEP}, batch ${JSONL_SEARCH_BATCH}`,
  );
  for (const scenario of scenarios()) {
    if (only && !only.includes(scenario.key)) continue;
    console.log(
      `\n## ${scenario.key}: ${scenario.label}  (query ${JSON.stringify(scenario.query)})`,
    );
    const e2e = Array.from({ length: reps }, () => spawnChild("e2e", scenario.key));
    const totals = e2e.map((run) => run.totalMs as number);
    console.log(
      `e2e total ms  runs=[${totals.map((v) => v.toFixed(0)).join(", ")}]  median=${median(totals).toFixed(0)}` +
        `  open=${median(e2e.map((run) => run.openMs as number)).toFixed(0)}` +
        `  matches=${e2e[0].matches} scanned=${e2e[0].scanned} capped=${e2e[0].capped} batches=${e2e[0].batches}` +
        `  digest=${[...new Set(e2e.map((run) => run.digest))].join("/")}`,
    );
    if (skipBreakdown || scenario.key === "many") continue;
    const parts = Array.from({ length: reps }, () => spawnChild("breakdown", scenario.key));
    const pick = (name: string) => median(parts.map((run) => run[name] as number));
    console.log(
      `breakdown ms  read=${pick("read").toFixed(0)}  localIndex=${pick("localIndex").toFixed(0)}` +
        `  decode=${pick("decode").toFixed(0)}  match=${pick("match").toFixed(0)}` +
        `  summary=${pick("summary").toFixed(0)}  wall=${pick("wallMs").toFixed(0)}` +
        `  (median of ${reps}; ${(parts[0].mib as number).toFixed(0)} MiB read)`,
    );
  }
}

await main();
