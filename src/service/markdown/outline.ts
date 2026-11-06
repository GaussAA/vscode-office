/**
 * Inject a PDF outline (bookmarks) built from the exported document's table of contents.
 *
 * `createOutline` reads the `.table-of-contents` list out of the rendered HTML, matches each
 * anchor against the `/Dest` keys pdf-lib wrote while the document was generated, and rebuilds
 * the `/Outlines` tree by hand. pdf-lib has no public API for outline items, so this reaches
 * into `context` directly — the `any` casts below are the price of that, and they are confined
 * to this file.
 */

import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber } from "@cantoo/pdf-lib";
import { HTMLElement, parse } from "node-html-parser";

type PdfDoc = any;
type PdfDictRef = any;

interface OutlineDict {
  title: string;
  isLast: boolean;
  dest: PdfDictRef;
  child?: OutlineDict[];
}

export async function createOutline(pdf: Uint8Array, html: string): Promise<Uint8Array> {
  const pdfDoc: PdfDoc = await PDFDocument.load(pdf);
  const root = parse(html);

  const array = root.querySelectorAll(".table-of-contents > ol > li");
  if (array.length > 0) {
    const dict = extractDict(pdfDoc);
    const dictArray = inflateDict(array, dict, HTMLElement);
    if (dictArray.length > 0) {
      await creatOutlines(pdfDoc, dictArray);
    }
  }

  return await pdfDoc.save();
}

function inflateDict(
  array: any[],
  dict: Record<string, OutlineDict>,
  HTMLElement: any,
): OutlineDict[] {
  const dictArray: OutlineDict[] = [];
  for (let index = 0; index < array.length; index++) {
    const li = array[index];
    const a = findDirectChildByTag(li, "a", HTMLElement);
    if (!a) continue;
    const key = getKey(a);
    if (!dict[key]) {
      continue;
    }
    dict[key].title = a.text.trim();
    dict[key].isLast = array.length === 1 || index === array.length - 1;
    const nestedList = findDirectChildByTag(li, "ol", HTMLElement);
    const childs = nestedList ? getDirectChildElementsByTag(nestedList, "li", HTMLElement) : [];
    if (childs != null && childs.length > 0) {
      dict[key].child = inflateDict(childs, dict, HTMLElement);
    }
    dictArray.push(dict[key]);
  }
  return dictArray;
}

function extractDict(pdfDoc: PdfDoc): Record<string, OutlineDict> {
  const dict: Record<string, OutlineDict> = {};
  for (const obj of pdfDoc.context.indirectObjects.entries()) {
    if (obj[1] && typeof obj[1].dict?.entries === "function") {
      for (const entry of obj[1].dict.entries()) {
        if (entry[0].encodedName === "/Dest") {
          const key: string = entry[1].encodedName;
          dict[key] = {
            dest: entry[1],
          } as OutlineDict;
        }
      }
    }
  }
  return dict;
}

function getKey(a: any): string {
  const href: string = a.getAttribute("href") || "";
  const anchor = decodeURIComponent(href.replace(/^#/, ""));
  return anchorToPdfDestKey(anchor);
}

function isElementNode(node: any, HTMLElement: any): boolean {
  return node instanceof HTMLElement;
}

function getDirectChildElementsByTag(element: any, tagName: string, HTMLElement: any): any[] {
  return element.childNodes
    .filter((node: any) => isElementNode(node, HTMLElement))
    .filter((child: any) => child.rawTagName === tagName);
}

function findDirectChildByTag(element: any, tagName: string, HTMLElement: any): any {
  return getDirectChildElementsByTag(element, tagName, HTMLElement)[0] ?? null;
}

function anchorToPdfDestKey(anchor: string): string {
  const encoded = encodeURIComponent(anchor);
  return "/" + encoded.replace(/%/g, "#25");
}

async function creatOutlines(doc: PdfDoc, dictArray: OutlineDict[]): Promise<void> {
  const createOutlineItem = (
    pdfDoc: PdfDoc,
    dict: OutlineDict,
    parentRefer: PdfDictRef,
    outlineRefer: PdfDictRef,
    nextOrPrev: PdfDictRef,
    childRefs: PdfDictRef[] | null,
  ) => {
    const map = new Map();
    map.set(PDFName.Title, PDFHexString.fromText(dict.title));
    map.set(PDFName.Parent, parentRefer);
    if (nextOrPrev != null) {
      map.set(PDFName.of(dict.isLast ? "Prev" : "Next"), nextOrPrev);
    }
    if (childRefs) {
      map.set(PDFName.of("First"), childRefs[0]);
      map.set(PDFName.of("Last"), childRefs[childRefs.length - 1]);
      map.set(PDFName.of("Count"), PDFNumber.of(childRefs.length));
    }
    map.set(PDFName.of("Dest"), dict.dest);
    const outlineDict = PDFDict.fromMapWithContext(map, pdfDoc.context);
    pdfDoc.context.assign(outlineRefer, outlineDict);
    return outlineRefer;
  };

  function buildOutline(
    entries: OutlineDict[],
    pdfDoc: PdfDoc,
    parentRef: PdfDictRef,
  ): PdfDictRef[] {
    const outlineRefers: PdfDictRef[] = [];
    for (const _ of entries) {
      outlineRefers.push(pdfDoc.context.nextRef());
    }
    for (let i = 0; i < entries.length; i++) {
      const dict = entries[i];
      const isLast = i === entries.length - 1;
      const nextOrPrev = isLast ? outlineRefers[i - 1] : outlineRefers[i + 1];
      const childRefs = dict.child ? buildOutline(dict.child, pdfDoc, outlineRefers[i]) : null;
      createOutlineItem(pdfDoc, dict, parentRef, outlineRefers[i], nextOrPrev, childRefs);
    }
    return outlineRefers;
  }

  const outlinesDictRef = doc.context.nextRef();
  const outlineRefers = buildOutline(dictArray, doc, outlinesDictRef);

  // Bind the rebuilt item tree to the document catalog.
  const outlinesDictMap = new Map();
  outlinesDictMap.set(PDFName.Type, PDFName.of("Outlines"));
  outlinesDictMap.set(PDFName.of("First"), outlineRefers[0]);
  outlinesDictMap.set(PDFName.of("Last"), outlineRefers[outlineRefers.length - 1]);
  // Count is the number of top-level outline items, not the number of pages.
  outlinesDictMap.set(PDFName.of("Count"), PDFNumber.of(outlineRefers.length));
  doc.catalog.set(PDFName.of("Outlines"), outlinesDictRef);
  doc.context.assign(outlinesDictRef, PDFDict.fromMapWithContext(outlinesDictMap, doc.context));
}
