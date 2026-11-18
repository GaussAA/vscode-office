import {
  clearPersistedPrefix,
  loadVersionedState,
  saveVersionedState,
} from "../../common/versionedState.ts";
import { DEFAULT_LEFT_WIDTH, LEFT_MAX, LEFT_MIN } from "./jsonlLayout";

export interface JsonlPersistedState {
  left: number;
  selected: number;
  mode: "tree" | "raw";
}

const PERSIST_PREFIX = "jsonl-state:";
const STATE_VERSION = 1;
const STATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function parseState(value: unknown): JsonlPersistedState | null {
  if (!value || typeof value !== "object") return null;
  const parsed = value as Partial<JsonlPersistedState>;
  const left =
    typeof parsed.left === "number" && Number.isFinite(parsed.left)
      ? Math.min(LEFT_MAX, Math.max(LEFT_MIN, parsed.left))
      : DEFAULT_LEFT_WIDTH;
  const selected =
    typeof parsed.selected === "number" && Number.isFinite(parsed.selected)
      ? Math.max(0, Math.trunc(parsed.selected))
      : 0;
  return {
    left,
    selected,
    mode: parsed.mode === "raw" ? "raw" : "tree",
  };
}

/** Kept for tests and callers that already have the raw string (the legacy shape). */
export function parseJsonlPersistedState(raw: string | null): JsonlPersistedState | null {
  if (!raw) return null;
  try {
    return parseState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function loadJsonlPersisted(cacheId: string): JsonlPersistedState | null {
  return loadVersionedState(PERSIST_PREFIX, cacheId, {
    version: STATE_VERSION,
    maxAgeMs: STATE_MAX_AGE_MS,
    parse: parseState,
    parseLegacy: parseState,
  });
}

export function saveJsonlPersisted(cacheId: string, state: JsonlPersistedState) {
  saveVersionedState(PERSIST_PREFIX, cacheId, STATE_VERSION, state);
}

/** Remove every per-document JSONL UI entry; used by the unified Clear command. */
export function clearJsonlPersisted(): void {
  clearPersistedPrefix(PERSIST_PREFIX);
}
