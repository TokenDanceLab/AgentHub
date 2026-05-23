import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/__e2e__',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: 'http://localhost:5199',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --port 5199',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
