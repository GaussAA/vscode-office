/**
 * JSON array search: progress, step, character budget and cancellation.
 *
 * `scanned` used to be `floor(processedRecords / records.length * text.length)`: a ratio of
 * record counts, not a position, and `0 / 0 = NaN` for an empty array. `step` was ignored
 * (a fixed 1000), and a turn had no size budget, so a few huge records could block the host.
 * These tests drive the adapter with a manual scheduler, so every turn is observable.
 */
import { strict as assert } from "node:assert";
import test from "node:test";
import { JSON_SEARCH_CHAR_BUDGET, type JsonSearchBatch } from "@/common/jsonPreviewTypes";
import { jsonArrayAdapter } from "@/service/jsonArrayAdapter";
import { indexJsonArray } from "@/service/jsonPreview";
import { createCancelToken, type CancelToken } from "@/service/recordAddressableDocument";

interface Run {
  batches: JsonSearchBatch[];
  /** Turns the scheduler was asked to run. */
  turns: number;
}

/**
 * Search with a manual scheduler. `afterBatch` runs right after each batch is delivered and may
 * cancel; the queue is then drained to prove nothing else is sent.
 */
function search(
  text: string,
  query: string,
  options: { step?: number; batchSize?: number; token?: CancelToken; afterBatch?: () => void } = {},
): Run {
  const adapter = jsonArrayAdapter(text, indexJsonArray(text));
  const queue: Array<() => void> = [];
  const run: Run = { batches: [], turns: 0 };
  adapter.search(
    1,
    query,
    {
      step: options.step,
      batchSize: options.batchSize,
      schedule: (next) => queue.push(next),
      onBatch: (batch) => {
        run.batches.push(batch);
        options.afterBatch?.();
      },
    },
    options.token ?? createCancelToken(),
  );
  while (queue.length > 0) {
    run.turns++;
    (queue.shift() as () => void)();
  }
  return run;
}

const numbered = (count: number) =>
  `[${Array.from({ length: count }, (_, i) => `{"id":${i}}`).join(",")}]`;

test("progress: an empty array finishes with scanned equal to the text length, never NaN", () => {
  for (const text of ["[]", "  [ ]  "]) {
    const { batches } = search(text, "x");
    assert.equal(batches.length, 1);
    assert.equal(batches[0].done, true);
    assert.ok(Number.isFinite(batches[0].scanned), "scanned is a finite number");
    assert.equal(batches[0].scanned, text.length);
    assert.equal(batches[0].total, text.length);
  }
});

test("progress: scanned is the character offset reached, not a ratio of record counts", () => {
  // Record 0 is huge, records 1..3 are tiny: after one record a ratio says 25%, the position
  // says almost everything.
  const huge = "x".repeat(10_000);
  const text = `["${huge}","a","b","c"]`;
  const records = indexJsonArray(text);
  const { batches } = search(text, "nomatch", { step: 1 });

  assert.equal(batches[0].scanned, records[0].end, "after one record: the end of that record");
  assert.ok(batches[0].scanned > text.length * 0.9, "…which is nearly the whole text, not 25%");
  assert.equal(batches.at(-1)?.scanned, text.length, "the last batch reports the full text");
});

test("progress: a turn with no match still reports where the scan is", () => {
  const { batches } = search(numbered(2500), "nomatch", { step: 1000 });
  assert.equal(batches.length, 3, "three turns, three batches, even with nothing to show");
  assert.deepEqual(
    batches.map((batch) => batch.done),
    [false, false, true],
  );
  assert.ok(batches.every((batch) => batch.records.length === 0));
});

test("progress: scanned never decreases and ends on text.length", () => {
  const text = numbered(5000);
  const { batches } = search(text, "nomatch", { step: 700 });
  assert.ok(batches.length > 2, "several turns");
  for (let i = 1; i < batches.length; i++) {
    assert.ok(
      batches[i].scanned >= batches[i - 1].scanned,
      `batch ${i}: ${batches[i].scanned} < ${batches[i - 1].scanned}`,
    );
  }
  assert.ok(batches.every((batch) => batch.scanned <= batch.total));
  assert.equal(batches.at(-1)?.scanned, text.length);
  assert.equal(batches.at(-1)?.total, text.length);
});

test("step: the option sets how many records one turn scans", () => {
  const text = numbered(2000);
  assert.equal(search(text, "nomatch", { step: 100 }).batches.length, 20);
  assert.equal(search(text, "nomatch", { step: 500 }).batches.length, 4);
  assert.equal(search(text, "nomatch", { step: 5000 }).batches.length, 1);
});

test("budget: huge records are split across turns by characters, not only by count", () => {
  // Each record is a quarter of the budget, so a turn can take about four of them even though
  // `step` allows far more. Twenty records therefore need several turns.
  const piece = "y".repeat(Math.floor(JSON_SEARCH_CHAR_BUDGET / 4));
  const text = `[${Array.from({ length: 20 }, () => `"${piece}"`).join(",")}]`;
  const records = indexJsonArray(text);
  const { batches } = search(text, "nomatch", { step: 100_000 });

  assert.ok(batches.length >= 4, `expected several turns, got ${batches.length}`);
  let previous = 0;
  for (const batch of batches) {
    // One turn never reads more than the budget plus the one record that crossed it.
    assert.ok(
      batch.scanned - previous <= JSON_SEARCH_CHAR_BUDGET + (records[0].end - records[0].start),
      `a turn scanned ${batch.scanned - previous} characters`,
    );
    previous = batch.scanned;
  }
});

test("budget: a single record larger than the budget still makes progress", () => {
  const text = `["${"z".repeat(JSON_SEARCH_CHAR_BUDGET * 2)}","tail"]`;
  const { batches } = search(text, "tail");
  assert.equal(batches.at(-1)?.done, true);
  assert.deepEqual(
    batches.flatMap((batch) => batch.records.map((record) => record.index)),
    [1],
  );
});

test("cancel: after cancelling inside a batch, no further batch is sent", () => {
  const token = createCancelToken();
  const { batches, turns } = search(numbered(5000), "nomatch", {
    step: 500,
    token,
    afterBatch: () => token.cancel(),
  });
  assert.equal(batches.length, 1, "only the batch that was being delivered");
  assert.equal(batches[0].done, false);
  assert.ok(turns >= 1);
});

test("cancel: cancelling before the first turn sends nothing at all", () => {
  const token = createCancelToken();
  token.cancel();
  const { batches } = search(numbered(100), "id", { token });
  assert.equal(batches.length, 0);
});

test("cancel: cancelling mid-record-loop does not flush a partial final batch", () => {
  const token = createCancelToken();
  let delivered = 0;
  const { batches } = search(numbered(3000), "id", {
    step: 1000,
    batchSize: 100,
    token,
    afterBatch: () => {
      delivered++;
      if (delivered === 2) token.cancel();
    },
  });
  assert.equal(batches.length, 2, "nothing after the batch that cancelled");
  assert.ok(batches.every((batch) => !batch.done));
});

test("matches: results are unchanged by the new turn accounting", () => {
  const text = '[{"m":"alpha"},{"m":"beta"},{"m":"Alpha alpha"},{"m":"gamma"}]';
  const { batches } = search(text, "alpha", { step: 1 });
  const records = batches.flatMap((batch) => batch.records);
  assert.deepEqual(
    records.map((record) => [record.index, record.count]),
    [
      [0, 1],
      [2, 2],
    ],
  );
  assert.equal(batches.at(-1)?.matches, 3);
  assert.equal(batches.at(-1)?.done, true);
});
