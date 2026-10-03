import { defineConfig } from "vite";

const WORKER_URL = "http://localhost:8787";

export default defineConfig({
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": WORKER_URL,
      "/ws": { target: WORKER_URL, ws: true },
    },
  },
  build: {
    assetsDir: "build",
    target: "es2022",
    chunkSizeWarningLimit: 2000,
  },
});
