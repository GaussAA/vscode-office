import { makePathKey, pathToText, type PathSeg } from "../jsonl/jsonlFormat.ts";

export interface JsonPathMatch {
  key: string;
  path: string;
  snippet: string;
}

function entriesOf(value: unknown): [PathSeg, unknown][] {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value as Record<string, unknown>);
  }
  return [];
}

function primitiveText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

/**
 * The first tree row that contains the search term. Keys and primitive values are searched;
 * composite values are only descended into (their `{…}`/`[…]` preview is not text). This is
 * the webview half of record search: the host finds which record, this finds where.
 */
export function firstMatchKey(value: unknown, term: string): string | null {
  const needle = term.trim().toLowerCase();
  if (!needle) return null;
  let remaining = 50_000;
  const visit = (current: unknown, path: PathSeg[]): string | null => {
    for (const [segment, child] of entriesOf(current)) {
      if (remaining-- <= 0) return null;
      const childPath = [...path, segment];
      if (typeof segment === "string" && segment.toLowerCase().includes(needle)) {
        return makePathKey(childPath);
      }
      if (typeof child === "object" && child !== null) {
        const found = visit(child, childPath);
        if (found) return found;
      } else if (primitiveText(child).toLowerCase().includes(needle)) {
        return makePathKey(childPath);
      }
    }
    return null;
  };
  return visit(value, []);
}

/** Search result rows for an object root: matching paths, not records. */
export function collectMatchPaths(value: unknown, term: string, limit = 200): JsonPathMatch[] {
  const needle = term.trim().toLowerCase();
  if (!needle) return [];
  const results: JsonPathMatch[] = [];
  let remaining = 50_000;
  const visit = (current: unknown, path: PathSeg[]) => {
    for (const [segment, child] of entriesOf(current)) {
      if (results.length >= limit || remaining-- <= 0) return;
      const childPath = [...path, segment];
      const key = typeof segment === "string" ? segment : `[${segment}]`;
      const keyMatches = typeof segment === "string" && segment.toLowerCase().includes(needle);
      if (keyMatches) {
        results.push({ key: makePathKey(childPath), path: pathToText(childPath), snippet: key });
        continue;
      }
      if (typeof child === "object" && child !== null) {
        visit(child, childPath);
      } else {
        const text = primitiveText(child);
        if (text.toLowerCase().includes(needle)) {
          results.push({
            key: makePathKey(childPath),
            path: pathToText(childPath),
            snippet: text.slice(0, 160),
          });
        }
      }
    }
  };
  visit(value, []);
  return results;
}
