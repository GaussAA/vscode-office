/**
 * Minimal process shim for browser environments.
 *
 * Some libraries (like xlsx) check for process.platform, process.arch, etc.
 * This provides just enough to satisfy those checks without pulling in the full Node.js process.
 */
export const process = {
  env: {},
  platform: "browser",
  arch: "x64",
  version: "",
  versions: {},
  // Dummy emit function to satisfy typeof checks
  emit: () => false,
};

export default process;
