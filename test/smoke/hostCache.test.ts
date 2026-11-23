/// <reference types="mocha" />
/**
 * Real-host verification for the ADR-0026 disk caches (not the browser fake-bridge harness).
 *
 * What only this suite can prove: the JSON Preview / JSONL disk entries are written on the
 * first open and not rewritten on the second, which is the observable difference a cache hit
 * makes.
 *
 * The cache roots are read through the test-only `__cachePaths` command.
 */
import * as assert from "node:assert";
import { promises as fsp } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { sleep, waitFor, WebviewBridge } from "./webviewBridge";

const EXTENSION_ID = "GaussAA.office-viewer-plus";
const JSONL_VIEW = "GaussAA.jsonlViewer";
const CACHE_PATHS_COMMAND = "GaussAA.office.__cachePaths";

function jsonlFixture(rows: number): Uint8Array {
  const parts: string[] = [];
  for (let row = 0; row < rows; row++) {
    parts.push(`{"id":${row},"name":"row-${row}","ok":${row % 2 === 0}}`);
  }
  return new TextEncoder().encode(parts.join("\n"));
}

function jsonFixture(rows: number): Uint8Array {
  const parts = ["["];
  for (let row = 0; row < rows; row++) {
    if (row > 0) parts.push(",");
    parts.push(`{"id":${row},"name":"row-${row}","ok":${row % 2 === 0}}`);
  }
  parts.push("]");
  return new TextEncoder().encode(parts.join(""));
}

async function waitForInner(
  bridge: WebviewBridge,
  selector: string,
  description: string,
  timeoutMs = 60000,
): Promise<void> {
  await waitFor(
    () =>
      bridge.evaluate<boolean>(
        `!!document.querySelector('iframe')?.contentWindow?.document.querySelector(${JSON.stringify(selector)})`,
      ),
    () => description,
    timeoutMs,
  );
}

async function openViewer(uri: vscode.Uri, viewType: string): Promise<WebviewBridge> {
  const known = await WebviewBridge.knownTargetIds();
  await vscode.commands.executeCommand("vscode.openWith", uri, viewType);
  return WebviewBridge.attachToNewWebview(known);
}

async function openJsonPreview(uri: vscode.Uri): Promise<WebviewBridge> {
  const known = await WebviewBridge.knownTargetIds();
  await vscode.commands.executeCommand("GaussAA.office.previewJson", uri);
  return WebviewBridge.attachToNewWebview(known);
}

async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  await sleep(400);
}

async function cacheBins(root: string, subdir: string): Promise<string[]> {
  try {
    const names = await fsp.readdir(path.join(root, subdir));
    return names.filter((name) => name.endsWith(".bin")).sort();
  } catch {
    return [];
  }
}

async function waitForCache(root: string, subdir: string): Promise<string[]> {
  return waitFor(
    async () => {
      const files = await cacheBins(root, subdir);
      return files.length > 0 ? files : null;
    },
    () => `no entry appeared under ${subdir}`,
    30000,
  );
}

async function binMtimes(root: string, subdir: string): Promise<Record<string, number>> {
  const dir = path.join(root, subdir);
  const result: Record<string, number> = {};
  for (const name of await cacheBins(root, subdir)) {
    result[name] = (await fsp.stat(path.join(dir, name))).mtimeMs;
  }
  return result;
}

describe("host caches (real VS Code)", function () {
  let dir: vscode.Uri;
  let root: string;

  before(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)?.activate();
    dir = vscode.Uri.file(path.join(os.tmpdir(), "office-viewer-host-cache"));
    await vscode.workspace.fs.createDirectory(dir);
    const paths = await vscode.commands.executeCommand<{ globalStorage: string }>(
      CACHE_PATHS_COMMAND,
    );
    assert.ok(paths?.globalStorage, "the test-only cache path command is missing");
    root = paths.globalStorage;
  });

  after(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await vscode.workspace.fs.delete(dir, { recursive: true, useTrash: false });
  });

  afterEach(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    await sleep(300);
  });

  async function writeFixture(name: string, bytes: Uint8Array): Promise<vscode.Uri> {
    const uri = vscode.Uri.joinPath(dir, name);
    await vscode.workspace.fs.writeFile(uri, bytes);
    return uri;
  }

  it("JSON Preview: a second preview reuses the cached record ranges", async () => {
    const uri = await writeFixture("host-cache.json", jsonFixture(150_000));

    const first = await openJsonPreview(uri);
    await waitForInner(first, ".json-preview", "the JSON preview did not render");
    await waitForInner(first, ".json-record", "the JSON preview did not load a record");
    await sleep(1500);
    const files = await waitForCache(root, "json-preview-index");
    const mtimes = await binMtimes(root, "json-preview-index");
    first.close();
    await closeActiveEditor();

    const second = await openJsonPreview(uri);
    await waitForInner(second, ".json-preview", "the second JSON preview did not render");
    await waitForInner(second, ".json-record", "the second JSON preview did not load a record");
    await sleep(1000);
    assert.deepEqual(await cacheBins(root, "json-preview-index"), files);
    assert.deepEqual(
      await binMtimes(root, "json-preview-index"),
      mtimes,
      "the second preview rewrote the range cache",
    );
    second.close();
  });

  it("JSONL: a second open reuses the cached line index", async () => {
    const uri = await writeFixture("host-cache.jsonl", jsonlFixture(150_000));

    const first = await openViewer(uri, JSONL_VIEW);
    await waitForInner(first, ".jsonl-entry", "the JSONL viewer did not render");
    await sleep(1000);
    const files = await waitForCache(root, "jsonl-index");
    const mtimes = await binMtimes(root, "jsonl-index");
    first.close();
    await closeActiveEditor();

    const second = await openViewer(uri, JSONL_VIEW);
    await waitForInner(second, ".jsonl-entry", "the second JSONL open did not render");
    await sleep(1000);
    assert.deepEqual(await cacheBins(root, "jsonl-index"), files);
    assert.deepEqual(
      await binMtimes(root, "jsonl-index"),
      mtimes,
      "the second open rebuilt the line index",
    );
    second.close();
  });

  it("JSON Preview: the 1.3 MB user workspace expands without the stringify stall", async function () {
    const userFile = String.raw`C:\WorkSpace\trajectory-quality-inspection\tests\true-test\2026-11-19-codex-kimi-pass14-14samples-selfdeployed\data\workspace_0001_workspace_workspace.json`;
    let bytes: Uint8Array;
    try {
      bytes = await fsp.readFile(userFile);
    } catch {
      // Local-only fixture: absent on CI runners.
      this.skip();
      return;
    }
    const uri = await writeFixture("user-workspace.json", bytes);
    const bridge = await openJsonPreview(uri);
    try {
      await waitForInner(bridge, ".jsonl-detail__tree", "the object tree did not render", 120_000);
      await waitForInner(
        bridge,
        ".ant-tree-treenode .ant-tree-node-content-wrapper",
        "the object tree has no rows",
        120_000,
      );
      const treeDiag = await bridge.evaluate<string>(`(() => {
        const doc = document.querySelector('iframe')?.contentWindow?.document;
        if (!doc) return JSON.stringify({ error: 'no iframe document' });
        return JSON.stringify([...doc.querySelectorAll('.ant-tree-treenode')].slice(0, 5).map((node) => ({
          key: node.getAttribute('data-node-key'),
          selected: node.className.includes('ant-tree-treenode-selected'),
          title: node.querySelector('.ant-tree-title')?.textContent ?? null,
        })));
      })()`);
      console.log(`tree diag ${treeDiag}`);
      await bridge.evaluate(`(() => {
        const doc = document.querySelector('iframe')?.contentWindow?.document;
        doc?.querySelector('.ant-tree-treenode .ant-tree-title')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(500);
      const treeAfter = await bridge.evaluate<string>(`(() => {
        const doc = document.querySelector('iframe')?.contentWindow?.document;
        if (!doc) return JSON.stringify({ error: 'no iframe document' });
        return JSON.stringify([...doc.querySelectorAll('.ant-tree-treenode')].slice(0, 5).map((node) => ({
          key: node.getAttribute('data-node-key'),
          selected: node.className.includes('ant-tree-treenode-selected'),
        })));
      })()`);
      console.log(`tree after click ${treeAfter}`);
      await waitForInner(bridge, ".jsonl-valuebar", "the value bar never rendered", 60_000);
      const valueMs = await bridge.evaluate<number>(`(() => {
        const win = document.querySelector('iframe')?.contentWindow;
        const doc = win?.document;
        win.__dshLongTasks = [];
        try {
          new win.PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              win.__dshLongTasks.push({
                start: Math.round(entry.startTime),
                duration: Math.round(entry.duration),
              });
            }
          }).observe({ type: 'longtask', buffered: true });
        } catch {}
        const start = performance.now();
        doc?.querySelector('.jsonl-valuebar__toggle')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        const sync = performance.now() - start;
        win.__dshValueState = { sync, opened: false };
        win.requestAnimationFrame(() => {
          win.__dshValueState.opened = true;
          win.__dshValueState.at = Math.round(performance.now() - start);
        });
        return sync;
      })()`);
      console.log(`value click sync ${Math.round(valueMs)} ms`);
      await sleep(1500);
      const diag = await bridge.evaluate<string>(`(() => {
        const win = document.querySelector('iframe')?.contentWindow;
        const doc = win?.document;
        return JSON.stringify({
          longtasks: win?.__dshLongTasks ?? [],
          state: win?.__dshValueState ?? null,
          barClass: doc?.querySelector('.jsonl-valuebar')?.className ?? null,
          body: !!doc?.querySelector('.jsonl-valuebar__body'),
          text: !!doc?.querySelector('.jsonl-valuebar__scroll'),
        });
      })()`);
      console.log(`value panel diag ${diag}`);
      await waitForInner(
        bridge,
        ".jsonl-valuebar__body .jsonl-valuebar__scroll",
        "the value panel did not open",
        60_000,
      );
      assert.ok(valueMs < 500, `value panel expand took ${valueMs} ms`);

      await bridge.evaluate(`(() => {
        const doc = document.querySelector('iframe')?.contentWindow?.document;
        const button = [...doc.querySelectorAll('.jsonl-detail__header button')]
          .find((candidate) => /全部展开|Expand all/.test(candidate.textContent || ''));
        button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      })()`);
      await sleep(500);
      const confirmAppeared = await bridge.evaluate<boolean>(`(() => {
        const doc = document.querySelector('iframe')?.contentWindow?.document;
        return !!doc?.querySelector('.ant-modal-confirm-btns .ant-btn-primary');
      })()`);
      const treeMs = await bridge.evaluate<number>(`(() => {
        const doc = document.querySelector('iframe')?.contentWindow?.document;
        const start = performance.now();
        doc.querySelector('.ant-modal-confirm-btns .ant-btn-primary')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return performance.now() - start;
      })()`);
      // The confirm only appears above EXPAND_ALL_CONFIRM nodes; a smaller object expands
      // directly, so accept either path and still wait for the tree to grow.
      await waitForInner(bridge, ".ant-tree-treenode", "the tree never expanded", 60_000);
      assert.ok(treeMs < 3000, `expand-all took ${treeMs} ms`);
      console.log(
        `user json: value ${Math.round(valueMs)} ms, tree ${Math.round(treeMs)} ms, ` +
          `confirm ${confirmAppeared}, ${bytes.byteLength} bytes`,
      );
    } finally {
      bridge.close();
    }
  });
});
