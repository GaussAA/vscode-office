import assert from "node:assert/strict";
import test from "node:test";
import { detailKeyAction, type DetailKeyInput } from "@/react/view/entry/entryKeys";

const base: DetailKeyInput = {
  key: "",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  defaultPrevented: false,
  onControl: false,
  nativeText: false,
  hasSelection: true,
  panelOpen: false,
  hasActiveKey: true,
};

const input = (overrides: Partial<DetailKeyInput>): DetailKeyInput => ({ ...base, ...overrides });

test("keymap: Escape closes an open panel before any control guard", () => {
  assert.deepEqual(
    detailKeyAction(
      input({ key: "Escape", panelOpen: true, onControl: true, defaultPrevented: true }),
    ),
    { type: "close-panel" },
  );
  // Escape with the panel closed is not an action of ours.
  assert.deepEqual(detailKeyAction(input({ key: "Escape" })), { type: "ignore" });
});

test("keymap: a key rc-tree already consumed is ignored", () => {
  assert.deepEqual(detailKeyAction(input({ key: "Enter", defaultPrevented: true })), {
    type: "ignore",
  });
  assert.deepEqual(detailKeyAction(input({ key: "c", ctrlKey: true, defaultPrevented: true })), {
    type: "ignore",
  });
});

test("keymap: Ctrl/Cmd+C copies the value; Shift adds the path", () => {
  assert.deepEqual(detailKeyAction(input({ key: "c", ctrlKey: true })), {
    type: "copy",
    target: "value",
  });
  assert.deepEqual(detailKeyAction(input({ key: "C", metaKey: true })), {
    type: "copy",
    target: "value",
  });
  assert.deepEqual(detailKeyAction(input({ key: "c", ctrlKey: true, shiftKey: true })), {
    type: "copy",
    target: "path",
  });
  // Copy stays ahead of the control guard: the value toggle is a button.
  assert.deepEqual(detailKeyAction(input({ key: "c", ctrlKey: true, onControl: true })), {
    type: "copy",
    target: "value",
  });
  // Native text selection keeps the browser's copy.
  assert.deepEqual(
    detailKeyAction(input({ key: "c", ctrlKey: true, nativeText: true, onControl: true })),
    { type: "ignore" },
  );
});

test("keymap: Enter toggles the panel only on the tree, not on a control", () => {
  assert.deepEqual(detailKeyAction(input({ key: "Enter" })), { type: "toggle-panel" });
  assert.deepEqual(detailKeyAction(input({ key: "Enter", onControl: true })), { type: "ignore" });
  assert.deepEqual(detailKeyAction(input({ key: "Enter", hasSelection: false })), {
    type: "ignore",
  });
});

test("keymap: arrows and Space expand/collapse the active row", () => {
  assert.deepEqual(detailKeyAction(input({ key: "ArrowRight" })), { type: "expand" });
  assert.deepEqual(detailKeyAction(input({ key: "ArrowLeft" })), { type: "collapse" });
  assert.deepEqual(detailKeyAction(input({ key: " " })), { type: "toggle-expand" });
  assert.deepEqual(detailKeyAction(input({ key: "Spacebar" })), { type: "toggle-expand" });
  assert.deepEqual(detailKeyAction(input({ key: "ArrowRight", hasActiveKey: false })), {
    type: "ignore",
  });
});

test("keymap: unknown keys and plain typing are ignored", () => {
  assert.deepEqual(detailKeyAction(input({ key: "a" })), { type: "ignore" });
  assert.deepEqual(detailKeyAction(input({ key: "Tab" })), { type: "ignore" });
});
