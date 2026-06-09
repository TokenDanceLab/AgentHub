import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@agenthub/shared/hubClient': path.resolve(__dirname, '..', 'shared', 'src', 'hubClient.ts'),
      '@agenthub/shared/hubEvents': path.resolve(__dirname, '..', 'shared', 'src', 'hubEvents.ts'),
      '@agenthub/shared/designTokens': path.resolve(__dirname, '..', 'shared', 'src', 'designTokens.ts'),
      '@agenthub/shared/transcript': path.resolve(__dirname, '..', 'shared', 'src', 'transcript', 'index.ts'),
      '@agenthub/shared': path.resolve(__dirname, '..', 'shared', 'src', 'index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
