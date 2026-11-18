import assert from "node:assert/strict";
import test from "node:test";
import { indexPercent, createProgressReporter } from "@/common/jsonlIndexProgress";

test("indexPercent: clamps to 0-99, never 100", () => {
  assert.equal(indexPercent(0, 100), 0);
  assert.equal(indexPercent(50, 100), 50);
  assert.equal(indexPercent(99, 100), 99);
  assert.equal(indexPercent(100, 100), 99, "100% is reserved for completion");
  assert.equal(indexPercent(101, 100), 99, "over-read is clamped");
});

test("indexPercent: guards against non-finite or negative values", () => {
  assert.equal(indexPercent(NaN, 100), 0);
  assert.equal(indexPercent(50, NaN), 0);
  assert.equal(indexPercent(50, 0), 0);
  assert.equal(indexPercent(-10, 100), 0);
});

test("reporter: delays first emission until showAfterMs", () => {
  let time = 0;
  const emitted: number[] = [];
  const r = createProgressReporter({
    onProgress: (p) => emitted.push(indexPercent(p.loaded, p.total)),
    showAfterMs: 200,
    minIntervalMs: 50,
    now: () => time,
  });

  r.report(10, 100);
  time = 100;
  r.report(20, 100);
  assert.deepEqual(emitted, [], "no emission before showAfterMs");

  time = 250;
  r.report(30, 100);
  assert.deepEqual(emitted, [30], "first emission after threshold");
});

test("reporter: first emission bypasses minIntervalMs if needed", () => {
  let time = 0;
  const emitted: number[] = [];
  const r = createProgressReporter({
    onProgress: (p) => emitted.push(indexPercent(p.loaded, p.total)),
    showAfterMs: 100,
    minIntervalMs: 200, // Longer than showAfterMs.
    now: () => time,
  });

  time = 150; // Past showAfterMs=100 but under minIntervalMs=200.
  r.report(10, 100);
  assert.deepEqual(emitted, [10], "first emit doesn't wait for minIntervalMs");
});

test("reporter: throttles by minIntervalMs and percent change", () => {
  let time = 0;
  const emitted: number[] = [];
  const r = createProgressReporter({
    onProgress: (p) => emitted.push(indexPercent(p.loaded, p.total)),
    showAfterMs: 200,
    minIntervalMs: 100,
    now: () => time,
  });

  time = 500; // Past the showAfterMs threshold.
  r.report(10, 100);
  assert.deepEqual(emitted, [10]);

  time = 550; // Only 50ms later, under the interval.
  r.report(20, 100);
  assert.deepEqual(emitted, [10], "suppressed by minIntervalMs");

  time = 650; // 150ms since last emit, but percent didn't change.
  r.report(10, 100);
  assert.deepEqual(emitted, [10], "suppressed by unchanged percent");

  time = 650;
  r.report(25, 100);
  assert.deepEqual(emitted, [10, 25], "interval passed and percent increased");
});

test("reporter: stop() silences all future emissions", () => {
  let time = 0;
  const emitted: number[] = [];
  const r = createProgressReporter({
    onProgress: (p) => emitted.push(indexPercent(p.loaded, p.total)),
    showAfterMs: 0,
    minIntervalMs: 50,
    now: () => time,
  });

  time = 100; // Advance past creation.
  r.report(10, 100);
  assert.equal(emitted.length, 1);
  assert.equal(r.stopped, false);

  r.stop();
  assert.equal(r.stopped, true);

  time = 600;
  r.report(50, 100);
  assert.equal(emitted.length, 1, "no emission after stop");
});

test("reporter: ignores non-finite or zero-total reports", () => {
  const emitted: number[] = [];
  const r = createProgressReporter({
    onProgress: (p) => emitted.push(indexPercent(p.loaded, p.total)),
    showAfterMs: 0,
    minIntervalMs: 0,
    now: () => 0,
  });

  r.report(NaN, 100);
  r.report(50, NaN);
  r.report(50, 0);
  assert.deepEqual(emitted, [], "all invalid reports ignored");

  r.report(10, 100);
  assert.deepEqual(emitted, [10], "valid report accepted");
});
