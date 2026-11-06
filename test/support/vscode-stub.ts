/**
 * The slice of `vscode` that `src/service/markdown/*.js` touches at import time.
 *
 * Those modules are bundled with this file aliased in place of `vscode`, which is how the
 * markdown **export** path gets unit coverage at all — it is not a webview, so it cannot be
 * reached through `verify:ui`, and it has no host-side smoke test either.
 *
 * Keep this minimal: every symbol added here is a promise that the real extension API behaves
 * the same way for the code under test.
 */

interface StubUri {
  fsPath: string;
  path: string;
  scheme: string;
  toString(): string;
}

function stubUri(value: string): StubUri {
  return {
    fsPath: value,
    path: value.replace(/\\/g, "/"),
    scheme: "file",
    toString: () => value,
  };
}

export const Uri = {
  file: (value: string) => stubUri(value),
  parse: (value: string) => stubUri(value),
  joinPath: (base: StubUri, ...parts: string[]) => stubUri([base.fsPath, ...parts].join("/")),
};

/** Errors the export path would show in a notification land on stderr instead. */
export const window = {
  showErrorMessage(message: string) {
    console.error(`[vscode-stub] showErrorMessage: ${message}`);
  },
  showWarningMessage(message: string) {
    console.error(`[vscode-stub] showWarningMessage: ${message}`);
  },
};

export const workspace = {
  getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
};
