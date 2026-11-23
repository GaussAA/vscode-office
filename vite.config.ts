import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { visualizer } from "rollup-plugin-visualizer";

const cwd = process.cwd();
const argv = process.argv;
const isProdBuild = argv.includes("build") && argv.some((arg) => arg.includes("production"));

if (isProdBuild) {
  rmSync(resolve(cwd, "out"), { recursive: true, force: true });
}

if (argv.join(",").includes("mode")) {
  void import("./build");
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => ({
  plugins: [
    nodePolyfills({
      // 包含需要的 Node.js 内置模块
      include: ["util", "stream", "process", "events"],
      // 也包含子路径
      protocolImports: true,
      // 使用插件提供的 polyfills
      globals: {
        global: true,
        process: true,
      },
    }),
    react(),
    visualizer({
      filename: "stats/bundle-analysis.html",
      open: false,
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  define: {
    global: "globalThis",
  },
  resolve: {
    conditions: ["browser", "module", "import", "default"],
  },
  server: {
    cors: {
      origin: true,
    },
    host: "127.0.0.1",
    port: 5739,
    fs: {
      allow: [".."],
    },
  },
  base: "",
  build: {
    outDir: "out/webview",
    chunkSizeWarningLimit: 2048,
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ["console.log", "console.info", "console.debug"],
        passes: 2,
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      external: [],
      output: {
        manualChunks(id) {
          // Split vendor libraries into separate chunks
          if (id.includes("node_modules")) {
            if (id.includes("react") || id.includes("react-dom")) {
              return "vendor-react";
            }
            if (id.includes("antd") || id.includes("@ant-design")) {
              return "vendor-antd";
            }
          }
        },
      },
    },
  },
}));
