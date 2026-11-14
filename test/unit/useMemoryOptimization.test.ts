/* eslint-disable @typescript-eslint/no-floating-promises */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Note: These hooks are tested through integration tests in the React components.
// Unit testing React hooks without @testing-library/react is complex and not worth
// the added dependencies for this project.

describe("useMemoryOptimization hooks", () => {
  it("hooks are exported and importable", async () => {
    const module = await import("../../src/react/hooks/useMemoryOptimization");

    assert.ok(typeof module.useAutoCleanupTimer === "function");
    assert.ok(typeof module.useAutoCleanupEventListener === "function");
    assert.ok(typeof module.useMemoryMonitor === "function");
  });

  it("hooks have correct signatures", async () => {
    const module = await import("../../src/react/hooks/useMemoryOptimization");

    // useAutoCleanupTimer returns an object with timer methods
    assert.equal(module.useAutoCleanupTimer.length, 0); // No parameters

    // useAutoCleanupEventListener returns a function
    assert.equal(module.useAutoCleanupEventListener.length, 0); // No parameters

    // useMemoryMonitor takes componentName
    assert.equal(module.useMemoryMonitor.length, 1); // 1 parameter
  });
});
