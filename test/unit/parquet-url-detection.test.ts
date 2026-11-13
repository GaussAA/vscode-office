import assert from "node:assert/strict";
import test from "node:test";
import type { SchemaElement } from "hyparquet";
import { describeColumn } from "@/react/view/parquet/parquetParser";

test("describeColumn: URL-like column names are detected and marked with displayType link", () => {
  const testCases: Array<{ name: string; expected: boolean }> = [
    { name: "url", expected: true },
    { name: "URL", expected: true },
    { name: "link", expected: true },
    { name: "href", expected: true },
    { name: "uri", expected: true },
    { name: "profile_url", expected: true },
    { name: "image_url", expected: true },
    { name: "url_string", expected: true },
    { name: "link_href", expected: true },
    { name: "homepage", expected: false },
    { name: "name", expected: false },
    { name: "description", expected: false },
    { name: "regular_string", expected: false },
  ];

  for (const { name, expected } of testCases) {
    const element: SchemaElement = {
      name,
      type: "BYTE_ARRAY",
      converted_type: "UTF8",
    };
    const column = describeColumn(element, false);

    if (expected) {
      assert.equal(column.displayType, "link", `${name} should be detected as URL column`);
    } else {
      assert.equal(column.displayType, undefined, `${name} should not be detected as URL column`);
    }
  }
});

test("describeColumn: nested columns are not marked as URL even if name suggests it", () => {
  const element: SchemaElement = {
    name: "url_array",
    type: undefined,
    converted_type: "LIST",
  };
  const column = describeColumn(element, true);

  assert.equal(column.nested, true);
  assert.equal(column.displayType, undefined, "nested columns should not get displayType");
});

test("describeColumn: UTF8 type is normalized to STRING", () => {
  const element: SchemaElement = {
    name: "text_field",
    type: "BYTE_ARRAY",
    converted_type: "UTF8",
  };
  const column = describeColumn(element, false);

  assert.equal(column.type, "STRING", "UTF8 should be normalized to STRING");
  assert.equal(column.category, "string");
});

test("describeColumn: non-string columns are not marked as URL", () => {
  const element: SchemaElement = {
    name: "url_count",
    type: "INT32",
  };
  const column = describeColumn(element, false);

  assert.equal(column.category, "numeric");
  assert.equal(column.displayType, undefined, "numeric columns should not get displayType");
});
