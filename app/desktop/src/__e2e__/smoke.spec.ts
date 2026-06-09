import { test, expect } from '@playwright/test';

test.describe('AgentHub Desktop smoke', () => {
  test('app loads without crash', async ({ page }) => {
    await page.goto('/');
    // Wait for React to hydrate by confirming #root has child content
    const root = page.locator('#root');
    await root.waitFor({ state: 'visible' });
    // Ensure at least one child element was rendered by React
    await expect(root.locator('> *').first()).toBeAttached();
  });

  test('Workspace shell is visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'Workspace' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Demo main chain status' })).toBeVisible();
  });

  test('v4 composer is visible and has textarea', async ({ page }) => {
    await page.goto('/');
    // The textarea exists but may be disabled when the backend is offline.
    // Verify it is present in the DOM and visible.
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    // Verify the textarea has the correct initial state
    await expect(textarea).toHaveValue('');
  });

  test('Agent navigation entry exists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Global rail' }).getByRole('button', { name: 'Agent' })).toBeVisible();
  });

  test('v4 sidebar navigation is rendered', async ({ page }) => {
    await page.goto('/');
    // Verify shared workbench navigation is present.
    const navs = page.getByRole('navigation');
    await expect(navs.first()).toBeVisible();
    expect(await navs.count()).toBeGreaterThanOrEqual(1);
  });
});
