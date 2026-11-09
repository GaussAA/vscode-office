import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isProd = process.argv.indexOf("--mode=production") >= 0;

/**
 * The repo root is `"type": "module"` so every `.ts`/`.js` in `src/` and `scripts/` is ESM.
 * The extension host, however, runs a **CommonJS** bundle: VS Code `require()`s `main`, and the
 * flat `out/node_modules/<name>.js` files are reached through `require()` too.
 *
 * A `package.json` inside `out/` scopes that back to CommonJS without renaming anything, which
 * keeps `main: ./out/extension.js` and `check-bundled-imports.mjs` exactly as they are. It must
 * be regenerated on every build — `vite.config.ts` wipes `out/`.
 */
function writeOutPackageJson() {
  mkdirSync(resolve(__dirname, "out"), { recursive: true });
  writeFileSync(
    resolve(__dirname, "out/package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
}

function createBuildNoticePlugin() {
  return {
    name: "build notice",
    setup(build) {
      build.onStart(() => {
        console.log("build start");
      });
      build.onEnd(() => {
        console.log("build success");
      });
    },
  };
}

async function runBuild(shouldWatch, options) {
  if (shouldWatch) {
    const ctx = await context(options);
    await ctx.watch();
    return ctx;
  }
  return build(options);
}

function buildDesktopExtension() {
  return runBuild(!isProd, {
    entryPoints: ["./src/extension.ts"],
    bundle: true,
    outfile: "out/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    minify: isProd,
    sourcemap: !isProd,
    logOverride: {
      "duplicate-object-key": "silent",
      "suspicious-boolean-not": "silent",
    },
    plugins: [createBuildNoticePlugin()],
  });
}

(async () => {
  try {
    writeOutPackageJson();
    await buildDesktopExtension();
  } catch {
    process.exit(1);
  }
})();
