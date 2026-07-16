import { test, expect } from '@playwright/test';

/**
 * AH-SR-044 / #465: product inventory is Runtime + Execution Target health.
 * Edge `/v1/runners` remains diagnostics-only; the legacy RunnerList product UI is gone.
 */
test.describe('Runtime inventory (runners demoted)', () => {
  test('product shell does not expose RunnerList navigation as inventory SSOT', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('navigation', { name: /Runners/i })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Runners$/i })).toHaveCount(0);
  });
});
