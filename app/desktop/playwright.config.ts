import { defineConfig, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const desktopE2EPort = Number(process.env.AGENTHUB_DESKTOP_E2E_PORT ?? 5199);
const desktopE2EBaseURL = `http://127.0.0.1:${desktopE2EPort}`;
const desktopWorkspaceViewport = { width: 1440, height: 810 };

// (#2003) Reap any leftover listener on the E2E port before Playwright checks
// whether the URL is already available. `reuseExistingServer: false` alone only
// throws on an occupied port — it does not kill the occupant — so a stale dev
// server would otherwise abort the run instead of being replaced by a fresh
// server carrying the test env below. Best effort: on failure we fall through
// and stay fail-closed via reuseExistingServer:false.
//
// Only the launcher process may reap: workers also import this config but by
// the time they run, the launcher has already cleared the port and owns the
// dev server, so a worker re-reaping would kill that server mid-run.
const isPlaywrightWorker = process.env.TEST_WORKER_INDEX !== undefined;
const reapScript = path.resolve(process.cwd(), 'scripts', 'reap-e2e-port.mjs');
if (!isPlaywrightWorker && existsSync(reapScript)) {
  try {
    execFileSync(process.execPath, [reapScript, String(desktopE2EPort)], {
      stdio: 'inherit',
      timeout: 20_000,
    });
  } catch {
    // Fall through; reuseExistingServer:false below refuses an occupied port.
  }
}

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
      //
      // `hub.test.invalid` is a fail-closed sentinel, not a real endpoint and
      // not an assertion basis. `.invalid` is reserved (RFC 6761) and never
      // resolves, so any accidental Hub request dies locally instead of
      // reaching production. It is deliberately NOT part of the data-mode
      // contract HUB_HOSTS (app/shared/src/testing/e2eDataModeContract.ts): a
      // request to it classifies as `other-http`, which test route
      // interception aborts without recording, so it never reaches
      // assertE2EDataModeScenario. Do not assert against this host.
      VITE_HUB_URL: 'https://hub.test.invalid',
      VITE_HUB_WS_URL: 'wss://hub.test.invalid/client/ws',
    },
    url: desktopE2EBaseURL,
    // (#2003) Never reuse an existing server, even locally. With
    // `!process.env.CI` a leftover dev server on the port (manual `pnpm dev`
    // or an interrupted Playwright child) was silently reused, so the `env`
    // block above never applied and HUB_URL fell back to the production
    // default. Combined with the port reap at the top of this file, an
    // occupied port is cleared first and Playwright always launches a fresh
    // server carrying the test env; if the port cannot be cleared this stays
    // fail-closed and errors instead of silently reusing the wrong server.
    reuseExistingServer: false,
    timeout: 45_000,
  },
});
