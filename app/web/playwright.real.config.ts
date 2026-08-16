import { defineConfig, devices } from '@playwright/test';

// Real-services E2E lane (L3, #1678 e2e layout convergence).
//
// Runs app/e2e/chat-real.spec.ts against the web dev server wired to the live
// local stack: Hub (http://127.0.0.1:8080) + Edge (http://127.0.0.1:3210).
// chat-real.spec.ts lives at the cross-package app/e2e/ (not app/web/src/__e2e__)
// because it references the full Hub+Edge stack; the Web Hub-only boundary gate
// forbids Local Edge references under app/web/src/. Unlike playwright.config.ts
// (the CI stubbed-hub config), this config does NOT override VITE_HUB_URL /
// VITE_HUB_WS_URL — the dev server keeps its default live-local endpoints, so
// real login/chat flows reach real services.
//
// CI status: never run in CI (e2e-smoke only runs smoke.spec.ts under
// playwright.config.ts). Run locally with all services up:
//   pnpm test:e2e:real

export default defineConfig({
  testDir: '../e2e',
  testMatch: 'chat-real.spec.ts',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
  },
});
