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

// Plugin to add missing Node.js APIs (like util.channel)
function patchNodePolyfills(): Plugin {
  return {
    name: "patch-node-polyfills",
    enforce: "post", // 在其他插件之后运行

    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk" && fileName.includes("Excel")) {
          console.log(`[patch-node-polyfills] Patching ${fileName}`);

          let patchCount = 0;

          // 1. 在 t.inspect 之后添加 t.channel
          const utilPattern = /(t\.inspect\s*=\s*[^;]+;)/g;
          chunk.code = chunk.code.replace(utilPattern, (match) => {
            patchCount++;
            return (
              match +
              "t.channel=function(){return{hasSubscribers:false,publish:function(){},subscribe:function(){},unsubscribe:function(){}}};"
            );
          });

          // 2. 替换空的 util 模块导出为有 channel 的版本
          // 模式: Kt=l(((e,t)=>{t.exports={}}))
          const emptyModulePattern = /(\w+)=l\(\(\(e,t\)=>\{t\.exports=\{\}\}\)\)/g;
          chunk.code = chunk.code.replace(emptyModulePattern, (match, varName) => {
            patchCount++;
            console.log(
              `[patch-node-polyfills] Replacing empty module ${varName} with util polyfill`,
            );
            // 替换为包含 channel 的 util 模块
            return `${varName}=l(((e,t)=>{
              function debuglog(){return function(){}}
              function format(f){return String(f)}
              function inspect(v){return String(v)}
              function channel(){return{hasSubscribers:false,publish:function(){},subscribe:function(){},unsubscribe:function(){}}}
              t.exports={debuglog:debuglog,format:format,inspect:inspect,channel:channel}
            }))`;
          });

          console.log(`[patch-node-polyfills] Applied ${patchCount} patches`);
        }
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => ({
  plugins: [
    nodePolyfills({
      // 包含需要的 Node.js 内置模块
      include: ["util", "stream", "buffer", "process", "events"],
      // 也包含子路径
      protocolImports: true,
      // 使用插件提供的 polyfills
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    patchNodePolyfills(),
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
    alias: {
      // 为 Node.js 子模块提供 polyfill 或 stub
      "node:util/types": resolve(cwd, "src/react/shims/util-types.ts"),
      "node:stream/web": resolve(cwd, "src/react/shims/stream-web.ts"),
      "node:http2": resolve(cwd, "src/react/shims/http2-constants.ts"),
      http2: resolve(cwd, "src/react/shims/http2-constants.ts"),
    },
  },
  optimizeDeps: {
    include: ["buffer"],
    exclude: ["xlsx", "undici"], // 不预构建，避免缓存问题
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
