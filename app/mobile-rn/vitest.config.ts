import { defineConfig } from 'vitest/config';
import path from 'path';
import { createCoverage } from '../test-config/coverage';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Flake retry policy SSOT: docs/architecture/github-actions-ci-cd-policy.md. Unit lane
    // does not retry (fail-closed).
    retries: 0,
    include: ['src/**/*.test.ts'],
    coverage: createCoverage({
      // 绝对 floors：lines 33 / branches 20 / functions 25 / statements 33。
      // 全部低于 60 是提升目标（coverage thresholds 见本文件），非永久豁免。
      thresholds: { lines: 33, branches: 20, functions: 25, statements: 33 },
      exclude: [],
    }),
  },
});
