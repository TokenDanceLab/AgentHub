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
    // Flake 重试政策 SSOT：docs/architecture/github-actions-ci-cd-policy.md。单元车道不重试（fail-closed）。
    retries: 0,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/**/*.e2e.test.ts', 'src/**/*.e2e.test.tsx', 'e2e/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: createCoverage({
      // 绝对 floors（含全部生产源码进分母）：lines 63 / branches 57 /
      // functions 53 / statements 62。
      // fn/br 低于 60 是提升目标（coverage thresholds 见本文件），非永久豁免。
      thresholds: { lines: 63, branches: 57, functions: 53, statements: 62 },
      // src/main.tsx — 纯入口（ReactDOM.createRoot 挂载），无业务逻辑（shared
      // 的 index.ts 同先例）
      exclude: ['src/main.tsx'],
    }),
  },
});
