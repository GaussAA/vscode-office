import assert from "node:assert/strict";
import test from "node:test";
import { buildIconMaps, resolveFileIcon, resolveFolderIcon } from "@/service/icon/iconTheme";

/**
 * `theme/material-icons.json` is read at activation time and turned into the icon maps the
 * webviews use. It is also a *partial* theme on purpose: it only describes the formats this
 * fork renders, so it carries no `folderNames` / `fileNames` maps at all.
 *
 * That combination used to be an activation crash — `Object.entries(undefined)` throws
 * "Cannot convert undefined or null to object", which the smoke layer saw but no unit test
 * could. These cases keep a partial theme a supported input.
 */

const MINIMAL = {
  iconDefinitions: {
    file: { iconPath: "./../icons/file.svg" },
    folder: { iconPath: "./../icons/folder.svg" },
    "folder-open": { iconPath: "./../icons/folder-open.svg" },
    table: { iconPath: "./../icons/table.svg" },
    word: { iconPath: "./../icons/word.svg" },
  },
  fileExtensions: {
    csv: "table",
    docx: "word",
  },
  file: "file",
  folder: "folder",
  folderExpanded: "folder-open",
};

test("buildIconMaps: a theme with no folder or file-name maps is valid", () => {
  const maps = buildIconMaps(MINIMAL);
  assert.deepEqual(maps.fileNameToIconFile, {});
  assert.deepEqual(maps.folderToIconFile, {});
  assert.deepEqual(maps.folderExpandedToIconFile, {});
});

test("buildIconMaps: defaults come from the theme, not from a hard-coded name", () => {
  const maps = buildIconMaps(MINIMAL);
  assert.equal(maps.defaultFileIcon, "file.svg");
  assert.equal(maps.defaultFolderIcon, "folder.svg");
  assert.equal(maps.defaultFolderExpandedIcon, "folder-open.svg");
});

test("resolveFileIcon: extension wins, unknown extensions fall back to the default", () => {
  const maps = buildIconMaps(MINIMAL);
  assert.equal(resolveFileIcon("report.CSV", maps), "table.svg");
  assert.equal(resolveFileIcon("letter.docx", maps), "word.svg");
  assert.equal(resolveFileIcon("README", maps), "file.svg");
  assert.equal(resolveFileIcon("archive.tar.gz", maps), "file.svg");
});

test("resolveFolderIcon: falls back to the theme defaults without folder associations", () => {
  const maps = buildIconMaps(MINIMAL);
  assert.equal(resolveFolderIcon("src", maps), "folder.svg");
  assert.equal(resolveFolderIcon("src", maps, true), "folder-open.svg");
});
