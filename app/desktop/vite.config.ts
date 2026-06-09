import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import os from 'os';
import path from 'path';

/**
 * Reads the Edge auth token written by Tauri EdgeManager at startup.
 * This allows the Vite dev server to authenticate against Edge without
 * needing the Tauri invoke bridge (which only works inside Tauri WebView).
 */
function edgeAuthTokenPlugin() {
  return {
    name: 'edge-auth-token',
    config() {
      const tokenPath = path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'com.agenthub.desktop',
        'edge-auth-token',
      );
      let token = '';
      try {
        token = fs.readFileSync(tokenPath, 'utf-8').trim();
      } catch {
        // Token file doesn't exist yet — Edge may not have been started.
      }
      return {
        define: {
          'import.meta.env.VITE_EDGE_AUTH_TOKEN': JSON.stringify(token),
        },
      };
    },
  };
}

export default defineConfig({
  plugins: [react(), edgeAuthTokenPlugin()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      'lucide-react': path.resolve(__dirname, 'node_modules', 'lucide-react'),
      'react': path.resolve(__dirname, 'node_modules', 'react'),
      'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
      'react-i18next': path.resolve(__dirname, 'node_modules', 'react-i18next'),
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-tanstack': ['@tanstack/react-query', '@tanstack/react-virtual'],
          'vendor-markdown': ['react-markdown', 'remark-gfm', 'react-syntax-highlighter'],
          'vendor-ui': ['lucide-react', 'clsx', 'class-variance-authority'],
          'vendor-i18n': ['i18next', 'react-i18next'],
        },
      },
    },
  },
});
