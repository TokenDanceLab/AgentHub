import { test, expect, type Page } from '@playwright/test';

test.describe('AgentHub Desktop smoke', () => {
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
    await expect(page.getByRole('button', { name: '使用 TokenDance ID 继续' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Local Edge/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '使用 Demo 模式继续' })).toBeVisible();
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
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '使用 Demo 模式继续' }).click();
  await expect(page.getByTestId('agenthub-workbench')).toBeVisible();
}
