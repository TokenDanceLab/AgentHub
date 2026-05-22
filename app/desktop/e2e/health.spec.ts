import { test, expect } from '@playwright/test';
import { isEdgeOnline } from './test-utils';

test.describe('StatusBar', () => {
  test.describe('when Edge is offline', () => {
    test('shows offline text', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(online, 'Edge is running — stop it to run offline tests');

      await page.goto('/');
      await expect(page.getByRole('status')).toBeVisible();
      await expect(page.getByText(/Offline/)).toBeVisible({ timeout: 15_000 });
    });

    test('shows red offline dot', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(online, 'Edge is running');

      await page.goto('/');
      await expect(page.getByTestId('status-dot-offline')).toBeVisible();
    });
  });

  test.describe('when Edge is online', () => {
    test('shows online text with version', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running — start: cd edge-server && go run ./cmd/agenthub-edge');

      await page.goto('/');
      await expect(page.getByRole('status')).toBeVisible();
      await expect(page.getByText(/Online/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/v1/)).toBeVisible();
    });

    test('shows green online dot', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.getByTestId('status-dot-online')).toBeVisible();
    });

    test('shows WebSocket connection status', async ({ page }) => {
      const online = await isEdgeOnline(page);
      test.skip(!online, 'Edge not running');

      await page.goto('/');
      await expect(page.getByText(/WS:/)).toBeVisible({ timeout: 15_000 });
    });
  });

  test('does not show an alert on initial load', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('disables run start while Edge is offline', async ({ page }) => {
    const online = await isEdgeOnline(page);
    test.skip(online, 'Edge is running');

    await page.goto('/');
    await expect(page.getByRole('button', { name: /Start Mock Run/ })).toBeDisabled();
  });
});
