import { expect, test, type Page } from '@playwright/test';
import {
  WORKBENCH_DATA_MODE_STORAGE_KEY,
} from '../../../shared/src/demo/dataMode';
import {
  assertE2EDataModeScenario,
  classifyE2ERequest,
  createE2EDataModeScenario,
  resolveE2ERequestDecision,
  type E2EObservedRequest,
  type E2ERequestBoundary,
  type E2ERequestPhase,
} from '../../../shared/src/testing/e2eDataModeContract';

const DESKTOP_E2E_PORT = Number(process.env.AGENTHUB_DESKTOP_E2E_PORT ?? 5199);
const DESKTOP_E2E_APP_ORIGIN = `http://127.0.0.1:${DESKTOP_E2E_PORT}`;

const DESKTOP_DEMO_BOUNDARY_SCENARIO = createE2EDataModeScenario({
  name: 'desktop-demo-entry-workbench-boundary',
  surface: 'desktop',
  dataMode: 'mock',
  dataSource: 'local-mock',
  appOrigin: DESKTOP_E2E_APP_ORIGIN,
  mockAdapterUsed: true,
});

interface DesktopBackendRequestLog {
  requests: E2EObservedRequest[];
  markWorkbenchRuntime: () => void;
}

test.describe('Desktop data boundary', () => {
  test('keeps Local Edge health as entry-preflight and blocks Demo workbench runtime backends', async ({ page }) => {
    const backendRequests = await collectDesktopBackendRequests(page);

    await resetDataModeOverride(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('main', { name: 'Desktop entry' })).toBeVisible();

    await expect.poll(() => countRequests(backendRequests.requests, {
      boundary: 'local-edge',
      phase: 'entry-preflight',
      pathname: '/v1/health',
    })).toBeGreaterThan(0);

    backendRequests.markWorkbenchRuntime();
    await page.getByRole('button', { name: '使用 Demo 模式继续' }).click();
    await expect(page.getByTestId('agenthub-workbench')).toBeVisible();
    await expect(page.getByTestId('agenthub-workbench')).toHaveAttribute('data-data-mode', 'mock');

    await page.waitForTimeout(1_000);

    const runtimeBackends = backendRequests.requests.filter((request) =>
      request.phase === 'workbench-runtime' &&
      isBackendBoundary(classifyE2ERequest(request.url, DESKTOP_DEMO_BOUNDARY_SCENARIO))
    );
    expect(runtimeBackends, formatRequests(runtimeBackends)).toEqual([]);
    assertE2EDataModeScenario(DESKTOP_DEMO_BOUNDARY_SCENARIO, backendRequests.requests);
  });
});

async function resetDataModeOverride(page: Page): Promise<void> {
  await page.addInitScript((storageKey) => {
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // Hardened browser contexts can deny storage before the app origin loads.
    }
  }, WORKBENCH_DATA_MODE_STORAGE_KEY);
}

async function collectDesktopBackendRequests(page: Page): Promise<DesktopBackendRequestLog> {
  const requests: E2EObservedRequest[] = [];
  let phase: E2ERequestPhase = 'entry-preflight';

  await page.route('**/*', async (route) => {
    const request = route.request();
    const decision = resolveE2ERequestDecision(DESKTOP_DEMO_BOUNDARY_SCENARIO, {
      method: request.method(),
      url: request.url(),
      phase,
    });

    if (decision.action === 'continue') {
      await route.continue();
      return;
    }

    if (decision.shouldRecord) {
      requests.push(decision.request);
    }

    if (decision.action === 'fulfill-scenario-backend') {
      await route.fulfill({
        contentType: 'application/json',
        status: 200,
        body: JSON.stringify({
          status: 'ok',
          version: 'desktop-boundary-fixture',
          edgeId: 'local-edge-entry-preflight',
          fixture_only: true,
          boundary: decision.boundary,
          phase: decision.phase,
        }),
      });
      return;
    }

    if (decision.action === 'block-forbidden-backend') {
      await route.fulfill({
        contentType: 'application/json',
        status: 503,
        body: JSON.stringify({
          error: 'blocked_by_e2e_data_mode_contract',
          fixture_only: true,
          boundary: decision.boundary,
          phase: decision.phase,
        }),
      });
      return;
    }

    if (decision.action === 'abort-external-http') {
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  return {
    requests,
    markWorkbenchRuntime: () => {
      phase = 'workbench-runtime';
    },
  };
}

function countRequests(
  requests: E2EObservedRequest[],
  expected: { boundary: E2ERequestBoundary; phase: E2ERequestPhase; pathname?: string },
): number {
  return requests.filter((request) => {
    if (request.phase !== expected.phase) return false;
    if (classifyE2ERequest(request.url, DESKTOP_DEMO_BOUNDARY_SCENARIO) !== expected.boundary) return false;
    if (!expected.pathname) return true;
    try {
      return new URL(request.url).pathname === expected.pathname;
    } catch {
      return false;
    }
  }).length;
}

function isBackendBoundary(boundary: E2ERequestBoundary): boolean {
  return (
    boundary === 'hub' ||
    boundary === 'local-edge' ||
    boundary === 'tokendance-id' ||
    boundary === 'gateway'
  );
}

function formatRequests(requests: E2EObservedRequest[]): string {
  return requests.length === 0
    ? 'No workbench-runtime backend requests were recorded.'
    : requests.map((request) => `${request.phase ?? 'workbench-runtime'} ${request.method} ${request.url}`).join('\n');
}
