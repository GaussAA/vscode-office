import assert from "node:assert/strict";
import test from "node:test";
import { CellLoadGuard } from "@/react/view/excel/cellLoadGuard";

/**
 * Cell selection race: "select A → read A → select B → A's result must not overwrite B".
 * The guard combines RequestGuard's sequence numbers with position checks.
 */

test("cell load: a late read for the previous selection is dropped", () => {
  const guard = new CellLoadGuard();
  const requestA = guard.issueLoad(0, 0);
  const requestB = guard.issueLoad(1, 1);
  // A's read completes late: it must not overwrite B
  assert.equal(guard.shouldApply(requestA, { row: 1, col: 1 }), false);
  assert.equal(guard.shouldApply(requestB, { row: 1, col: 1 }), true);
});

test("cell load: the latest request lands when its position matches", () => {
  const guard = new CellLoadGuard();
  const request = guard.issueLoad(5, 3);
  assert.equal(guard.shouldApply(request, { row: 5, col: 3 }), true);
});

test("cell load: a position mismatch rejects the result even for the current id", () => {
  const guard = new CellLoadGuard();
  const request = guard.issueLoad(2, 4);
  // User moved to a different cell before the read completed
  assert.equal(guard.shouldApply(request, { row: 2, col: 5 }), false);
  assert.equal(guard.shouldApply(request, { row: 3, col: 4 }), false);
});

test("cell load: null current selection rejects any result", () => {
  const guard = new CellLoadGuard();
  const request = guard.issueLoad(0, 0);
  assert.equal(guard.shouldApply(request, null), false);
});

test("cell load: cancel makes every issued request stale", () => {
  const guard = new CellLoadGuard();
  const request = guard.issueLoad(1, 2);
  guard.cancel();
  assert.equal(guard.shouldApply(request, { row: 1, col: 2 }), false);
});

test("cell load: rapid selection of the same cell twice, first read is stale", () => {
  const guard = new CellLoadGuard();
  const first = guard.issueLoad(0, 0);
  const second = guard.issueLoad(0, 0);
  // First read completes late: its id is old, even though the position matches
  assert.equal(guard.shouldApply(first, { row: 0, col: 0 }), false);
  assert.equal(guard.shouldApply(second, { row: 0, col: 0 }), true);
});

test("cell load: document change cancels, old id cannot match new request", () => {
  const guard = new CellLoadGuard();
  const oldRequest = guard.issueLoad(10, 5);
  guard.cancel(); // document changed
  const newRequest = guard.issueLoad(10, 5);
  assert.notEqual(newRequest.id, oldRequest.id);
  assert.equal(guard.shouldApply(oldRequest, { row: 10, col: 5 }), false);
  assert.equal(guard.shouldApply(newRequest, { row: 10, col: 5 }), true);
});

const scenarios: Array<{
  name: string;
  steps: (guard: CellLoadGuard) => boolean;
}> = [
  {
    name: "A→B→C, A's result arrives last",
    steps: (guard) => {
      const a = guard.issueLoad(0, 0);
      guard.issueLoad(1, 1);
      const c = guard.issueLoad(2, 2);
      // A's read completes after C is selected
      const applied = guard.shouldApply(a, { row: 2, col: 2 });
      return !applied && guard.shouldApply(c, { row: 2, col: 2 });
    },
  },
  {
    name: "select→cancel→select same cell, first load is stale",
    steps: (guard) => {
      const first = guard.issueLoad(5, 3);
      guard.cancel();
      const second = guard.issueLoad(5, 3);
      return (
        !guard.shouldApply(first, { row: 5, col: 3 }) &&
        guard.shouldApply(second, { row: 5, col: 3 })
      );
    },
  },
  {
    name: "select A, read A, user moves away before result arrives",
    steps: (guard) => {
      const a = guard.issueLoad(1, 1);
      guard.issueLoad(2, 2); // user moved
      return !guard.shouldApply(a, { row: 2, col: 2 });
    },
  },
];

for (const scenario of scenarios) {
  test(`cell load scenario: ${scenario.name}`, () => {
    assert.equal(scenario.steps(new CellLoadGuard()), true);
  });
}
