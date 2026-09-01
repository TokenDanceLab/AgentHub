import { defineConfig } from 'vitest/config';
import path from 'path';

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
    include: ['src/**/*.test.tsx'],
    exclude: ['src/__tests__/integration/**'],
    setupFiles: ['./src/__tests__/setup.ts'],
    execArgv: ['--max-old-space-size=4096'],
    memoryLimit: '512MB',
    maxWorkers: 4,
    // FLK-004：渲染重型 .tsx 用例（App.v4）在 512MB worker 负载下偶发超过默认 5s。
    testTimeout: 30_000,
    hookTimeout: 30_000,
    deps: {
      optimizer: {
        client: {
          include: ['@lobehub/fluent-emoji'],
        },
      },
    },
  },
});
