import { defineConfig } from 'vitest/config';
import path from 'path';

// Desktop↔Edge real server E2E: builds and runs the actual Go Edge server
// (edge-real.test.ts, @vitest-environment node). Kept as its own config so
// it runs in the node environment (not jsdom) with a single worker (the test
// binds a fixed port) and a long hook timeout (the beforeAll `go build` can
// take up to 90s). This lane runs in desktop-linux-build (workflow_dispatch),
// which already has setup-go + pnpm install.
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
    environment: 'node',
    include: ['src/__tests__/integration/edge-real.test.ts'],
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
