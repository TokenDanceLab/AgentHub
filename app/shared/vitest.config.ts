import { defineConfig } from 'vitest/config';
import { createCoverage } from '../test-config/coverage';

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Exclude stray git worktrees (e.g. .worktrees/refactor/*) and the
    // vendored reference/ repos so their test files — which resolve with a
    // different environment — aren't picked up and fail spuriously.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/reference/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: createCoverage({
      thresholds: {
        lines: 60,
        branches: 60,
        functions: 60,
        statements: 60,
      },
      // 既有窄排除（具体文件，非整类）：
      //   index.ts — 纯 re-export 入口
      //   types.ts — 纯类型声明
      //   events.ts — 事件名常量（无逻辑）
      //   mock.ts — 测试 mock 工具（不参与被测逻辑）
      //   errors.ts — 错误类型定义
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/events.ts',
        'src/mock.ts',
        'src/errors.ts',
      ],
    }),
  },
});
