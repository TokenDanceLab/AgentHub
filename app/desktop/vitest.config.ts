import { defineConfig } from 'vitest/config';
import path from 'path';
import { createCoverage } from '../test-config/coverage';

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      'lucide-react': path.resolve(__dirname, 'node_modules', 'lucide-react'),
      'react': path.resolve(__dirname, 'node_modules', 'react'),
      'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
      'react-i18next': path.resolve(__dirname, 'node_modules', 'react-i18next'),
    },
  },
  server: { fs: { allow: ['..'] } },
  ssr: {
    noExternal: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Flake 重试政策 SSOT：docs/governance/known-flaky.md。单元车道预算为 0
    //（fail-closed）；上调预算须先登记并走到期复审。
    retries: 0,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', '../shared/src/**/*.test.ts', '../shared/src/**/*.test.tsx', '../workbench/src/**/*.test.ts', '../workbench/src/**/*.test.tsx'],
    setupFiles: ['./src/__tests__/setup.ts'],
    execArgv: ['--max-old-space-size=8192'],
    maxWorkers: 4,
    // FLK-004：desktop+shared+workbench 全量并行下渲染重型用例（如
    // App.v4.test.tsx）偶发超过 vitest 默认 5s 测试超时；与 edge-real-ci
    // 先例对齐显式放宽（重试预算仍为 0）。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // 与 vitest.desktop-ci.config.ts 同源阈值（本地 test:coverage 也走门禁，
    // 不再让 CI/本地两套契约漂移）：48/39/40/46 为 2026-08-03 实测 floor。
    coverage: createCoverage({
      thresholds: { lines: 48, branches: 39, functions: 40, statements: 46 },
      // src/main.tsx — 纯入口（ReactDOM.createRoot 挂载），无业务逻辑
      exclude: ['src/main.tsx'],
    }),
  },
});
