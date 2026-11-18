/**
 * Differential tests for the JSONL search byte prefilter.
 *
 * `legacySearch` below is the search loop as it was before the prefilter: read a window, build a
 * window-local index, decode EVERY line, run the real matcher. The production adapter must emit
 * exactly the same batch sequence (entries, snippets, `scanned`, `matches`, `done`, `capped`) for
 * every file, query and option set, including after a cancellation.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import {
  JSONL_SEARCH_BATCH,
  JSONL_SEARCH_BYTE_BUDGET,
  JSONL_SEARCH_MAX_MATCHES,
  type JsonlEntrySummary,
  type JsonlSearchBatch,
} from "@/common/jsonlTypes";
import type { ByteSource } from "@/common/byteSource";
import { jsonlAdapter } from "@/service/jsonlAdapter";
import { byteNeedle, candidateLines } from "@/service/jsonlByteSearch";
import {
  matchSnippet as jsonlMatchSnippet,
  readJsonlLineText,
  summarizeDecodedLine,
} from "@/service/jsonlDocument";
import { JsonlFile, memoryByteSource } from "@/service/jsonlFile";
import {
  createCancelToken,
  findCaseInsensitive,
  foldNeedle,
  type CancelToken,
  type SearchOptions,
} from "@/service/recordAddressableDocument";

// ---------------------------------------------------------------------------------------------
// Reference implementation: the pre-prefilter `JsonlAdapter.search`, kept verbatim in behaviour.
// ---------------------------------------------------------------------------------------------

function legacySearch(
  file: JsonlFile,
  requestId: number,
  query: string,
  options: SearchOptions<JsonlSearchBatch>,
  cancelToken: CancelToken,
): void {
  const needle = foldNeedle(query);
  if (!needle) {
    options.onBatch({
      requestId,
      query,
      entries: [],
      scanned: 0,
      total: file.lineCount,
      matches: 0,
      done: true,
      capped: false,
    });
    return;
  }
  const batchSize = options.batchSize ?? JSONL_SEARCH_BATCH;
  const maxMatches = options.maxMatches ?? JSONL_SEARCH_MAX_MATCHES;
  const schedule = options.schedule ?? ((run) => setTimeout(run, 0));
  const step = options.step ?? 20_000;

  let scanned = 0;
  let matches = 0;
  let capped = false;
  let pending: JsonlEntrySummary[] = [];

  const flush = (done: boolean) => {
    options.onBatch({
      requestId,
      query,
      entries: pending,
      scanned,
      total: file.lineCount,
      matches,
      done,
      capped,
    });
    pending = [];
  };

  const stepOnce = async () => {
    if (cancelToken.cancelled) return;
    const until = Math.max(
      scanned + 1,
      Math.min(file.lineCount, file.advance(scanned, step, JSONL_SEARCH_BYTE_BUDGET)),
    );
    let window;
    try {
      window = await file.window(scanned, until);
    } catch {
      if (!cancelToken.cancelled) flush(true);
      return;
    }
    if (cancelToken.cancelled) return;
    for (let offset = 0; offset < window.index.lineCount; offset++) {
      const rawText = readJsonlLineText(window.bytes, window.index, offset);
      const snippet = jsonlMatchSnippet(rawText, needle);
      if (snippet === undefined) continue;
      matches++;
      const summary = summarizeDecodedLine(scanned + offset, rawText, needle);
      pending.push({ ...summary, snippet });
      if (pending.length >= batchSize) {
        if (cancelToken.cancelled) return;
        flush(false);
      }
      if (matches >= maxMatches) {
        capped = true;
        break;
      }
    }
    scanned = until;
    if (cancelToken.cancelled) return;
    if (capped || scanned >= file.lineCount) {
      flush(true);
      return;
    }
    if (pending.length > 0) flush(false);
    schedule(() => {
      void stepOnce();
    });
  };

  schedule(() => {
    void stepOnce();
  });
}

// ---------------------------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------------------------

type Runner = (
  file: JsonlFile,
  requestId: number,
  query: string,
  options: SearchOptions<JsonlSearchBatch>,
  cancelToken: CancelToken,
) => void;

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

interface RunOptions {
  step?: number;
  batchSize?: number;
  maxMatches?: number;
  /** Cancel from inside `onBatch` once this many batches have arrived. */
  cancelAfterBatches?: number;
}

/** Run one search to completion (or to its cancellation) and return every batch it emitted. */
async function run(
  runner: Runner,
  file: JsonlFile,
  query: string,
  options: RunOptions = {},
): Promise<JsonlSearchBatch[]> {
  const batches: JsonlSearchBatch[] = [];
  const queue: Array<() => void> = [];
  const token = createCancelToken();
  runner(
    file,
    7,
    query,
    {
      step: options.step,
      batchSize: options.batchSize,
      maxMatches: options.maxMatches,
      schedule: (task) => queue.push(task),
      onBatch: (batch) => {
        batches.push(structuredClone(batch));
        if (
          options.cancelAfterBatches !== undefined &&
          batches.length >= options.cancelAfterBatches
        ) {
          token.cancel();
        }
      },
    },
    token,
  );
  while (queue.length > 0) {
    queue.shift()!();
    // The step awaits a memory source: every continuation finishes before the next macrotask.
    await tick();
  }
  return batches;
}

const productionRunner: Runner = (file, requestId, query, options, token) => {
  jsonlAdapter(file).search(requestId, query, options, token);
};

async function assertSame(
  source: ByteSource,
  query: string,
  options: RunOptions,
  label: string,
): Promise<JsonlSearchBatch[]> {
  const file = await JsonlFile.open(source);
  const expected = await run(legacySearch, file, query, options);
  const actual = await run(productionRunner, file, query, options);

  // Detailed diff when entry counts differ
  const actualEntries = actual.flatMap((b) => b.entries);
  const expectedEntries = expected.flatMap((b) => b.entries);
  if (actualEntries.length !== expectedEntries.length) {
    const actualIndices = actualEntries.map((e) => e.index).sort((a, b) => a - b);
    const expectedIndices = expectedEntries.map((e) => e.index).sort((a, b) => a - b);
    const extra = actualIndices.filter(
      (idx, i) => idx !== expectedIndices[i] || i >= expectedIndices.length,
    );
    const missing = expectedIndices.filter(
      (idx, i) => idx !== actualIndices[i] || i >= actualIndices.length,
    );

    const msg = [
      `${label}: query ${JSON.stringify(query)}`,
      `  actual: ${actualIndices.length} matches at lines ${JSON.stringify(actualIndices)}`,
      `  expected: ${expectedIndices.length} matches at lines ${JSON.stringify(expectedIndices)}`,
    ];
    if (extra.length > 0 || missing.length > 0) {
      msg.push(`  => New impl finds lines ${JSON.stringify(actualIndices)}`);
      msg.push(`  => Legacy finds lines ${JSON.stringify(expectedIndices)}`);
    }
    assert.fail(msg.join("\n"));
  }

  assert.deepEqual(
    actual,
    expected,
    `${label}: query ${JSON.stringify(query)} ${JSON.stringify(options)}`,
  );
  return actual;
}

// ---------------------------------------------------------------------------------------------
// Data generation (seeded, so a failure names a reproducible seed)
// ---------------------------------------------------------------------------------------------

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const encoder = new TextEncoder();

const ASCII_WORDS = [
  "alpha",
  "Beta",
  "KILO",
  "kilo",
  "Kilo",
  "Istanbul",
  "istanbul",
  "ISTANBUL",
  "needle",
  "Needle",
  "foo",
  "bar",
  "null",
  "true",
  "12345",
  "x",
  "ik",
  "KI",
  "ski",
  "Taxi",
  "hi",
  "I",
  "i",
  "k",
  "K",
];
const UNICODE_WORDS = [
  "İ",
  "İstanbul",
  "İSTANBUL",
  "i̇",
  "İİİ",
  "K",
  "Kilo",
  "ß",
  "ẞ",
  "Σ",
  "σ",
  "ς",
  "ΑΣ",
  "😀",
  "𝒳",
  "中文",
  "日本語",
  "é",
  "É",
  "ǅ",
  "ǆ",
  "ﬃ",
  "\u0307",
  "ı",
  "Å",
  "Å",
  "ǈ",
];
const PUNCTUATION = ['"', ":", "{", "}", ",", " ", "\t", "\\n", "[", "]"];
/** Bytes a decoder must not let swallow a neighbouring ASCII byte. */
const RAW_BYTES: number[][] = [
  [0xff],
  [0xe2, 0x84],
  [0xc4],
  [0xf0, 0x9f],
  [0xe2, 0x84, 0xaa],
  [0xc4, 0xb0],
  [0xc0, 0x80],
  [0xed, 0xa0, 0x80],
  [0x0d],
];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function makeLine(random: () => number): Uint8Array {
  const kind = random();
  if (kind < 0.08) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  const pieces = 1 + Math.floor(random() * 10);
  for (let i = 0; i < pieces; i++) {
    const roll = random();
    if (roll < 0.4) parts.push(encoder.encode(pick(random, ASCII_WORDS)));
    else if (roll < 0.7) parts.push(encoder.encode(pick(random, UNICODE_WORDS)));
    else if (roll < 0.85) parts.push(encoder.encode(pick(random, PUNCTUATION)));
    else parts.push(Uint8Array.from(pick(random, RAW_BYTES)));
  }
  const body = concat(parts);
  if (kind < 0.5) {
    // Looks like a JSON record; bytes are not required to stay valid.
    return concat([
      encoder.encode('{"v":"'),
      body,
      encoder.encode(`","n":${Math.floor(random() * 99)}}`),
    ]);
  }
  return body;
}

function makeFile(seed: number): { bytes: Uint8Array; lines: Uint8Array[] } {
  const random = prng(seed);
  const count = Math.floor(random() * 40);
  const lines: Uint8Array[] = [];
  for (let i = 0; i < count; i++) lines.push(makeLine(random));
  if (count > 0 && random() < 0.2)
    lines[0] = concat([Uint8Array.from([0xef, 0xbb, 0xbf]), lines[0]]);
  const newline = Uint8Array.from([0x0a]);
  const crlf = Uint8Array.from([0x0d, 0x0a]);
  const parts: Uint8Array[] = [];
  lines.forEach((line, index) => {
    parts.push(line);
    const last = index === lines.length - 1;
    if (!last || random() < 0.7) parts.push(random() < 0.15 ? crlf : newline);
  });
  return { bytes: concat(parts), lines };
}

const FIXED_QUERIES = [
  "i",
  "k",
  "I",
  "K",
  "ik",
  "ki",
  "kk",
  "istanbul",
  "ISTANBUL",
  "İstanbul",
  "i̇stanbul",
  "needle",
  "  needle  ",
  "x",
  "ß",
  "ss",
  "σ",
  "ς",
  "ı",
  "ǆ",
  "ǅ",
  "kilo",
  "KİLO",
  "hi",
  "ski",
  "taxi",
  "a b",
  '"v":"',
  "null",
  "😀",
  "中",
  "\\n",
  "a\nb",
  "\r",
];

function queriesFor(random: () => number, lines: Uint8Array[]): string[] {
  const queries = [...FIXED_QUERIES];
  const decoder = new TextDecoder();
  for (let i = 0; i < 8 && lines.length > 0; i++) {
    const text = decoder.decode(pick(random, lines));
    if (text.length === 0) continue;
    const from = Math.floor(random() * text.length);
    const length = 1 + Math.floor(random() * 8);
    const slice = text.slice(from, Math.min(text.length, from + length));
    queries.push(slice);
    queries.push(random() < 0.5 ? slice.toUpperCase() : slice.toLowerCase());
  }
  return queries;
}

const OPTION_SETS: RunOptions[] = [
  {},
  { step: 1, batchSize: 1 },
  { step: 3, batchSize: 2, maxMatches: 4 },
  { step: 7, batchSize: 200, maxMatches: 1 },
  { step: 5, batchSize: 3, cancelAfterBatches: 1 },
  { step: 2, batchSize: 1, cancelAfterBatches: 2 },
];

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

test("differential: random and Unicode files, every option set, same batches as the legacy scan", async () => {
  let totalMatches = 0;
  let compared = 0;
  for (let seed = 1; seed <= 160; seed++) {
    const { bytes, lines } = makeFile(seed);
    const random = prng(seed * 7919);
    const source = memoryByteSource(bytes);
    for (const query of queriesFor(random, lines)) {
      const options = OPTION_SETS[(seed + compared) % OPTION_SETS.length];
      const batches = await assertSame(source, query, options, `seed ${seed}`);
      totalMatches += batches.at(-1)?.matches ?? 0;
      compared++;
    }
  }
  assert.ok(compared > 5000, `compared ${compared} searches`);
  assert.ok(totalMatches > 500, `the corpus must produce hits, got ${totalMatches}`);
});

test("differential: every option set on the same hand-written Unicode file", async () => {
  const text = [
    '{"city":"İstanbul"}',
    '{"city":"istanbul"}',
    '{"unit":"K","temp":"Kelvin"}',
    '{"unit":"k"}',
    '{"emoji":"😀 needle 😀"}',
    '{"cjk":"中文 日本語 Needle"}',
    "",
    '{"dotted":"İİİİ"}',
    '{"last":"HI"}',
  ].join("\n");
  const source = memoryByteSource(encoder.encode(text));
  for (const query of [
    "i",
    "k",
    "istanbul",
    "İstanbul",
    "kelvin",
    "needle",
    "hi",
    "HI",
    "😀",
    "中文",
  ]) {
    for (const options of OPTION_SETS) {
      await assertSame(source, query, options, "hand-written");
    }
  }
});

test("Kelvin sign and dotted capital I count as candidates exactly where the real matcher accepts them", async () => {
  // U+212A lowercases to "k"; U+0130 lowercases to "i" + U+0307, so it satisfies a needle only at
  // its LAST character ("i" finds "İ"; "ik" does not find "İk"; "istanbul" does not find "İstanbul").
  const lines = ["K only", "İ only", "xİx", "İk", "ik", "Kilo", "plain"];
  const source = memoryByteSource(encoder.encode(`${lines.join("\n")}\n`));
  const expectations: Record<string, number[]> = {
    k: [0, 3, 4, 5],
    i: [1, 2, 3, 4, 5, 6],
    ik: [4],
    kilo: [5],
    "k only": [0],
  };
  for (const [query, hits] of Object.entries(expectations)) {
    const batches = await assertSame(source, query, {}, "kelvin/dotted");
    const found = batches.flatMap((batch) => batch.entries.map((entry) => entry.index));
    assert.deepEqual(found, hits, `query ${JSON.stringify(query)}`);
  }
});

test("prefilter keeps every line the matcher accepts for every code point that lowercases to ASCII", () => {
  // Every code point whose lowercase form contains an ASCII character. If a future Unicode
  // version adds one, the prefilter has a hole and this test names the code point.
  const carriers: number[] = [];
  for (let cp = 0x80; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    const lower = String.fromCodePoint(cp).toLowerCase();
    for (let k = 0; k < lower.length; k++) {
      if (lower.charCodeAt(k) < 0x80) {
        carriers.push(cp);
        break;
      }
    }
  }
  assert.ok(carriers.length > 0, "at least U+0130 and U+212A are expected");
  const needles = [
    "i",
    "k",
    "ik",
    "ki",
    "kk",
    "ii",
    "a",
    "ai",
    "ka",
    "xk",
    "ix",
    "i̇",
    "1",
    '"',
    " ",
  ];
  for (const cp of carriers) {
    const ch = String.fromCodePoint(cp);
    const lines = [`a${ch}b`, `${ch}`, `${ch}${ch}`, `x${ch}`, `${ch}x`, `k${ch}`, `${ch}i`];
    const bytes = encoder.encode(`${lines.join("\n")}\n`);
    const offsets: number[] = [0];
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) offsets.push(i + 1);
    offsets.pop();
    for (const needle of needles) {
      const compiled = byteNeedle(foldNeedle(needle));
      if (!compiled) continue;
      const candidates = new Set(candidateLines(bytes, offsets, 0, lines.length, 0, compiled));
      lines.forEach((line, index) => {
        if (findCaseInsensitive(line, foldNeedle(needle)) && !candidates.has(index)) {
          assert.fail(
            `U+${cp.toString(16).toUpperCase()} line ${JSON.stringify(line)} matches ` +
              `${JSON.stringify(needle)} but is not a candidate`,
          );
        }
      });
    }
  }
});

test("byteNeedle: only ASCII, newline-free, folded needles get a byte path", () => {
  assert.ok(byteNeedle("needle"));
  assert.ok(byteNeedle('a b"c'));
  assert.equal(byteNeedle("İ"), undefined);
  assert.equal(byteNeedle("i̇"), undefined);
  assert.equal(byteNeedle("中"), undefined);
  assert.equal(byteNeedle("ß"), undefined);
  assert.equal(byteNeedle("a\nb"), undefined);
  assert.equal(byteNeedle(""), undefined);
  assert.equal(byteNeedle("Needle"), undefined, "an unfolded needle would never match anything");
  assert.equal(byteNeedle("k")?.kelvin, true);
  assert.equal(byteNeedle("abc")?.kelvin, false);
  assert.equal(byteNeedle("ai")?.dottedI, true);
  assert.equal(byteNeedle("ia")?.dottedI, false);
});

test("candidateLines: finds ASCII case variants, one entry per line, ascending, bounded by the window", () => {
  const lines = ["no", "Hello WORLD hello", "xx", "HELLO", "none", "hElLo"];
  const bytes = encoder.encode(lines.join("\n"));
  const offsets: number[] = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) offsets.push(i + 1);
  const needle = byteNeedle("hello")!;
  assert.deepEqual(candidateLines(bytes, offsets, 0, lines.length, 0, needle), [1, 3, 5]);

  // A window that starts at line 2: bytes are re-based, lines 0 and 1 are not reported.
  const base = offsets[2];
  assert.deepEqual(
    candidateLines(bytes.subarray(base), offsets, 2, lines.length, base, needle),
    [3, 5],
  );
});

test("candidateLines: a needle longer than 255 bytes still searches correctly", () => {
  const long = "ab".repeat(200);
  const bytes = encoder.encode(`zz\n${long.toUpperCase()}\nab\n${long}x\n`);
  const offsets: number[] = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0a) offsets.push(i + 1);
  offsets.pop();
  assert.deepEqual(candidateLines(bytes, offsets, 0, 4, 0, byteNeedle(long)!), [1, 3]);
});

test("prefilter: a scan decodes only candidate lines, not every line", async () => {
  const total = 3_000;
  const text = Array.from({ length: total }, (_, i) => `{"id":${i},"msg":"row ${i}"}`).join("\n");
  const file = await JsonlFile.open(memoryByteSource(encoder.encode(text)));
  const descriptor = Object.getOwnPropertyDescriptor(TextDecoder.prototype, "decode")!;
  const originalDecode = descriptor.value as typeof TextDecoder.prototype.decode;
  let decoded = 0;
  Object.defineProperty(TextDecoder.prototype, "decode", {
    ...descriptor,
    value: function (this: TextDecoder, ...args: Parameters<typeof TextDecoder.prototype.decode>) {
      decoded++;
      return originalDecode.call(this, ...args);
    },
  });
  let batches: JsonlSearchBatch[];
  try {
    batches = await run(productionRunner, file, "ROW 2999");
  } finally {
    Object.defineProperty(TextDecoder.prototype, "decode", descriptor);
  }
  assert.equal(batches.at(-1)?.matches, 1);
  assert.equal(batches.at(-1)?.scanned, total);
  // One candidate line, plus the summary's own parse of that line: nowhere near 3,000.
  assert.ok(decoded < 10, `${decoded} decode calls for a one-hit scan of ${total} lines`);
});

test("a source that returns fewer bytes than the index promised falls back to the legacy path", async () => {
  const text = '{"a":"needle"}\n{"a":"other"}\n{"a":"Needle again"}\n{"a":"tail"}\n';
  const bytes = encoder.encode(text);
  const inner = memoryByteSource(bytes);
  let shrink = false;
  const flaky: ByteSource = {
    size: inner.size,
    async read(offset, length) {
      const data = await inner.read(offset, length);
      // After indexing, hand back a file that lost its tail (it changed on disk).
      return shrink ? data.subarray(0, Math.max(0, data.length - 12)) : data;
    },
  };
  const file = await JsonlFile.open(flaky);
  shrink = true;
  const expected = await run(legacySearch, file, "needle", { step: 2 });
  const actual = await run(productionRunner, file, "needle", { step: 2 });
  assert.deepEqual(actual, expected);
  assert.ok(actual.length > 0);
});

test("a source that throws ends the scan the same way as before", async () => {
  const bytes = encoder.encode('{"a":1}\n{"a":2}\n{"a":3}\n');
  const inner = memoryByteSource(bytes);
  let reads = 0;
  const failing: ByteSource = {
    size: inner.size,
    async read(offset, length) {
      if (++reads > 1) throw new Error("disk gone");
      return inner.read(offset, length);
    },
  };
  for (const runner of [legacySearch, productionRunner]) {
    reads = 0;
    const file = await JsonlFile.open(failing);
    reads = 1; // the index pass is done; the next read (the first search step) throws
    const batches = await run(runner, file, "zzz", { step: 1 });
    assert.equal(batches.length, 1);
    assert.equal(batches[0].done, true);
    assert.equal(batches[0].scanned, 0);
  }
});

test("lines larger than the byte budget are scanned in several steps with identical output", async () => {
  const big = 5 * 1024 * 1024;
  const filler = "x".repeat(big);
  const text = `{"a":"${filler}"}\n{"a":"${filler}NEEDLE"}\n{"a":"${filler}"}\n{"b":"needle"}\n`;
  assert.ok(big * 2 > JSONL_SEARCH_BYTE_BUDGET, "two big lines exceed the 8 MiB window budget");
  const batches = await assertSame(memoryByteSource(encoder.encode(text)), "needle", {}, "budget");
  assert.deepEqual(
    batches.flatMap((batch) => batch.entries.map((entry) => entry.index)),
    [1, 3],
  );
  assert.ok(batches.length >= 2, "the scan must span more than one step");
});

test("hit cap, batch size and scanned progress match the legacy scan on a dense file", async () => {
  const text = Array.from(
    { length: 500 },
    (_, i) => `{"i":${i},"k":"${i % 2 ? "Match" : "other"}"}`,
  ).join("\n");
  const source = memoryByteSource(encoder.encode(text));
  for (const options of [
    { maxMatches: 10, batchSize: 3, step: 25 },
    { maxMatches: 250, batchSize: 200, step: 20_000 },
    { maxMatches: 1000, batchSize: 7, step: 100 },
  ]) {
    const batches = await assertSame(source, "match", options, "dense");
    const last = batches.at(-1)!;
    assert.equal(last.done, true);
    assert.equal(last.capped, options.maxMatches <= 250);
  }
});
