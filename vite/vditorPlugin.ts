import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import chokidar from "chokidar";
import type { Plugin } from "vite";

const cwd = process.cwd();
const vditorDir = resolve(cwd, "vditor");
const viteBin = resolve(cwd, "node_modules/vite/bin/vite.js");
const vditorArtifact = resolve(vditorDir, "dist", "index.min.js");

const DEBOUNCE_MS = 500;
const COOLDOWN_MS = 2000;

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(full));
    } else {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

/**
 * `vditor/` is its own workspace package with its own dependencies and its own Vite build.
 * Rebuilding it on every `pnpm build` costs a few seconds for output that has not changed,
 * so the production path skips it when the artifact is newer than every source file.
 * `OFFICE_FORCE_VDITOR_BUILD=1` overrides the check.
 */
function vditorNeedsBuild(): boolean {
  if (process.env.OFFICE_FORCE_VDITOR_BUILD === "1") return true;
  try {
    const artifactAt = statSync(vditorArtifact).mtimeMs;
    const newestSource = Math.max(
      newestMtime(resolve(vditorDir, "src")),
      statSync(resolve(vditorDir, "vite.config.ts")).mtimeMs,
    );
    return newestSource > artifactAt;
  } catch {
    return true;
  }
}

function runVditorBuild(production: boolean) {
  const result = spawnSync(
    process.execPath,
    [viteBin, "build", "--mode", production ? "production" : "development"],
    { cwd: vditorDir, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("vditor build failed");
  }
}

export function vditorDevPlugin(): Plugin {
  let building = false;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastBuildAt = 0;

  const scheduleBuild = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = undefined;
      runBuildWhenReady();
    }, DEBOUNCE_MS);
  };

  const runBuildWhenReady = () => {
    if (building) {
      scheduleBuild();
      return;
    }
    const elapsed = Date.now() - lastBuildAt;
    if (lastBuildAt > 0 && elapsed < COOLDOWN_MS) {
      debounceTimer = setTimeout(() => {
        debounceTimer = undefined;
        runBuildWhenReady();
      }, COOLDOWN_MS - elapsed);
      return;
    }
    building = true;
    try {
      runVditorBuild(false);
      lastBuildAt = Date.now();
    } catch (err) {
      console.error(err);
    } finally {
      building = false;
    }
  };

  return {
    name: "vditor-dev-watch",
    apply: "serve",
    configureServer(server) {
      runVditorBuild(false);
      lastBuildAt = Date.now();
      const watcher = chokidar.watch(
        [resolve(vditorDir, "src"), resolve(vditorDir, "vite.config.ts")],
        {
          ignoreInitial: true,
          awaitWriteFinish: {
            stabilityThreshold: 300,
            pollInterval: 100,
          },
        },
      );
      watcher.on("change", scheduleBuild);
      server.httpServer?.once("close", () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        watcher.close();
      });
    },
  };
}

export function vditorProdBuildPlugin(): Plugin {
  return {
    name: "vditor-prod-build",
    apply: "build",
    closeBundle() {
      if (!vditorNeedsBuild()) {
        console.log("vditor: dist is newer than src, skipping rebuild");
        return;
      }
      runVditorBuild(true);
    },
  };
}
