/// <reference types="mocha" />
/**
 * Host-side save wiring, observed in a real VS Code.
 *
 * `test/unit/save-handlers.test.ts` proves the rules against a fake context. These tests
 * prove the other half: that `commonHandler` actually feeds those rules from a real
 * `WebviewPanel` (its title is the unsaved marker), a real file watcher, a real
 * `workspace.fs` and a real `showSaveDialog` call.
 *
 * How the webview side is reached without touching `src/`: see `webviewBridge.ts`. The
 * messages posted here (`change`, `save`, `saveAs`) are exactly the ones the Excel viewer
 * posts; what is NOT exercised is the viewer deciding to post them (typing in the canvas,
 * pressing Ctrl+S). That half is covered by `verify:ui` and the unit tests.
 *
 * The suite is registered from the end of `extension.test.ts` (after the lazy-activation
 * check, which must see a host in which nothing has opened a viewer yet) instead of being a
 * second `*.test.ts` file, whose order relative to that check would depend on the file glob.
 */
import * as assert from "node:assert";
import * as vscode from "vscode";
import { WebviewBridge, sleep, waitFor } from "./webviewBridge";

const VIEW_TYPE = "GaussAA.officeViewer";
const DIR_NAME = ".smoke-save-host";

interface OpenedWorkbook {
  uri: vscode.Uri;
  fileName: string;
  bridge: WebviewBridge;
}

function workspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the smoke workspace is not open");
  return folder.uri;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function findTab(uri: vscode.Uri): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input instanceof vscode.TabInputCustom && input.uri.toString() === uri.toString()) {
        return tab;
      }
    }
  }
  return undefined;
}

function describeTabs(): string {
  const labels = vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label));
  return labels.length > 0 ? labels.join(" | ") : "none";
}

/** Wait until the tab for `uri` carries exactly `label` (a trailing `*` means unsaved). */
async function expectLabel(uri: vscode.Uri, label: string, timeoutMs = 30000): Promise<void> {
  await waitFor(
    () => findTab(uri)?.label === label,
    () => `tab label never became "${label}"; open tabs: ${describeTabs()}`,
    timeoutMs,
  );
}

/** Assert the label is `label` now and stays so for `settleMs`. */
async function expectLabelStays(uri: vscode.Uri, label: string, settleMs = 1000): Promise<void> {
  const deadline = Date.now() + settleMs;
  while (Date.now() < deadline) {
    assert.strictEqual(
      findTab(uri)?.label,
      label,
      `tab label changed away from "${label}"; open tabs: ${describeTabs()}`,
    );
    await sleep(100);
  }
}

export function registerSaveHostSuite(): void {
  describe("host save wiring (real webview, real file system)", function () {
    let dir: vscode.Uri;
    let fixtureBytes: Uint8Array;

    before(async () => {
      dir = vscode.Uri.joinPath(workspaceRoot(), DIR_NAME);
      await vscode.workspace.fs.createDirectory(dir);
      fixtureBytes = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(workspaceRoot(), "..", "test-simple.xlsx"),
      );
    });

    after(async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await vscode.workspace.fs.delete(dir, { recursive: true });
    });

    afterEach(async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    /** Copy the fixture to `<dir>/<fileName>`, open it, and wait for the Excel canvas. */
    async function openWorkbook(fileName: string) {
      const uri = vscode.Uri.joinPath(dir, fileName);
      await vscode.workspace.fs.writeFile(uri, fixtureBytes);
      const known = await WebviewBridge.knownTargetIds();
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
      const bridge = await WebviewBridge.attachToNewWebview(known);
      await expectLabel(uri, fileName);
      const opened: OpenedWorkbook = { uri, fileName, bridge };
      return opened;
    }

    /** Make the document dirty the way the viewer does and wait for the marker. */
    async function makeDirty(workbook: OpenedWorkbook) {
      await workbook.bridge.post("change");
      await expectLabel(workbook.uri, `${workbook.fileName}*`);
    }

    it("shows the unsaved marker when the webview reports an edit", async () => {
      const workbook = await openWorkbook("edit-marker.xlsx");
      try {
        await makeDirty(workbook);
      } finally {
        workbook.bridge.close();
      }
    });

    it("an external change to the file reloads the document and clears the unsaved marker", async () => {
      const workbook = await openWorkbook("reload.xlsx");
      try {
        await makeDirty(workbook);
        const opensBefore = await workbook.bridge.count("open");

        await vscode.workspace.fs.writeFile(workbook.uri, fixtureBytes);

        await waitFor(
          async () => (await workbook.bridge.count("open")) > opensBefore,
          () => "the host never re-sent the document after the external write",
        );
        await expectLabel(workbook.uri, workbook.fileName);
        assert.ok(findTab(workbook.uri), `the panel went away; open tabs: ${describeTabs()}`);
      } finally {
        workbook.bridge.close();
      }
    });

    it("a plain save writes the bytes, clears the marker and answers saveDone", async () => {
      const workbook = await openWorkbook("save.xlsx");
      try {
        await makeDirty(workbook);
        const payload = Buffer.concat([fixtureBytes, Buffer.from("saved-by-smoke")]);

        await workbook.bridge.post("save", { contentBase64: base64(payload) });

        await waitFor(
          async () => (await workbook.bridge.count("saveDone")) > 0,
          () => "the host never answered saveDone",
        );
        await expectLabel(workbook.uri, workbook.fileName);
        const written = await vscode.workspace.fs.readFile(workbook.uri);
        assert.ok(Buffer.from(written).equals(payload), "the file does not hold the saved bytes");
        assert.strictEqual(await workbook.bridge.count("saveFailed"), 0);
      } finally {
        workbook.bridge.close();
      }
    });

    it("the file-change echo of our own save does not reload the document", async () => {
      const workbook = await openWorkbook("echo.xlsx");
      try {
        await makeDirty(workbook);
        const payload = Buffer.concat([fixtureBytes, Buffer.from("echo-check")]);

        await workbook.bridge.post("save", { contentBase64: base64(payload) });
        await waitFor(
          async () => (await workbook.bridge.count("saveDone")) > 0,
          () => "the host never answered saveDone",
        );
        // The watcher echo of the write arrives well inside the 1.5 s skip window; give it
        // time to arrive and be (not) acted upon.
        await sleep(1200);

        assert.strictEqual(
          await workbook.bridge.count("open"),
          0,
          "the host re-sent the document after our own save: the echo was not skipped",
        );
      } finally {
        workbook.bridge.close();
      }
    });

    it("an edit that arrives while the save is still writing keeps the unsaved marker", async () => {
      const workbook = await openWorkbook("edit-during-save.xlsx");
      try {
        await makeDirty(workbook);

        // 12 MB of zero bytes (`AAAA` is three zero bytes in base64), generated inside the
        // webview, so the write takes long enough that the `change` posted right behind the
        // `save` is handled while `writeFile` is still pending.
        const size = 12_000_000;
        await workbook.bridge.run(`(() => {
        const post = (message) => window.__vscode_post_message__('onmessage', { message });
        post({ type: 'save', content: { contentBase64: 'AAAA'.repeat(${size / 3}) } });
        post({ type: 'change' });
        return true;
      })()`);

        await waitFor(
          async () => (await workbook.bridge.count("saveDone")) > 0,
          () => "the host never answered saveDone",
        );
        const stat = await vscode.workspace.fs.stat(workbook.uri);
        assert.strictEqual(stat.size, size, "the large save did not reach the disk");
        await expectLabelStays(workbook.uri, `${workbook.fileName}*`);
      } finally {
        workbook.bridge.close();
      }
    });

    it("saving a read-only document answers saveFailed(readonly) and never writes", async () => {
      // `isUriReadOnly` marks two things read-only: the `git:` scheme, and a `file:` document
      // whose stat carries FilePermission.Readonly. The extension API never reports the latter
      // for a file on disk (chmod 444 comes back as "locked", which it hides), so the one real
      // read-only document a test can open is a `git:` revision served by the built-in git
      // extension. `git:` here is a snapshot of this repository's fixture at HEAD.
      const gitExtension = vscode.extensions.getExtension("vscode.git");
      assert.ok(gitExtension, "the built-in git extension is not available");
      await gitExtension.activate();
      const repoRoot = vscode.Uri.joinPath(workspaceRoot(), "..", "..", "..");
      await vscode.commands.executeCommand("git.openRepository", repoRoot.fsPath);
      const tracked = vscode.Uri.joinPath(workspaceRoot(), "..", "test-simple.xlsx");
      const uri = tracked.with({
        scheme: "git",
        query: JSON.stringify({ path: tracked.fsPath, ref: "HEAD" }),
      });
      const known = await WebviewBridge.knownTargetIds();
      await vscode.commands.executeCommand("vscode.openWith", uri, VIEW_TYPE);
      const bridge = await WebviewBridge.attachToNewWebview(known);
      try {
        await bridge.post("change");
        await expectLabel(uri, "test-simple.xlsx*");

        await bridge.post("save", { contentBase64: base64(Buffer.from("must-not-land")) });

        const failure = await waitFor(
          async () => (await bridge.received()).find((m) => m.type === "saveFailed"),
          () => "the host never answered saveFailed",
        );
        assert.strictEqual(failure.reason, "readonly");
        assert.strictEqual(await bridge.count("saveDone"), 0);
        await expectLabelStays(uri, "test-simple.xlsx*", 500);
      } finally {
        bridge.close();
      }
    });

    it("a write that fails answers saveFailed(write) with the error and keeps the marker", async () => {
      const workbook = await openWorkbook("write-fails.xlsx");
      try {
        // The document's path becomes a directory: the host can still stat it and the panel
        // stays open, but writing a file there is refused by the file service.
        await vscode.workspace.fs.delete(workbook.uri);
        await vscode.workspace.fs.createDirectory(workbook.uri);
        await sleep(1500); // let any watcher event for the swap pass before the edit below
        await makeDirty(workbook);

        await workbook.bridge.post("save", { contentBase64: base64(Buffer.from("unwritable")) });

        const failure = await waitFor(
          async () => (await workbook.bridge.received()).find((m) => m.type === "saveFailed"),
          () => "the host never answered saveFailed",
        );
        assert.strictEqual(failure.reason, "write");
        assert.ok(failure.message && failure.message.length > 0, "saveFailed carries no message");
        assert.strictEqual(await workbook.bridge.count("saveDone"), 0);
        await expectLabelStays(workbook.uri, `${workbook.fileName}*`, 500);
      } finally {
        workbook.bridge.close();
      }
    });

    describe("Save As", () => {
      const realShowSaveDialog = vscode.window.showSaveDialog;
      const slot = vscode.window as unknown as { showSaveDialog: unknown };
      let dialogCalls: vscode.SaveDialogOptions[];

      /** The dialog is a native OS window; answer it from the test instead. */
      function answerDialogWith(target: vscode.Uri | undefined) {
        dialogCalls = [];
        slot.showSaveDialog = async (options: vscode.SaveDialogOptions) => {
          dialogCalls.push(options);
          return target;
        };
      }

      afterEach(() => {
        slot.showSaveDialog = realShowSaveDialog;
      });

      it("writes the copy and opens it, but the original keeps its unsaved marker", async () => {
        const workbook = await openWorkbook("save-as.xlsx");
        const target = vscode.Uri.joinPath(dir, "save-as-copy.csv");
        try {
          await makeDirty(workbook);
          answerDialogWith(target);
          const csv = Buffer.from("a,b\n1,2\n");

          await workbook.bridge.post("saveAs", { contentBase64: base64(csv), ext: "csv" });

          await waitFor(
            () => findTab(target),
            () => `the Save As target never opened; open tabs: ${describeTabs()}`,
          );
          const copy = await vscode.workspace.fs.readFile(target);
          assert.ok(Buffer.from(copy).equals(csv), "the copy does not hold the saved bytes");

          assert.strictEqual(dialogCalls.length, 1);
          assert.ok(
            dialogCalls[0].defaultUri?.fsPath.endsWith("save-as.csv"),
            `unexpected default name: ${dialogCalls[0].defaultUri?.fsPath}`,
          );
          assert.deepStrictEqual(dialogCalls[0].filters, { "CSV (Comma delimited)": ["csv"] });

          // The original document was not written: its edits are still unsaved.
          assert.strictEqual(findTab(workbook.uri)?.label, `${workbook.fileName}*`);
          const original = await vscode.workspace.fs.readFile(workbook.uri);
          assert.ok(Buffer.from(original).equals(fixtureBytes), "Save As overwrote the original");
        } finally {
          workbook.bridge.close();
        }
      });
    });
  });
}
