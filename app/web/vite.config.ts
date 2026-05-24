import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
    },
  },
  clearScreen: false,
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
  },
});
