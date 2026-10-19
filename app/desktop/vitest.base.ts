import path from 'node:path';
import { defineConfig, type UserConfig } from 'vitest/config';

type TestOptions = NonNullable<NonNullable<UserConfig>['test']>;

/**
 * Desktop 单测配置基座。
 *
 * desktop 有 7 个 vitest 入口（本地全量、CI 的 ts/tsx/integration/shared 拆分、
 * edge-real node lane）。它们共享同一套 React 单实例解析规则、jsdom 环境、
 * setup 文件、worker 预算和依赖预构建清单，真实差异只有 include/exclude、
 * 超时、worker 数和 coverage。此前每个入口各抄一份约 40 行的
 * resolve/alias/ssr 块，这里收敛成一份，入口只声明差异。
 *
 * 不进基座的项：memoryLimit（本地全量与 CI 分片策略不同）、timeout（只有
 * 渲染重型用例的入口需要放宽）、environment（edge-real 走 node）。
 */
export function desktopVitest(test: TestOptions = {}) {
  return defineConfig({
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, '..', 'shared', 'src'),
        '@testing-library/react': path.resolve(__dirname, 'node_modules', '@testing-library', 'react'),
        'lucide-react': path.resolve(__dirname, 'node_modules', 'lucide-react'),
        react: path.resolve(__dirname, 'node_modules', 'react'),
        'react-dom': path.resolve(__dirname, 'node_modules', 'react-dom'),
        'react-i18next': path.resolve(__dirname, 'node_modules', 'react-i18next'),
      },
    },
    server: { fs: { allow: ['..'] } },
    ssr: { noExternal: true },
    test: {
      globals: true,
      environment: 'jsdom',
      // Flake 重试政策 SSOT：docs/architecture/github-actions-ci-cd-policy.md。单元车道不重试（fail-closed）。
      retries: 0,
      setupFiles: ['./src/__tests__/setup.ts'],
      maxWorkers: 4,
      execArgv: ['--max-old-space-size=4096'],
      deps: {
        optimizer: {
          client: {
            include: ['@lobehub/fluent-emoji'],
          },
        },
      },
      ...test,
    },
  });
}
