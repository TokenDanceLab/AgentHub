import { defineConfig } from 'vitest/config';
import path from 'path';
import { createCoverage } from '../test-config/coverage';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Explicit subpath aliases must come before the barrel alias so vitest
      // does not prefix-match `@agenthub/shared/errors` against the index.ts
      // entry (which would swallow the subpath and fail to resolve the file).
      '@agenthub/shared/errors': path.resolve(__dirname, '..', 'shared', 'src', 'errors.ts'),
      '@agenthub/shared/api/auth': path.resolve(__dirname, '..', 'shared', 'src', 'api', 'auth', 'index.ts'),
      '@agenthub/shared/notificationIntents': path.resolve(__dirname, '..', 'shared', 'src', 'notificationIntents.ts'),
      '@agenthub/shared/hub/hubClient': path.resolve(__dirname, '..', 'shared', 'src', 'hub', 'hubClient.ts'),
      '@agenthub/shared/hubEvents': path.resolve(__dirname, '..', 'shared', 'src', 'hubEvents.ts'),
      '@agenthub/shared/designTokens': path.resolve(__dirname, '..', 'shared', 'src', 'designTokens.ts'),
      '@agenthub/shared/transcript': path.resolve(__dirname, '..', 'shared', 'src', 'transcript', 'index.ts'),
      '@agenthub/shared': path.resolve(__dirname, '..', 'shared', 'src', 'index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // Flake retry policy SSOT: docs/governance/known-flaky.md. Unit-lane budget
    // is 0 (fail-closed); raising it needs a registry entry with a review
    // deadline.
    retries: 0,
    include: ['src/**/*.test.ts'],
    coverage: createCoverage({
      // 绝对 floors（2026-08-15 re-baseline：CI 实测 34.51/34.27/26.83/21.16，
      // 前基线 2026-08-03 实测 36.19/35.81/27.82/22.72 因 vitest v4 工具链
      // 漂移整体下移 ~1.5pp；uncovered_files 25 不变、tests 339→346 增，
      // 非代码面恶化，属测量工具变化。每维 floor(实测)-1。
      // 全部低于 60 是提升目标（见 coverage-baseline.json note），非永久豁免。
      thresholds: { lines: 33, branches: 20, functions: 25, statements: 33 },
      exclude: [],
    }),
  },
});
