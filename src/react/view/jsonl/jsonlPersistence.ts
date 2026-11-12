import { savePersistedState } from "../../common/persistedState";
import { DEFAULT_LEFT_WIDTH, LEFT_MAX, LEFT_MIN } from "./jsonlLayout";

export interface JsonlPersistedState {
  left: number;
  selected: number;
  mode: "tree" | "raw";
}

const PERSIST_PREFIX = "jsonl-state:";

export function parseJsonlPersistedState(raw: string | null): JsonlPersistedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<JsonlPersistedState>;
    if (!parsed || typeof parsed !== "object") return null;
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
  } catch {
    return null;
  }
}

export function loadJsonlPersisted(cacheId: string): JsonlPersistedState | null {
  try {
    return parseJsonlPersistedState(localStorage.getItem(PERSIST_PREFIX + cacheId));
  } catch {
    return null;
  }
}

export function saveJsonlPersisted(cacheId: string, state: JsonlPersistedState) {
  savePersistedState(PERSIST_PREFIX, cacheId, state);
}
