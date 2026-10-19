import { createCoverage } from '../test-config/coverage';
import { desktopVitest } from './vitest.base';

export default desktopVitest({
  include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  exclude: ['src/__tests__/integration/**'],
  execArgv: ['--max-old-space-size=8192'],
  memoryLimit: '512MB',
  // 渲染重型 .tsx 用例在 512MB worker 负载下偶发超过默认 5s。
  testTimeout: 30_000,
  hookTimeout: 30_000,
  coverage: createCoverage({
    // 绝对 floors（含全部生产源码进分母）：lines 48 / branches 39 /
    // functions 40 / statements 46。
    // 全部低于 60 是提升目标（coverage thresholds 见本文件），非永久豁免。
    thresholds: { lines: 48, branches: 39, functions: 40, statements: 46 },
    // src/main.tsx — 纯入口（ReactDOM.createRoot 挂载），无业务逻辑
    exclude: ['src/main.tsx'],
  }),
});
