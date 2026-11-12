import { test } from "node:test";
import assert from "node:assert/strict";
import { readCSV } from "../../src/react/view/excel/excel_reader";
import { encodeCsvText } from "../../src/react/view/excel/csvEncoding";

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

test("csv reader: reports the encoding it actually decoded with", () => {
  const gbk = bufferOf(encodeCsvText("姓名,年龄\n张三,30\n", "gbk"));
  const data = readCSV(gbk);
  assert.equal(data.csvEncoding, "gbk");
  assert.equal(data.maxLength, 2);
});

test("csv reader: a UTF-8 BOM is still reported as UTF-8", () => {
  const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("id,name\n1,α\n")]);
  const data = readCSV(bufferOf(bytes));
  assert.equal(data.csvEncoding, "utf8");
});
