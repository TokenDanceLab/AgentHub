import { expect, test, type Page } from '@playwright/test';
import {
  DESKTOP_WORKSPACE_VIEWPORT,
  evaluateSidebarVsTerminalDock,
  type GeometryRect,
} from '../../../shared/src/testing/geometrySmoke';

/**
 * Desktop geometry smoke (#1284) — mock/demo workbench with localTerminal dock.
 * Asserts conversation sidebar does not intersect the terminal dock.
 */
test.describe('Desktop geometry smoke (#1284)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('keeps conversation sidebar clear of the terminal dock', async ({ page }) => {
    collectPageDiagnostics(page);
    await blockLiveBackends(page);
    await enterDemoWorkbench(page);

    expect(page.viewportSize()).toEqual(DESKTOP_WORKSPACE_VIEWPORT);
    await expect(page.getByTestId('agenthub-workbench')).toBeVisible();
    await expect(page.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'chat');

    const dock = page.getByTestId('workbench-terminal-dock');
    await expect(dock).toBeVisible({ timeout: 15_000 });

    const sidebar = page
      .getByRole('complementary', { name: /conversation sidebar|会话|对话/i })
      .or(page.locator('aside[aria-label]').filter({ has: page.locator('input[type="search"]') }))
      .first();
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    await page.waitForTimeout(300);

    const sidebarBox = await toGeometryRect(sidebar);
    const dockBox = await toGeometryRect(dock);
    expect(sidebarBox, 'sidebar bounding box').not.toBeNull();
    expect(dockBox, 'terminal dock bounding box').not.toBeNull();
    if (sidebarBox === null || dockBox === null) {
      throw new Error('sidebar/dock bounding boxes were null after assertion');
    }

    const result = evaluateSidebarVsTerminalDock(sidebarBox, dockBox);
    expect(result, result.reason ?? 'sidebar vs terminal dock geometry').toMatchObject({ ok: true });
  });
});

async function toGeometryRect(
  locator: ReturnType<Page['locator']> | ReturnType<Page['getByTestId']> | ReturnType<Page['getByRole']>,
): Promise<GeometryRect | null> {
  const box = await locator.boundingBox();
  if (!box) return null;
  return {
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
  };
}

async function enterDemoWorkbench(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('agenthub.workbench.composerSubmitBehavior');
      window.localStorage.setItem('agenthub.workbench.dataMode', 'mock');
    } catch {
      // Some initial browser documents deny localStorage; app origin still runs this.
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const demoButton = page.getByRole('button', { name: /^(使用 Demo 模式继续|Continue in Demo mode)$/ });
  const workbench = page.getByTestId('agenthub-workbench');
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click();
  }
  await workbench.waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('main', { name: 'Workspace' }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function blockLiveBackends(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (
      url.includes('localhost:8080') ||
      url.includes('127.0.0.1:8080') ||
      url.includes('localhost:3210') ||
      url.includes('127.0.0.1:3210') ||
      url.includes('hub.vectorcontrol.tech') ||
      url.includes('api.hub.vectorcontrol.tech')
    ) {
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'blocked_by_geometry_smoke' }),
      });
    }
    return route.continue();
  });
}

function collectPageDiagnostics(page: Page): void {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (
        text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") ||
        text.includes('WebSocket connection') ||
        text.includes('Failed to load resource')
      ) {
        return;
      }
      console.log(`[browser:${message.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
  });
}
