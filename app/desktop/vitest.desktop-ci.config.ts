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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['src/__tests__/integration/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    execArgv: ['--max-old-space-size=8192'],
    memoryLimit: '512MB',
    maxWorkers: 4,
    // FLK-004：渲染重型 .tsx 用例在 512MB worker 负载下偶发超过默认 5s。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    deps: {
      optimizer: {
        client: {
          include: ['@lobehub/fluent-emoji'],
        },
      },
    },
    coverage: createCoverage({
      // 绝对 floors（2026-08-03 实测，含全部生产源码进分母后）：
      // lines 49.29 / stmt 47.44 / fn 41.79 / br 40.96 — 每维 floor(实测)-1。
      // 全部低于 60 是提升目标（见 coverage-baseline.json note），非永久豁免。
      thresholds: { lines: 48, branches: 39, functions: 40, statements: 46 },
      // src/main.tsx — 纯入口（ReactDOM.createRoot 挂载），无业务逻辑（shared
      // 的 index.ts 同先例）
      exclude: ['src/main.tsx'],
    }),
  },
});
