import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "@cantoo/pdf-lib";
import { createOutline } from "../../out/unit-tests/outline.mjs";

/**
 * `createOutline` is only reachable through the PDF export path, which needs Chromium — so
 * without this file the 130 lines that rebuild a PDF's `/Outlines` tree were never executed by
 * any gate. It reaches into pdf-lib internals (there is no public API for outline items), which
 * is precisely the kind of code that breaks silently on a dependency bump.
 *
 * The no-table-of-contents branch is the cheap half: it still exercises load → save, i.e. the
 * dynamic `import("@cantoo/pdf-lib")` that only runs on this path.
 */

async function makePdf(pages) {
  const doc = await PDFDocument.create();
  for (let index = 0; index < pages; index++) {
    doc.addPage();
  }
  return await doc.save();
}

test("outline: a document without a table of contents comes back readable", async () => {
  const pdf = await makePdf(2);
  const out = await createOutline(pdf, "<html><body><p>no toc here</p></body></html>");
  assert.ok(out.length > 0, "createOutline returned no bytes");
  const reloaded = await PDFDocument.load(out);
  assert.equal(reloaded.getPageCount(), 2);
});

test("outline: a table of contents with no matching destinations is a no-op", async () => {
  const pdf = await makePdf(1);
  const html = `<html><body><div class="table-of-contents"><ol>
    <li><a href="#heading-that-does-not-exist">Missing</a></li>
  </ol></div></body></html>`;
  const out = await createOutline(pdf, html);
  const reloaded = await PDFDocument.load(out);
  assert.equal(reloaded.getPageCount(), 1);
  assert.equal(reloaded.catalog.get(reloaded.context.obj("Outlines")), undefined);
});
