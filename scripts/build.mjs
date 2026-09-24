import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const outDir = resolve(projectRoot, "dist");

async function buildEntry(name, entry, emptyOutDir) {
  await build({
    configFile: false,
    root: projectRoot,
    plugins: [vue()],
    build: {
      outDir,
      emptyOutDir,
      target: "es2022",
      rollupOptions: {
        input: { [name]: resolve(projectRoot, entry) },
        output: {
          format: "iife",
          name: `FnMusicAmll${name.charAt(0).toUpperCase()}${name.slice(1)}`,
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: "[name][extname]",
          inlineDynamicImports: true,
        },
      },
    },
  });
}

await buildEntry("content", "src/content.ts", true);
await buildEntry("bridge", "src/bridge.ts", false);
await buildEntry("background", "src/background.ts", false);
console.log("构建完成：dist/content.js、dist/bridge.js、dist/background.js 均为独立脚本。");
