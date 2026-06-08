import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@agenthub/shared': path.resolve(__dirname, '..', 'shared', 'src', 'index.ts'),
      '@agenthub/shared/transcript': path.resolve(__dirname, '..', 'shared', 'src', 'transcript', 'index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
