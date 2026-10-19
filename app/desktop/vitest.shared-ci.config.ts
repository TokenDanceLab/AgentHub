import { desktopVitest } from './vitest.base';

// 兄弟包单测宿主配置（desktop 环境跑 shared + workbench 两套 suite）。
// 名字叫 shared-ci 是历史原因；现在同时承载 workbench。
export default desktopVitest({
  include: [
    '../shared/src/**/*.test.ts',
    '../shared/src/**/*.test.tsx',
    '../workbench/src/**/*.test.ts',
    '../workbench/src/**/*.test.tsx',
  ],
  memoryLimit: '512MB',
});
