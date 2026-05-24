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

  test('critical UI shell is visible', async ({ page }) => {
    await page.goto('/');
    // Brand logo or heading should render within 5s
    await expect(page.locator('h1, [data-testid="brand"]').first()).toBeVisible({ timeout: 5_000 });
  });
});
