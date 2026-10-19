import { desktopVitest } from './vitest.base';

export default desktopVitest({
  include: ['src/**/*.test.tsx'],
  exclude: ['src/__tests__/integration/**'],
  memoryLimit: '512MB',
  // 渲染重型 .tsx 用例（App.v4）在 512MB worker 负载下偶发超过默认 5s。
  testTimeout: 30_000,
  hookTimeout: 30_000,
});
