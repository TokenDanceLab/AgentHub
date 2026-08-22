import { defineConfig, devices } from '@playwright/test';

const webE2EPort = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const webE2EBaseURL = `http://127.0.0.1:${webE2EPort}`;
const webWorkspaceViewport = { width: 1440, height: 810 };

export default defineConfig({
  testDir: './src/__e2e__',
  // chat-real.spec.ts needs the live Hub+Edge stack and is driven by
  // playwright.real.config.ts (pnpm test:e2e:real) instead (#1678).
  testIgnore: ['**/chat-real.spec.ts'],
  // Hydration budgets: on loaded dev boxes (live dev stack / parallel CI
  // lanes) the first vite compilation + Hub stub hydration can exceed the
  // historical 10s expect / 60s navigation windows, so the windows carry
  // headroom. Assertions still fail closed once the budget is exhausted.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  use: {
    baseURL: webE2EBaseURL,
    navigationTimeout: 120_000,
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
    env: {
      ...process.env,
      // The browser auth client defaults its callback to the origin root.
      // Keep renderer E2E on that same base instead of Vite's production
      // /workbench/ asset base.
      VITE_BASE_PATH: '/',
      // Renderer specs must intercept every Hub call. Reserved origins make a
      // missing route fail closed instead of reaching localhost or production.
      VITE_HUB_URL: 'https://hub.test.invalid',
      VITE_HUB_WS_URL: 'wss://hub.test.invalid/client/ws',
    },
    url: webE2EBaseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
