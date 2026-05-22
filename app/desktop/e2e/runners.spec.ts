import { test, expect } from '@playwright/test';
import { isEdgeOnline } from './test-utils';

test.describe('RunnerList', () => {
  test('sidebar has navigation role', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: /Runners/ })).toBeVisible();
  });

  test.describe('when Edge is offline', () => {
    test('shows waiting message', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(online, 'Edge is running');

      await page.goto('/');
      await expect(page.getByText(/Waiting for Edge/)).toBeVisible({ timeout: 15_000 });
    });

    test('shows no runner items', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(online, 'Edge is running');

      await page.goto('/');
      await expect(page.getByRole('listitem')).toHaveCount(0);
    });
  });

  test.describe('when Edge is online', () => {
    test('shows mock runner', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.getByText(/Mock/)).toBeVisible({ timeout: 15_000 });
    });

    test('runners have accessible status labels', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.locator('[aria-label*="online"]').first()).toBeVisible({ timeout: 15_000 });
    });
  });
});
