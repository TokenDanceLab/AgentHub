import { test, expect } from '@playwright/test';

test.describe('AgentHub smoke tests', () => {
  test('app loads without crash', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });

  test('page has title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/AgentHub/);
  });

  test('app root is mounted without the Vite error overlay', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#root > div')).toHaveCount(1);
    await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  });
});
