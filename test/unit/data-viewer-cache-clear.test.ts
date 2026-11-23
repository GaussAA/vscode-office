import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDataViewerCaches,
  registerDataViewerCacheClearer,
  resetDataViewerCacheClearers,
} from "@/service/dataViewerCacheClear";

test("clear cache registry: awaits every registered clearer", async () => {
  resetDataViewerCacheClearers();
  const calls: string[] = [];
  registerDataViewerCacheClearer(() => {
    calls.push("parquet");
  });
  registerDataViewerCacheClearer(async () => {
    await Promise.resolve();
    calls.push("jsonl");
  });

  await clearDataViewerCaches();
  assert.deepEqual(calls, ["parquet", "jsonl"]);
  resetDataViewerCacheClearers();
});

test("clear cache registry: one failing clearer does not stop the rest", async () => {
  resetDataViewerCacheClearers();
  const calls: string[] = [];
  registerDataViewerCacheClearer(() => {
    throw new Error("boom");
  });
  registerDataViewerCacheClearer(() => {
    calls.push("after");
  });

  await clearDataViewerCaches();
  assert.deepEqual(calls, ["after"]);
  resetDataViewerCacheClearers();
});

test("clear cache registry: unregister removes only that clearer", async () => {
  resetDataViewerCacheClearers();
  const calls: string[] = [];
  const registration = registerDataViewerCacheClearer(() => {
    calls.push("removed");
  });
  registerDataViewerCacheClearer(() => {
    calls.push("kept");
  });
  registration.dispose();

  await clearDataViewerCaches();
  assert.deepEqual(calls, ["kept"]);
  resetDataViewerCacheClearers();
});
