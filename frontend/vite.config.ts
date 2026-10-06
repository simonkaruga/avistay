import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        followRedirects: true,
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      srcDir: "src/sw",
      filename: "service-worker.ts",
      strategies: "injectManifest",
      manifest: false,
      injectManifest: {
        swSrc: "src/sw/service-worker.ts",
        swDest: "dist/service-worker.js",
      },
      devOptions: { enabled: false },   // a worker in dev serves stale files
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        // Long-lived caches for libraries that rarely change.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) return "vendor";
          if (id.includes("@tanstack/react-query")) return "query";
          return undefined;
        },
      },
    },
  },
});
