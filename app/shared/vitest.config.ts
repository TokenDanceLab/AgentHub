import { defineConfig } from 'vitest/config';
import { createCoverage } from '../test-config/coverage';

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  resolve: {
    // Match app/web + app/desktop: dedupe react/react-dom so the shared
    // package (consumed by both renderers) doesn't end up with two copies
    // of React in the test graph, which breaks hooks + zustand v5 stores
    // (ui/toast/toastStore, chatview/typingPresence, transcript/pinMap,
    // api/auth/ports all use zustand v5).
    dedupe: ['react', 'react-dom'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Flake 重试政策 SSOT：docs/governance/known-flaky.md。单元车道预算为 0
    //（fail-closed）；上调预算须先登记并走到期复审。
    retries: 0,
    // 与 desktop 配置一致的 worker 上限：全量 2000+ 测试时默认全核并发
    // 会导致 forks worker 启动/回收超时（vitest-pool Timeout terminating
    // forks worker），限制并发后 coverage 全量运行稳定。
    maxWorkers: 4,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Exclude stray git worktrees (e.g. .worktrees/refactor/*) and the
    // vendored reference/ repos so their test files — which resolve with a
    // different environment — aren't picked up and fail spuriously.
    // Also exclude throwaway probe/ scratch tests under src/.tmp/ so ad-hoc
    // debugging artifacts can never trip the suite even if recreated.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/reference/**', 'src/.tmp/**'],
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
      //   errors.ts — 错误类型定义
      exclude: [
        'src/index.ts',
        'src/types.ts',
        'src/events.ts',
        'src/errors.ts',
      ],
    }),
  },
});
