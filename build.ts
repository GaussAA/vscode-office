import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild";
import { copy } from "esbuild-plugin-copy";

const __dirname = dirname(fileURLToPath(import.meta.url));

const isProd = process.argv.indexOf("--mode=production") >= 0;

const dependencies = ["@cantoo/pdf-lib"];

/**
 * The repo root is `"type": "module"` so every `.ts`/`.js` in `src/` and `scripts/` is ESM.
 * The extension host, however, runs a **CommonJS** bundle: VS Code `require()`s `main`, and the
 * flat `out/node_modules/<name>.js` files are reached through `require()` too.
 *
 * A `package.json` inside `out/` scopes that back to CommonJS without renaming anything, which
 * keeps `main: ./out/extension.js`, the flat externals and `check-bundled-imports.mjs` all
 * exactly as they are. It must be regenerated on every build — `vite.config.ts` wipes `out/`.
 */
function writeOutPackageJson() {
  mkdirSync(resolve(__dirname, "out"), { recursive: true });
  writeFileSync(
    resolve(__dirname, "out/package.json"),
    `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
  );
}

function createDesktopAssetCopyPlugins(shouldWatch: boolean) {
  return [
    copy({
      resolveFrom: "out",
      watch: shouldWatch,
      assets: [
        {
          from: ["./node_modules/node-unrar-js/dist/js/unrar.wasm"],
          to: ["./"],
        },
        {
          from: ["./node_modules/7z-wasm/7zz.wasm"],
          to: ["./"],
        },
      ],
    }),
  ];
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
    external: ["vscode", ...dependencies],
    format: "cjs",
    platform: "node",
    minify: isProd,
    sourcemap: !isProd,
    logOverride: {
      "duplicate-object-key": "silent",
      "suspicious-boolean-not": "silent",
    },
    plugins: [...createDesktopAssetCopyPlugins(!isProd), createBuildNoticePlugin()],
  });
}

/**
 * The five `external` packages are shipped as their own bundles in `out/node_modules/`
 * instead of inside `out/extension.js`. Two reasons: they are only needed on the export
 * paths (PDF/DOCX/HTML), and `puppeteer-core` alone pulls a dependency tree that is much
 * larger than everything else combined.
 */
async function createLib() {
  const points = dependencies.reduce((point, dependency) => {
    const pkgPath = resolve(`./node_modules/${dependency}/package.json`);
    const main = JSON.parse(readFileSync(pkgPath, "utf-8")).main ?? "index.js";
    const mainAbsPath = resolve(`./node_modules/${dependency}`, main);
    if (existsSync(mainAbsPath)) {
      point[dependency] = mainAbsPath;
    }
    return point;
  }, {});
  await build({
    entryPoints: points,
    bundle: true,
    outdir: "out/node_modules",
    format: "cjs",
    platform: "node",
    minify: true,
    treeShaking: true,
    metafile: true,
  });
}

(async () => {
  try {
    writeOutPackageJson();
    await createLib();
    await buildDesktopExtension();
  } catch {
    process.exit(1);
  }
})();
