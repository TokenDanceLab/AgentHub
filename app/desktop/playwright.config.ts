import { defineConfig, devices } from '@playwright/test';

const desktopE2EPort = Number(process.env.AGENTHUB_DESKTOP_E2E_PORT ?? 5199);
const desktopE2EBaseURL = `http://127.0.0.1:${desktopE2EPort}`;
const desktopWorkspaceViewport = { width: 1440, height: 810 };

export default defineConfig({
  testDir: './src/__e2e__',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Flake retry policy SSOT: docs/governance/known-flaky.md. Budget stays 0
  // (fail-closed); raising it needs a registry entry with a review deadline.
  retries: 0,
  use: {
    baseURL: desktopE2EBaseURL,
    navigationTimeout: 60_000,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: desktopWorkspaceViewport },
    },
    {
      // Optional HiDPI geometry/e2e lane (#1308). Not default CI gate.
      name: 'chromium-2x',
      use: {
        ...devices['Desktop Chrome'],
        viewport: desktopWorkspaceViewport,
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${desktopE2EPort}`,
    env: {
      ...process.env,
      // Keep renderer E2E deterministic and fail closed if a Hub route is
      // missing; no browser test should reach a live API by default.
      VITE_HUB_URL: 'https://hub.test.invalid',
      VITE_HUB_WS_URL: 'wss://hub.test.invalid/client/ws',
    },
    url: desktopE2EBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 45_000,
  },
});
