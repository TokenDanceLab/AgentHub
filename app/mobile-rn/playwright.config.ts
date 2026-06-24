import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/__e2e__',
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5177',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
      },
    },
  ],
  webServer: [
    {
      command: 'node scripts/mock-hub.mjs',
      port: 8088,
      reuseExistingServer: true,
      cwd: '.',
    },
    {
      command: 'npx expo start --web --port 5177',
      port: 5177,
      reuseExistingServer: true,
      timeout: 180000,
      cwd: '.',
    },
  ],
});
