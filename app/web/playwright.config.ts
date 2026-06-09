import { defineConfig, devices } from '@playwright/test';

const webE2EPort = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const webE2EBaseURL = `http://localhost:${webE2EPort}`;

export default defineConfig({
  testDir: './src/__e2e__',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: webE2EBaseURL,
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${webE2EPort}`,
    url: webE2EBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
