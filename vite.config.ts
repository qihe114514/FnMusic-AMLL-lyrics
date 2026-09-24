import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: { content: resolve(import.meta.dirname, "src/content.ts"), bridge: resolve(import.meta.dirname, "src/bridge.ts"), background: resolve(import.meta.dirname, "src/background.ts") },
      output: { entryFileNames: "[name].js", chunkFileNames: "chunks/[name]-[hash].js", assetFileNames: "[name][extname]" }
    }
  }
});
