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
  ssr: {
    noExternal: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Flake 重试政策 SSOT：docs/governance/known-flaky.md。单元车道预算为 0
    //（fail-closed）；上调预算须先登记并走到期复审。
    retries: 0,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.e2e.test.ts', 'src/**/*.e2e.test.tsx', 'e2e/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: createCoverage({
      // 绝对 floors（2026-08-03 实测，含全部生产源码进分母后）：
      // lines 64.69 / stmt 63.66 / fn 54.11 / br 58.75 — 每维 floor(实测)-1。
      // fn/br 低于 60 是提升目标（见 coverage-baseline.json note），非永久豁免。
      thresholds: { lines: 63, branches: 57, functions: 53, statements: 62 },
      // src/main.tsx — 纯入口（ReactDOM.createRoot 挂载），无业务逻辑（shared
      // 的 index.ts 同先例）
      exclude: ['src/main.tsx'],
    }),
  },
});
