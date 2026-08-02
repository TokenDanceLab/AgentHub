import { defineConfig } from 'vitest/config';
import path from 'path';
import { createCoverage } from '../test-config/coverage';

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
    coverage: createCoverage({
      // 绝对 floors（2026-08-03 实测，含全部生产源码进分母后）：
      // lines 36.19 / stmt 35.81 / fn 27.82 / br 22.72 — 每维 floor(实测)-1。
      // 全部低于 60 是提升目标（见 coverage-baseline.json note），非永久豁免。
      thresholds: { lines: 35, branches: 21, functions: 26, statements: 34 },
      exclude: [],
    }),
  },
});
