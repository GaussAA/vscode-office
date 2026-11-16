import { test } from "node:test";
import assert from "node:assert/strict";
import { dirtyTransition, type DirtyContext } from "@/react/view/excel/excelSession";

/**
 * Test the real dirty-state machine from ExcelSession, not a copy.
 * States: clean, dirty, pending-save
 * Events: edit, saveRequested, saveDone, opened
 */

test("dirty state: clean → edit → dirty, enables save and notifies host", () => {
  const [next, effect] = dirtyTransition({ state: "clean", readOnly: false }, { type: "edit" });
  assert.equal(next.state, "dirty");
  assert.equal(effect.saveEnabled, true);
  assert.equal(effect.notifyHost, "dirty");
});

test("dirty state: dirty → edit → dirty, no notification", () => {
  const [next, effect] = dirtyTransition({ state: "dirty", readOnly: false }, { type: "edit" });
  assert.equal(next.state, "dirty");
  assert.equal(effect.saveEnabled, true);
  assert.equal(effect.notifyHost, null);
});

test("dirty state: clean → saveRequested → pending-save, disables save", () => {
  const [next, effect] = dirtyTransition(
    { state: "clean", readOnly: false },
    { type: "saveRequested" },
  );
  assert.equal(next.state, "pending-save");
  assert.equal(effect.saveEnabled, false);
  assert.equal(effect.notifyHost, null);
});

test("dirty state: dirty → saveRequested → pending-save", () => {
  const [next, effect] = dirtyTransition(
    { state: "dirty", readOnly: false },
    { type: "saveRequested" },
  );
  assert.equal(next.state, "pending-save");
  assert.equal(effect.saveEnabled, false);
});

test("dirty state: pending-save → saveDone → clean, notifies host clean", () => {
  const [next, effect] = dirtyTransition(
    { state: "pending-save", readOnly: false },
    { type: "saveDone" },
  );
  assert.equal(next.state, "clean");
  assert.equal(effect.saveEnabled, false);
  assert.equal(effect.notifyHost, "clean");
});

test("dirty state: edit during pending-save → dirty, then saveDone stays dirty and re-notifies", () => {
  let ctx: DirtyContext = { state: "clean", readOnly: false };
  let effect;

  // clean → edit → dirty
  [ctx, effect] = dirtyTransition(ctx, { type: "edit" });
  assert.equal(ctx.state, "dirty");

  // dirty → saveRequested → pending-save
  [ctx, effect] = dirtyTransition(ctx, { type: "saveRequested" });
  assert.equal(ctx.state, "pending-save");

  // pending-save → edit → dirty, MUST notify host so editVersion increments
  [ctx, effect] = dirtyTransition(ctx, { type: "edit" });
  assert.equal(ctx.state, "dirty");
  assert.equal(effect.saveEnabled, true);
  assert.equal(effect.notifyHost, "dirty", "edit during save must notify host");

  // dirty → saveDone → stays dirty, re-notifies host
  [ctx, effect] = dirtyTransition(ctx, { type: "saveDone" });
  assert.equal(ctx.state, "dirty");
  assert.equal(effect.saveEnabled, true);
  assert.equal(effect.notifyHost, "dirty");
});

test("dirty state: spurious saveDone on clean is ignored", () => {
  const [next, effect] = dirtyTransition({ state: "clean", readOnly: false }, { type: "saveDone" });
  assert.equal(next.state, "clean");
  assert.equal(effect.saveEnabled, false);
  assert.equal(effect.notifyHost, null);
});

test("dirty state: readOnly edit is ignored", () => {
  const [next, effect] = dirtyTransition({ state: "clean", readOnly: true }, { type: "edit" });
  assert.equal(next.state, "clean");
  assert.equal(effect.saveEnabled, false);
  assert.equal(effect.notifyHost, null);
});

test("dirty state: readOnly saveRequested is ignored", () => {
  const [next, effect] = dirtyTransition(
    { state: "dirty", readOnly: true },
    { type: "saveRequested" },
  );
  assert.equal(next.state, "dirty");
  assert.equal(effect.saveEnabled, false);
  assert.equal(effect.notifyHost, null);
});

test("dirty state: opened resets to clean", () => {
  const [next, effect] = dirtyTransition(
    { state: "dirty", readOnly: false },
    { type: "opened", readOnly: false },
  );
  assert.equal(next.state, "clean");
  assert.equal(effect.saveEnabled, false);
  assert.equal(effect.notifyHost, null);
});

test("dirty state: opened with readOnly flag sets readOnly context", () => {
  const [next, effect] = dirtyTransition(
    { state: "clean", readOnly: false },
    { type: "opened", readOnly: true },
  );
  assert.equal(next.state, "clean");
  assert.equal(next.readOnly, true);
  assert.equal(effect.saveEnabled, false);
});

test("dirty state: sequence clean→edit→save→edit→done stays dirty", () => {
  let ctx: DirtyContext = { state: "clean", readOnly: false };

  [ctx] = dirtyTransition(ctx, { type: "edit" });
  assert.equal(ctx.state, "dirty");

  [ctx] = dirtyTransition(ctx, { type: "saveRequested" });
  assert.equal(ctx.state, "pending-save");

  [ctx] = dirtyTransition(ctx, { type: "edit" });
  assert.equal(ctx.state, "dirty");

  const [final, effect] = dirtyTransition(ctx, { type: "saveDone" });
  assert.equal(final.state, "dirty");
  assert.equal(effect.notifyHost, "dirty");
});
