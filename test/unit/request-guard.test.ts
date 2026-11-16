import assert from "node:assert/strict";
import test from "node:test";
import { PendingRequests, RequestGuard } from "@/react/util/requestGuard";

/**
 * The guard is the webview half of "ask the host, hear the answer late". These tests replay the
 * message orders the views actually produce: a reply that arrives after a newer request, after
 * the document changed, or twice.
 */

test("guard: ids start at 1 and only grow", () => {
  const guard = new RequestGuard();
  assert.deepEqual([guard.issue(), guard.issue(), guard.issue()], [1, 2, 3]);
});

test("guard: nothing is current before the first request", () => {
  const guard = new RequestGuard();
  assert.equal(guard.isCurrent(0), false, "id 0 must not match a guard that never issued");
  assert.equal(guard.isCurrent(1), false);
});

test("guard: only the newest request is current, an older reply is dropped", () => {
  const guard = new RequestGuard();
  const first = guard.issue();
  const second = guard.issue();
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
});

test("guard: isCurrent does not consume, a streamed reply keeps matching", () => {
  const guard = new RequestGuard();
  const id = guard.issue();
  assert.equal(guard.isCurrent(id), true);
  assert.equal(guard.isCurrent(id), true);
  guard.settle(id);
  assert.equal(guard.isCurrent(id), true, "a late duplicate of the final batch is still ours");
});

test("guard: cancel makes every issued reply stale", () => {
  const guard = new RequestGuard();
  const id = guard.issue();
  guard.cancel();
  assert.equal(guard.isCurrent(id), false);
});

test("guard: a cancelled id is never handed out again", () => {
  const guard = new RequestGuard();
  const first = guard.issue();
  guard.cancel();
  const second = guard.issue();
  assert.notEqual(second, first);
  assert.equal(guard.isCurrent(first), false, "the old reply must not match the new request");
  assert.equal(guard.isCurrent(second), true);
});

const cancelScenarios: Array<{
  name: string;
  steps: (guard: RequestGuard) => number | null;
  expected: number | null;
}> = [
  { name: "never issued", steps: (guard) => guard.cancel(), expected: null },
  {
    name: "issued and unanswered: the host is still working",
    steps: (guard) => {
      guard.issue();
      return guard.cancel();
    },
    expected: 1,
  },
  {
    name: "issued twice: only the newest is on the host's mind",
    steps: (guard) => {
      guard.issue();
      guard.issue();
      return guard.cancel();
    },
    expected: 2,
  },
  {
    name: "final batch seen: nothing left to stop",
    steps: (guard) => {
      const id = guard.issue();
      guard.settle(id);
      return guard.cancel();
    },
    expected: null,
  },
  {
    name: "cancelled twice: the second cancel has nothing to report",
    steps: (guard) => {
      guard.issue();
      guard.cancel();
      return guard.cancel();
    },
    expected: null,
  },
  {
    name: "a stale settle must not hide the live request",
    steps: (guard) => {
      const first = guard.issue();
      guard.issue();
      assert.equal(guard.settle(first), false);
      return guard.cancel();
    },
    expected: 2,
  },
  {
    name: "reissued after a cancel: the new request is cancellable again",
    steps: (guard) => {
      guard.issue();
      guard.cancel();
      guard.issue();
      return guard.cancel();
    },
    expected: 2,
  },
];

for (const scenario of cancelScenarios) {
  test(`guard: cancel() reports what the host must stop: ${scenario.name}`, () => {
    assert.equal(scenario.steps(new RequestGuard()), scenario.expected);
  });
}

test("guard: settle only accepts the current request", () => {
  const guard = new RequestGuard();
  const first = guard.issue();
  const second = guard.issue();
  assert.equal(guard.settle(first), false);
  assert.equal(guard.settle(second), true);
  guard.cancel();
  assert.equal(guard.settle(second), false, "a cancelled request cannot be settled");
});

/**
 * Search, as the views drive it: typing issues, a new term cancels the old scan first, and the
 * view tells the host only when the guard says a scan was running.
 */
test("guard: search typing sends one cancel per scan that was really running", () => {
  const guard = new RequestGuard();
  const sent: number[] = [];
  const startSearch = () => {
    const stale = guard.cancel();
    if (stale !== null) sent.push(stale);
    return guard.issue();
  };

  const a = startSearch(); // 1, nothing to cancel
  const b = startSearch(); // cancels 1
  guard.settle(b); // scan 2 finished
  const c = startSearch(); // 2 already done: no cancel
  const d = startSearch(); // cancels 3

  assert.deepEqual([a, b, c, d], [1, 2, 3, 4]);
  assert.deepEqual(sent, [1, 3]);
  assert.equal(guard.isCurrent(a), false);
  assert.equal(guard.isCurrent(c), false);
  assert.equal(guard.isCurrent(d), true);
});

test("guard: leaving search mode rejects a batch that is already on the wire", () => {
  const guard = new RequestGuard();
  const id = guard.issue();
  const stale = guard.cancel();
  assert.equal(stale, id, "the host is told to stop");
  assert.equal(guard.isCurrent(id), false, "the late batch must not append or auto-select");
});

/**
 * Parquet profile + column scan across a document switch. `loadParquet` used to reset neither
 * the scan counter nor the panel, so a scan reply from the previous file still carried the id
 * the view was waiting for and was painted onto the new file.
 */
test("document switch: a scan reply from the previous file does not land on the new one", () => {
  const profile = new RequestGuard();
  const scan = new RequestGuard();

  // File A opens, its profile arrives, the reader opens a column and a scan starts.
  const profileA = profile.issue();
  assert.equal(profile.isCurrent(profileA), true);
  const scanA = scan.issue();

  // File B is opened before the scan answers: loadParquet drops everything A asked for.
  profile.cancel();
  scan.cancel();

  // A's replies arrive late. Neither may be applied.
  assert.equal(scan.isCurrent(scanA), false, "the scan of file A is stale");
  assert.equal(profile.isCurrent(profileA), false, "the profile of file A is stale");

  // B asks its own questions; A's ids can never match them.
  const profileB = profile.issue();
  const scanB = scan.issue();
  assert.notEqual(profileB, profileA);
  assert.notEqual(scanB, scanA);
  assert.equal(profile.isCurrent(profileA), false);
  assert.equal(scan.isCurrent(scanA), false);
  assert.equal(scan.isCurrent(scanB), true);
});

test("document switch: a guard nobody cancelled still accepts the old reply", () => {
  // The guard cannot see a document change. This is the contract the view must honour, and the
  // reason `loadParquet` calls cancel(): until someone does, the old id is the current one.
  const scan = new RequestGuard();
  const scanA = scan.issue();
  assert.equal(scan.isCurrent(scanA), true);
  scan.cancel();
  assert.equal(scan.isCurrent(scanA), false);
});

test("document switch: closing the panel stops the scan, opening another column replaces it", () => {
  const scan = new RequestGuard();
  const columnA = scan.issue();
  assert.equal(scan.cancel(), columnA, "close while scanning");
  assert.equal(scan.isCurrent(columnA), false);

  const columnB = scan.issue();
  scan.cancel(); // opening a column without statistics issues no scan but must drop B's
  assert.equal(scan.isCurrent(columnB), false);
});

test("compare: a reload replaces the pending question, the first answer is for id 1", () => {
  const compare = new RequestGuard();
  const first = compare.issue();
  assert.equal(first, 1);
  assert.equal(compare.isCurrent(first), true);
  const reload = compare.issue();
  assert.equal(compare.isCurrent(first), false);
  assert.equal(compare.isCurrent(reload), true);
});

test("pending: a reply is claimed once and carries its tag", () => {
  const pending = new PendingRequests<"replace" | "append">();
  const id = pending.issue("append");
  assert.deepEqual(pending.take(id), { tag: "append", newest: true });
  assert.equal(pending.take(id), undefined, "a duplicate reply has nobody waiting");
});

test("pending: an unknown id is nobody's reply", () => {
  const pending = new PendingRequests<string>();
  assert.equal(pending.take(0), undefined);
  assert.equal(pending.take(7), undefined);
});

test("pending: several requests stay claimable, only the last one is newest", () => {
  const pending = new PendingRequests<string>();
  const first = pending.issue("append");
  const second = pending.issue("replace");

  assert.deepEqual(pending.take(first), { tag: "append", newest: false });
  assert.deepEqual(pending.take(second), { tag: "replace", newest: true });
});

test("pending: replies may arrive in any order", () => {
  const pending = new PendingRequests<number>();
  const ids = [pending.issue(10), pending.issue(20), pending.issue(30)];
  assert.deepEqual(pending.take(ids[2])?.newest, true);
  assert.deepEqual(pending.take(ids[0]), { tag: 10, newest: false });
  assert.deepEqual(pending.take(ids[1]), { tag: 20, newest: false });
});

test("pending: clear drops every request in flight, new ones still work", () => {
  const pending = new PendingRequests<string>();
  const old = pending.issue("replace");
  pending.clear();
  assert.equal(pending.take(old), undefined, "the old document's window is not wanted");

  const fresh = pending.issue("replace");
  assert.notEqual(fresh, old);
  assert.deepEqual(pending.take(fresh), { tag: "replace", newest: true });
});

test("pending: a request issued before clear() is not the newest of the next document", () => {
  const pending = new PendingRequests();
  const old = pending.issue(undefined);
  pending.clear();
  const fresh = pending.issue(undefined);
  assert.equal(pending.take(old), undefined);
  assert.equal(pending.take(fresh)?.newest, true);
});

test("replay: a reload re-asks with a new id and the previous answer is dropped", () => {
  // JSONL reload: the host re-sends `jsonlInfo`, the view re-requests the window and the entry.
  const ranges = new PendingRequests<"replace" | "append">();
  const entry = new RequestGuard();

  const firstRange = ranges.issue("replace");
  const firstEntry = entry.issue();

  ranges.clear(); // new bytes: the old windows are not wanted
  const secondRange = ranges.issue("replace");
  const secondEntry = entry.issue();

  assert.equal(ranges.take(firstRange), undefined);
  assert.equal(entry.isCurrent(firstEntry), false);
  assert.deepEqual(ranges.take(secondRange), { tag: "replace", newest: true });
  assert.equal(entry.isCurrent(secondEntry), true);
});
