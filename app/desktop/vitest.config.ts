import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
    },
  },
  server: { fs: { allow: ['..'] } },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '../shared/src/**/*.test.ts', '../shared/src/**/*.test.tsx'],
    exclude: ['../shared/src/events.test.ts'],
    setupFiles: [],
  },
});