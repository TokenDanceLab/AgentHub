import { desktopVitest } from './vitest.base';

// Desktop↔Edge real server E2E: builds and runs the actual Go Edge server
// (edge-real.test.ts, @vitest-environment node). Kept as its own config so
// it runs in the node environment (not jsdom) with a single worker (the test
// binds a fixed port) and a long hook timeout (the beforeAll `go build` can
// take up to 90s). This lane runs in desktop-linux-build (workflow_dispatch),
// which already has setup-go + pnpm install.
export default desktopVitest({
  environment: 'node',
  include: ['src/__tests__/integration/edge-real.test.ts'],
  setupFiles: [],
  maxWorkers: 1,
  testTimeout: 30_000,
  hookTimeout: 120_000,
});
