import assert from "node:assert/strict";
import test from "node:test";
import { bytesToSavePayload, saveContentToBytes } from "@/common/saveContent";

/**
 * A wrong answer here writes the wrong bytes to disk — the only place in the fork where a bug
 * is silent *and* destructive. The legacy shapes are pinned too: an older webview can still be
 * alive when the host upgrades, and its save must not be dropped.
 */

test("save: base64 round-trips a workbook", () => {
  const bytes = Uint8Array.from({ length: 1024 }, (_, index) => (index * 7) % 256);

  const payload = bytesToSavePayload(bytes, "xlsx");

  assert.equal(payload.ext, "xlsx");
  assert.deepEqual([...saveContentToBytes(payload)], [...bytes]);
});

test("save: no ext when the viewer saves in place", () => {
  const payload = bytesToSavePayload(Uint8Array.from([1, 2, 3]));

  assert.equal(payload.ext, undefined);
});

test("save: a legacy number array still saves", () => {
  assert.deepEqual([...saveContentToBytes([0, 255, 7])], [0, 255, 7]);
});

test("save: a legacy text payload still saves", () => {
  assert.equal(new TextDecoder().decode(saveContentToBytes("a,b\n1,2\n")), "a,b\n1,2\n");
});
