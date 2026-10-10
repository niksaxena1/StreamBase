import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { offlineDependencyStrings } from "./build/offline";

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), offlineDependencyStrings()],
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.LEGACY_API_PORT || 8765}`,
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist", assetsInlineLimit: 0 },
});
