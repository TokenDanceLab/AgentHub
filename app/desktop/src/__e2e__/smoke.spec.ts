import { test, expect, type Page } from '@playwright/test';
import { classifyE2ERequest } from '../../../shared/src/testing/e2eDataModeContract';
import { assertFontGuardHermetic, blockExternalFonts, type E2EFontGuard } from '../../../e2e/fontBlocker';

test.describe('AgentHub Desktop smoke', () => {
  let fontGuard: E2EFontGuard | undefined;

  // #2014 hermetic guard: intercept external font CDN requests and record
  // everything else, so smoke proves “zero font hits / zero production host
  // hits” without the full data-mode contract machinery.
  test.beforeEach(async ({ page }) => {
    fontGuard = await blockExternalFonts(page, { recordPassthrough: true });
  });

  test.afterEach(async ({}, testInfo) => {
    if (!fontGuard) {
      throw new Error('font guard was not installed before the test');
    }
    assertFontGuardHermetic(fontGuard);
    const passthroughByBoundary: Record<string, number> = {};
    for (const request of fontGuard.passthroughRequests) {
      const boundary = classifyE2ERequest(request.url);
      passthroughByBoundary[boundary] = (passthroughByBoundary[boundary] ?? 0) + 1;
    }
    await testInfo.attach('font-guard-report.json', {
      body: Buffer.from(JSON.stringify({
        interceptedFontRequests: fontGuard.fontRequests,
        passthroughByBoundary,
      }, null, 2)),
      contentType: 'application/json',
    });
  });

  test('app loads without crash', async ({ page }) => {
    await page.goto('/');
    // Wait for React to hydrate by confirming #root has child content
    const root = page.locator('#root');
    await root.waitFor({ state: 'visible' });
    // Ensure at least one child element was rendered by React
    await expect(root.locator('> *').first()).toBeAttached();
  });

  test('entry gate is visible before a mode is selected', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'Desktop entry' })).toBeVisible();
    // Desktop i18n follows navigator.language; Playwright defaults to en-US,
    // so entry buttons must match both locales (#2001, same rot as #1995).
    await expect(
      page.getByRole('button', { name: /^(使用 TokenDance ID 继续|Continue with TokenDance ID)$/ })
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /Local Edge/ })).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^(使用 Demo 模式继续|Continue in Demo mode)$/ })
    ).toBeVisible();
  });

  test('Workspace shell is visible after entering demo mode', async ({ page }) => {
    await enterDemoWorkbench(page);
    await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
  });

  test('v4 composer is visible and has textarea after entering demo mode', async ({ page }) => {
    await enterDemoWorkbench(page);
    // The textarea exists but may be disabled when the backend is offline.
    // Verify it is present in the DOM and visible.
    const textarea = page.getByLabel('Composer input');
    await expect(textarea).toBeVisible();
    // Verify the textarea has the correct initial state
    await expect(textarea).toHaveValue('');
  });

  test('Agent navigation entry exists after entering demo mode', async ({ page }) => {
    await enterDemoWorkbench(page);
    await expect(page.getByRole('navigation', { name: 'Global rail' }).getByRole('button', { name: 'Agent' })).toBeVisible();
  });

  test('v4 sidebar navigation is rendered after entering demo mode', async ({ page }) => {
    await enterDemoWorkbench(page);
    // Verify shared workbench navigation is present.
    const navs = page.getByRole('navigation');
    await expect(navs.first()).toBeVisible();
    expect(await navs.count()).toBeGreaterThanOrEqual(1);
  });
});

async function enterDemoWorkbench(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      // First-run onboarding (#1819) is a one-time product overlay; this
      // suite tests smoke behavior, so seed it as seen (persisted state)
      // to keep the mock workbench deterministically interactive (#2001).
      window.localStorage.setItem('agenthub_onboarding_seen', 'true');
    } catch {
      // Some initial browser documents deny localStorage; the app origin will still run this script.
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const demoButton = page.getByRole('button', {
    name: /^(使用 Demo 模式继续|Continue in Demo mode)$/,
  });
  await demoButton.click();
  await expect(page.getByTestId('agenthub-workbench')).toBeVisible();
}
