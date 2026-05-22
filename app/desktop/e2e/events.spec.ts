import { test, expect } from '@playwright/test';
import { isEdgeOnline } from './test-utils';

test.describe('EventLog', () => {
  test('event log container has log role for screen readers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('log')).toBeVisible({ timeout: 15_000 });
  });

  test.describe('when Edge is offline', () => {
    test('shows offline hint', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(online, 'Edge is running');

      await page.goto('/');
      await expect(page.getByText(/Start Edge Server/)).toBeVisible({ timeout: 15_000 });
    });
  });

  test.describe('when Edge is online', () => {
    test('renders either waiting state or replayed events', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.getByRole('log')).toBeVisible({ timeout: 15_000 });
    });

    test('displays lifecycle events after starting a mock run', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.getByText(/Online/)).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /Start Mock Run/ }).click();
      await expect(page.getByText(/run\./).first()).toBeVisible({ timeout: 15_000 });
    });

    test('clear events button resets the log', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.getByText(/Online/)).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /Start Mock Run/ }).click();
      await expect(page.getByText('run.finished').first()).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: /Clear Events/ }).click();
      await expect(page.getByText(/Waiting for events/)).toBeVisible({ timeout: 5_000 });
    });
  });
});
