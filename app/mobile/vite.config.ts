import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@agenthub/shared": resolve(__dirname, "../shared/src"),
    },
  },
  build: {
    target: ['es2021', 'chrome100', 'safari15'],
  },
  envPrefix: ['VITE_', 'TAURI_'],
  server: {
    port: 5174,
    strictPort: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
