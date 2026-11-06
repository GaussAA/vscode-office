import assert from "node:assert/strict";
import test from "node:test";
import { formatDateTime } from "../../out/unit-tests/formatDateTime.mjs";

/**
 * Archive listings show a fixed, sortable `yyyy-MM-dd hh:mm:ss` in local time. This replaced
 * `date-format`, so the cases below pin the two things that package got right and a naive
 * rewrite would get wrong: zero padding, and local — not UTC — fields.
 */

test("formatDateTime: pads every field to two digits", () => {
  // 2025-03-07 08:09:06 local: every field is a single digit somewhere.
  assert.equal(formatDateTime(new Date(2025, 2, 7, 8, 9, 6)), "2025-03-07 08:09:06");
});

test("formatDateTime: midnight and end-of-year do not collapse", () => {
  assert.equal(formatDateTime(new Date(2024, 11, 31, 23, 59, 59)), "2024-12-31 23:59:59");
  assert.equal(formatDateTime(new Date(2026, 0, 1, 0, 0, 0)), "2026-01-01 00:00:00");
});

test("formatDateTime: reads local fields, not UTC", () => {
  const date = new Date(2024, 5, 15, 13, 45, 30);
  assert.equal(formatDateTime(date), "2024-06-15 13:45:30");
  // Guard against a rewrite that reaches for toISOString(): the two only agree in UTC.
  assert.equal(
    formatDateTime(new Date(2024, 5, 15, 13, 45, 30)),
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-") +
      ` ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`,
  );
});
