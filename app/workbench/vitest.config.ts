import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { createCoverage } from '../test-config/coverage';

export default defineConfig({
  ssr: {
    noExternal: true,
  },
  resolve: {
    // 与 app/shared、app/web、app/desktop 同源：dedupe react/react-dom，
    // 避免测试图里出现两份 React（hooks + zustand v5 store 会失效）。
    dedupe: ['react', 'react-dom'],
    alias: {
      // workbench→shared 单向依赖（#1759）：深导入走 @shared 别名，与
      // web/desktop 既有约定一致；包级依赖在 package.json 声明。
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      // 测试套件横跨 shared 源码（@shared/testing/i18n 等）与 workbench
      // 源码，两个包各自的 node_modules 会解析出两份 react-i18next/i18next，
      // 导致测试 i18n 实例注册在另一份模块上、组件查不到翻译。与
      // desktop/web 的 vitest 配置相同，强制收敛到本包单一副本。
      '@testing-library/react': path.resolve(__dirname, 'node_modules', '@testing-library', 'react'),
      'i18next': path.resolve(__dirname, 'node_modules', 'i18next'),
      'react-i18next': path.resolve(__dirname, 'node_modules', 'react-i18next'),
      'react': path.resolve(__dirname, 'node_modules', 'react'),
      'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // 与 shared/desktop 配置一致的 worker 上限：全量测试时默认全核并发
    // 会导致 forks worker 启动/回收超时，限制并发后 coverage 全量运行稳定。
    maxWorkers: 4,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**', '**/reference/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: createCoverage({
      // 绝对 floors：2026-08-21 独立成包（#1759 第二阶段）首次实测后设定，
      // 规则同其他包：floor(实测)-1，低于 60 的维度是提升目标非永久豁免。
      thresholds: { lines: 59, branches: 52, functions: 52, statements: 59 },
      // workbenchProjectsPort.ts — 纯类型契约（#1546），零运行时语句
      exclude: ['src/workbenchProjectsPort.ts'],
    }),
  },
});
