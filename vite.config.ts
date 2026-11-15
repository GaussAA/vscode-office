import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
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

// Plugin to inject util.channel polyfill at the very start of Excel bundle
function injectUtilPolyfill(): Plugin {
  return {
    name: "inject-util-polyfill",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && fileName.includes("Excel")) {
          console.log(`[inject-util-polyfill] Injecting util.channel polyfill into ${fileName}`);

          // Inject at the very start of the chunk
          const polyfillCode = `
(function() {
  // util.channel polyfill for xlsx and other pre-bundled libraries
  if (typeof globalThis.util === "undefined") {
    globalThis.util = {};
  }
  if (typeof globalThis.util.channel === "undefined") {
    globalThis.util.channel = function() {
      return {
        hasSubscribers: false,
        publish: function() {},
        subscribe: function() {},
        unsubscribe: function() {}
      };
    };
  }
  // Also inject other util methods that might be needed
  if (!globalThis.util.debuglog) {
    globalThis.util.debuglog = function() { return function() {}; };
  }
  if (!globalThis.util.format) {
    globalThis.util.format = function(f) { return String(f); };
  }
  if (!globalThis.util.inspect) {
    globalThis.util.inspect = function(v) { return String(v); };
  }
})();
`;

          chunk.code = polyfillCode + chunk.code;
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => ({
  plugins: [
    nodePolyfills({
      // 包含需要的 Node.js 内置模块（不包括 util，我们用自己的 shim）
      include: ["stream", "buffer", "process", "events"],
      // 显式排除 util，使用我们的 shim
      exclude: ["util"],
      // 也包含子路径
      protocolImports: true,
      // 使用插件提供的 polyfills
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    react(),
    injectUtilPolyfill(), // 在打包后注入 polyfill
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
    alias: {
      // 为 Node.js 子模块提供 polyfill 或 stub
      // 注意：更具体的路径必须在更通用的路径之前
      "node:util/types": resolve(cwd, "src/react/shims/util-types.ts"),
      "node:util": resolve(cwd, "src/react/shims/util.ts"),
      util: resolve(cwd, "src/react/shims/util.ts"),
      "node:stream/web": resolve(cwd, "src/react/shims/stream-web.ts"),
      "node:http2": resolve(cwd, "src/react/shims/http2-constants.ts"),
      http2: resolve(cwd, "src/react/shims/http2-constants.ts"),
    },
  },
  optimizeDeps: {
    include: ["buffer"],
    exclude: ["undici"], // 只排除 undici，让 Vite 处理 xlsx 并解析其 util 导入
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
            if (id.includes("xlsx")) {
              return "vendor-xlsx";
            }
          }
        },
      },
    },
  },
}));
