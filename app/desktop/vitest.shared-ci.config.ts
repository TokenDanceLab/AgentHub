import { defineConfig } from 'vitest/config';
import path from 'path';

// 兄弟包单测宿主配置（desktop 环境跑 shared + workbench 两套 suite）。
// 名字叫 shared-ci 是历史原因（#1759 第二阶段起同时承载 workbench）。
export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
      '@testing-library/react': path.resolve(__dirname, 'node_modules', '@testing-library', 'react'),
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
    include: [
      '../shared/src/**/*.test.ts',
      '../shared/src/**/*.test.tsx',
      '../workbench/src/**/*.test.ts',
      '../workbench/src/**/*.test.tsx',
    ],
    setupFiles: ['./src/__tests__/setup.ts'],
    execArgv: ['--max-old-space-size=4096'],
    memoryLimit: '512MB',
    maxWorkers: 4,
    deps: {
      optimizer: {
        client: {
          include: ['@lobehub/fluent-emoji'],
        },
      },
    },
  },
});
