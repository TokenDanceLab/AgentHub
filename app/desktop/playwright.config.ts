import { defineConfig, devices } from '@playwright/test';

const desktopE2EPort = Number(process.env.AGENTHUB_DESKTOP_E2E_PORT ?? 5199);
const desktopE2EBaseURL = `http://127.0.0.1:${desktopE2EPort}`;
const desktopWorkspaceViewport = { width: 1440, height: 810 };

export default defineConfig({
  testDir: './src/__e2e__',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: desktopE2EBaseURL,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: desktopWorkspaceViewport },
    },
  ],
  webServer: {
    command: `pnpm dev --host 127.0.0.1 --port ${desktopE2EPort}`,
    url: desktopE2EBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
