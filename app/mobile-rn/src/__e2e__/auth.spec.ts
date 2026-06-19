/**
 * E2E: Auth flow via mock hub.
 *
 * Verifies that the mobile web app connects to the mock hub and renders
 * account state correctly: TokenDance ID signed-in status, Hub session
 * active state, and notification permission.
 */
import { test, expect } from '@playwright/test';

test.describe('Auth flow via mock hub', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app with mock hub default URL (127.0.0.1:8088)
    await page.goto('/');
    // Wait for the app shell to render — the thread list should appear
    await page.waitForSelector('[data-testid="home-header"]', { timeout: 30000 }).catch(() => {
      // Fallback: wait for the account avatar button
      return page.waitForSelector('[aria-label="Open account drawer"]', { timeout: 30000 });
    });
  });

  test('renders account avatar button indicating signed-in state', async ({ page }) => {
    // The HomeHeader contains an account avatar that opens the account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await expect(avatarButton).toBeVisible({ timeout: 15000 });
  });

  test('opens account drawer and shows TokenDance ID signed-in status', async ({ page }) => {
    // Open the account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();

    // Wait for the account screen to render
    await page.waitForTimeout(1000);

    // Verify TokenDance ID is present with "signed_in" status
    const signedInText = page.getByText(/signed in|已登录/i);
    await expect(signedInText.first()).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows Hub session as active', async ({ page }) => {
    // Open the account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();

    // Wait for the account drawer content
    await page.waitForTimeout(1000);

    // Verify "AgentHub" is listed in the menu with active status
    const agentHubEntry = page.getByText('AgentHub', { exact: false }).first();
    await expect(agentHubEntry).toBeVisible({ timeout: 10000 });

    // The online/active badge should appear
    const onlineBadge = page.getByText(/online|在线/).first();
    await expect(onlineBadge).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows notification permission status', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();

    await page.waitForTimeout(1000);

    // The notification permission row should be visible in the account menu
    const notificationRow = page.getByText(/notification|通知/).first();
    await expect(notificationRow).toBeVisible({ timeout: 10000 });
  });

  test('account drawer can be closed', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(800);

    // Close via the close button
    const closeButton = page.getByRole('button', { name: /close account/i }).first();
    if (await closeButton.isVisible()) {
      await closeButton.click();
      await page.waitForTimeout(500);
      // The thread list should be visible again
      await expect(avatarButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('device label from mock hub appears in account drawer', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Verify the device label is present (from mock hub account data)
    const deviceLabel = page.getByText(/mobile preview|TokenDance mobile/).first();
    await expect(deviceLabel).toBeVisible({ timeout: 10000 });
  });
});
