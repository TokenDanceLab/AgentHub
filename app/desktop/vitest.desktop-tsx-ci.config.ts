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
    include: ['src/**/*.test.tsx'],
    exclude: ['src/__tests__/integration/**'],
    setupFiles: ['src/__tests__/testSetup.ts'],
    execArgv: ['--max-old-space-size=4096'],
    memoryLimit: '512MB',
    maxWorkers: 4,
  },
});
