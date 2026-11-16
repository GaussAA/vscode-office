import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Pure dirty-state machine for Excel documents.
 *
 * States: clean, dirty, pending-save
 * Events: edit, saveRequested, saveDone, opened
 *
 * Effects tell the caller what to do (enable save button, notify host of dirty state).
 */

export type DirtyState = "clean" | "dirty" | "pending-save";

export interface DirtyEffect {
  saveEnabled: boolean;
  notifyHost: "dirty" | "clean" | null;
}

export type DirtyEvent =
  | { type: "edit" }
  | { type: "saveRequested" }
  | { type: "saveDone" }
  | { type: "opened"; readOnly: boolean };

export interface DirtyContext {
  state: DirtyState;
  readOnly: boolean;
}

/**
 * Transition function for the dirty-state machine.
 * Returns [newState, effect].
 */
export function dirtyTransition(ctx: DirtyContext, event: DirtyEvent): [DirtyContext, DirtyEffect] {
  const { state, readOnly } = ctx;

  if (event.type === "opened") {
    const newCtx = { state: "clean" as DirtyState, readOnly: event.readOnly };
    return [newCtx, { saveEnabled: false, notifyHost: null }];
  }

  if (event.type === "edit") {
    if (readOnly) return [ctx, { saveEnabled: false, notifyHost: null }];
    if (state === "clean") {
      return [
        { ...ctx, state: "dirty" },
        { saveEnabled: true, notifyHost: "dirty" },
      ];
    }
    if (state === "pending-save") {
      return [
        { ...ctx, state: "dirty" },
        { saveEnabled: true, notifyHost: null }, // already notified when entering pending
      ];
    }
    // already dirty: no change
    return [ctx, { saveEnabled: true, notifyHost: null }];
  }

  if (event.type === "saveRequested") {
    if (readOnly) return [ctx, { saveEnabled: false, notifyHost: null }];
    if (state === "clean" || state === "dirty") {
      return [
        { ...ctx, state: "pending-save" },
        { saveEnabled: false, notifyHost: null },
      ];
    }
    // already pending: no change
    return [ctx, { saveEnabled: false, notifyHost: null }];
  }

  if (event.type === "saveDone") {
    if (state === "pending-save") {
      return [
        { ...ctx, state: "clean" },
        { saveEnabled: false, notifyHost: "clean" },
      ];
    }
    if (state === "dirty") {
      // Edit happened after saveRequested but before saveDone arrived: stay dirty, re-notify host
      return [ctx, { saveEnabled: true, notifyHost: "dirty" }];
    }
    // clean + saveDone: spurious, ignore
    return [ctx, { saveEnabled: false, notifyHost: null }];
  }

  return [ctx, { saveEnabled: false, notifyHost: null }];
}

// ============================================================================
// Tests
// ============================================================================

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
  let effect: DirtyEffect;

  // clean → edit → dirty
  [ctx, effect] = dirtyTransition(ctx, { type: "edit" });
  assert.equal(ctx.state, "dirty");

  // dirty → saveRequested → pending-save
  [ctx, effect] = dirtyTransition(ctx, { type: "saveRequested" });
  assert.equal(ctx.state, "pending-save");

  // pending-save → edit → dirty
  [ctx, effect] = dirtyTransition(ctx, { type: "edit" });
  assert.equal(ctx.state, "dirty");
  assert.equal(effect.saveEnabled, true);
  assert.equal(effect.notifyHost, null); // no new notification yet

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
