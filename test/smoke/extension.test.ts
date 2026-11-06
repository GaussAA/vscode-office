/**
 * Integration smoke tests — the layer between `node --test` (pure logic) and
 * `verify:ui` (webview DOM in a plain browser).
 *
 * What only this layer can catch: the extension failing to activate, a contributed
 * command disappearing after activation is made lazy, and VS Code no longer routing a
 * file to our `viewType`. Those are precisely the failure modes of the platform-baseline
 * work (engines bump, dropping `onStartupFinished`, adding CSP), none of which a browser
 * test can see.
 *
 * Console-error capture from inside a webview is *not* attempted here: the API does not
 * expose it. `verify:ui` already asserts that.
 */
import * as assert from "node:assert";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { parquetWriteBuffer } from "hyparquet-writer";

const EXTENSION_ID = "GaussAA.office-viewer-plus";

function workspaceRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, "the smoke workspace is not open");
  return folder.uri;
}

/** Open `uri` with `viewType`, then wait until a tab actually reports that input. */
async function openWithAndWait(
  viewType: string,
  uri: vscode.Uri,
  timeoutMs = 30000,
): Promise<vscode.Tab> {
  await vscode.commands.executeCommand("vscode.openWith", uri, viewType);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputCustom && input.viewType === viewType) {
          return tab;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no custom editor tab appeared for viewType "${viewType}"`);
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.closeAllEditors");
}

/** Diagnostic tail for tab-lookup failures: what was actually open. */
function describeTabs(): string {
  const tabs = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => {
      const input = tab.input as { viewType?: string } | undefined;
      const kind = input?.constructor?.name ?? "none";
      return `${tab.label}[${kind}${input?.viewType ? `/${input.viewType}` : ""}]`;
    }),
  );
  return tabs.length > 0 ? tabs.join(" | ") : "none";
}

async function parquetFixture(): Promise<vscode.Uri> {
  const dir = vscode.Uri.file(path.join(os.tmpdir(), "office-viewer-smoke"));
  await vscode.workspace.fs.createDirectory(dir);
  const uri = vscode.Uri.joinPath(dir, "fixture.parquet");
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: "id", data: [1, 2, 3], type: "INT32" },
      { name: "name", data: ["alpha", "beta", "gamma"], type: "STRING" },
    ],
  });
  await vscode.workspace.fs.writeFile(uri, new Uint8Array(buffer));
  return uri;
}

describe("activation is lazy", () => {
  it("is not active before anything opens a viewer or a git workspace", () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the development host`);
    // The fixture workspace is a plain folder inside the repo: no `.git` at its root,
    // no `.http` file open. Nothing should have woken the extension up yet.
    assert.strictEqual(
      extension.isActive,
      false,
      "the extension activated at startup again -- check package.json#activationEvents",
    );
  });
});

describe("extension activation", () => {
  it("is installed and activates without throwing", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} is not installed in the development host`);

    await extension.activate();
    assert.strictEqual(extension.isActive, true);
  });
});

describe("contributed commands", () => {
  it("every command declared in package.json is registered after activation", async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
    await extension.activate();

    const declared: string[] = (extension.packageJSON?.contributes?.commands ?? []).map(
      (entry: { command: string }) => entry.command,
    );
    assert.ok(declared.length > 0, "package.json declares no commands");

    const available = new Set(await vscode.commands.getCommands(true));
    const missing = declared.filter((command) => !available.has(command));
    assert.deepStrictEqual(missing, [], `commands not registered: ${missing.join(", ")}`);
  });
});

describe("html preview", () => {
  afterEach(async () => {
    await closeAllEditors();
  });

  // The preview renders an untrusted document, and it does so in its own panel with its
  // own origin. This only proves the panel opens; that the document lands in a sandboxed
  // frame is pinned by test/unit/html-preview-shell.test.mjs, which a browser-side test
  // could not do here anyway.
  it("opens its own webview panel for a file", async () => {
    const uri = vscode.Uri.joinPath(workspaceRoot(), "sample.html");
    await vscode.commands.executeCommand("GaussAA.office.html.preview", uri);

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          // VS Code prefixes panel view types with `mainThreadWebview-`, so compare
          // on the suffix rather than on an exact match.
          if (
            input instanceof vscode.TabInputWebview &&
            String(input.viewType).includes("office-viewer.viewHtml")
          ) {
            return;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(
      `no webview panel appeared for office-viewer.viewHtml; tabs: ${describeTabs()}`,
    );
  });
});

describe("multiple editors per document", () => {
  afterEach(async () => {
    await closeAllEditors();
  });

  // Without `supportsMultipleEditorsPerDocument` the second open is refused or lands in
  // the default text editor, so "two groups, both ours" is the observable difference.
  it("shows the same file in two editor groups", async () => {
    const viewType = "GaussAA.jsonlViewer";
    const uri = vscode.Uri.joinPath(workspaceRoot(), "sample.jsonl");

    await vscode.commands.executeCommand("vscode.openWith", uri, viewType, vscode.ViewColumn.One);
    await vscode.commands.executeCommand("vscode.openWith", uri, viewType, vscode.ViewColumn.Two);

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const columns = new Set<number>();
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (
            input instanceof vscode.TabInputCustom &&
            input.viewType === viewType &&
            input.uri.toString() === uri.toString()
          ) {
            columns.add(group.viewColumn ?? -1);
          }
        }
      }
      if (columns.size >= 2) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`expected two editor groups showing ${viewType}; tabs: ${describeTabs()}`);
  });
});

describe("custom editors", () => {
  afterEach(async () => {
    await closeAllEditors();
  });

  const cases: Array<{ viewType: string; fixture: () => Promise<vscode.Uri> }> = [
    {
      viewType: "GaussAA.markdownViewer",
      fixture: async () => vscode.Uri.joinPath(workspaceRoot(), "sample.md"),
    },
    {
      viewType: "GaussAA.htmlViewer",
      fixture: async () => vscode.Uri.joinPath(workspaceRoot(), "sample.html"),
    },
    {
      viewType: "GaussAA.officeViewer",
      fixture: async () => vscode.Uri.joinPath(workspaceRoot(), "sample.csv"),
    },
    {
      viewType: "GaussAA.jsonlViewer",
      fixture: async () => vscode.Uri.joinPath(workspaceRoot(), "sample.jsonl"),
    },
    {
      viewType: "GaussAA.parquetViewer",
      fixture: parquetFixture,
    },
  ];

  for (const { viewType, fixture } of cases) {
    it(`routes files to ${viewType}`, async () => {
      const uri = await fixture();
      const tab = await openWithAndWait(viewType, uri);
      assert.strictEqual((tab.input as vscode.TabInputCustom).uri.toString(), uri.toString());
    });
  }
});
