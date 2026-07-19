import { defineConfig, devices } from '@playwright/test';

const webE2EPort = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const webE2EBaseURL = `http://127.0.0.1:${webE2EPort}`;
const webWorkspaceViewport = { width: 1440, height: 810 };

export default defineConfig({
  testDir: './src/__e2e__',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: webE2EBaseURL,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: webWorkspaceViewport },
    },
    {
      // Optional HiDPI geometry/e2e lane (#1308). Not default CI gate.
      name: 'chromium-2x',
      use: {
        ...devices['Desktop Chrome'],
        viewport: webWorkspaceViewport,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${webE2EPort}`,
    url: webE2EBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
  },
});
