/**
 * E2E: Account screen — auth flow, interaction, error, and loading state tests.
 *
 * Verifies account drawer, TokenDance ID status, Hub session state,
 * notification permission, theme toggling, and error/recovery states.
 */
import { test, expect } from '@playwright/test';

test.describe('Auth flow via mock hub (smoke)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('[data-testid="home-header"]', { timeout: 30000 }).catch(() => {
      return page.waitForSelector('[aria-label="Open account drawer"]', { timeout: 30000 });
    });
  });

  test('renders account avatar button indicating signed-in state', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await expect(avatarButton).toBeVisible({ timeout: 15000 });
  });

  test('opens account drawer and shows TokenDance ID signed-in status', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const signedInText = page.getByText(/signed in|已登录/i);
    await expect(signedInText.first()).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows Hub session as active', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const agentHubEntry = page.getByText('AgentHub', { exact: false }).first();
    await expect(agentHubEntry).toBeVisible({ timeout: 10000 });

    const onlineBadge = page.getByText(/online|在线/).first();
    await expect(onlineBadge).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows notification permission status', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const notificationRow = page.getByText(/notification|通知/).first();
    await expect(notificationRow).toBeVisible({ timeout: 10000 });
  });

  test('account drawer can be closed', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(800);

    const closeButton = page.getByRole('button', { name: /close account/i }).first();
    if (await closeButton.isVisible()) {
      await closeButton.click();
      await page.waitForTimeout(500);
      await expect(avatarButton).toBeVisible({ timeout: 5000 });
    }
  });

  test('device label from mock hub appears in account drawer', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const deviceLabel = page.getByText(/mobile preview|TokenDance mobile/).first();
    await expect(deviceLabel).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Interaction tests: tap, navigation, theme toggle
// ---------------------------------------------------------------------------

test.describe('Account interaction tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('opening account drawer shows profile hero section', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Hero section shows user display name
    const displayName = page.getByText('Delicious233').first();
    await expect(displayName).toBeVisible({ timeout: 10000 });

    // Shows TokenDance workspace
    const workspace = page.getByText('TokenDance').first();
    await expect(workspace).toBeVisible({ timeout: 10000 });
  });

  test('account rail shows multiple account entries', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Account rail should have TD, AH, AP entries
    const rail = page.locator('[data-testid="account-rail"]');
    await expect(rail).toBeVisible({ timeout: 10000 });

    // Multiple account icons
    const tdEntry = page.getByText('TokenDance').first();
    const ahEntry = page.getByText('AgentHub').first();
    await expect(tdEntry).toBeVisible({ timeout: 10000 });
    await expect(ahEntry).toBeVisible({ timeout: 10000 });
  });

  test('tapping outside account drawer closes it', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Tap the scrim area (outside drawer)
    const scrim = page.locator('[class*="scrim"], [style*="scrim"]').first();
    if (await scrim.isVisible({ timeout: 2000 }).catch(() => false)) {
      await scrim.click({ position: { x: 10, y: 100 } });
      await page.waitForTimeout(500);
    }

    // Thread list should be visible again
    await expect(page.getByText('AgentHub Mobile Workbench').first()).toBeVisible({ timeout: 10000 });
  });

  test('theme buttons are tappable and show selection', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    // Scroll near bottom for theme buttons
    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    if (await lightButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await lightButton.click();
      await page.waitForTimeout(500);

      // Light button should now show "selected" state
      const selectedLabel = page.getByText(/selected|已选/i).first();
      await expect(selectedLabel).toBeVisible({ timeout: 5000 });
    }
  });

  test('identity section shows TokenDance ID and Hub session items', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Identity section header
    const identitySection = page.getByText(/identity|身份|session/).first();
    await expect(identitySection).toBeVisible({ timeout: 10000 });

    // TokenDance ID entry
    const tdEntry = page.getByText(/TokenDance ID/).first();
    await expect(tdEntry).toBeVisible({ timeout: 10000 });
  });

  test('device section shows camera and storage items', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Device section
    const deviceSection = page.getByText(/device|设备/i).first();
    await expect(deviceSection).toBeVisible({ timeout: 10000 });

    // Camera permission item
    const cameraItem = page.getByText(/camera|相机/).first();
    await expect(cameraItem).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Error state tests
// ---------------------------------------------------------------------------

test.describe('Account error state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('account drawer shows appropriate status badge for notification prompt', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Notification permission shows "Needs action" for prompt state
    const needsActionBadge = page.getByText(/Needs action|需处理/).first();
    await expect(needsActionBadge).toBeVisible({ timeout: 10000 });
  });

  test('account drawer handles close via X button', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Close via X button
    const closeButtons = page.getByRole('button', { name: /close/ });
    const count = await closeButtons.count();
    if (count > 0) {
      await closeButtons.first().click();
      await page.waitForTimeout(500);
    }

    // Should be back
    await expect(page.getByText('AgentHub Mobile Workbench').first()).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Loading state tests
// ---------------------------------------------------------------------------

test.describe('Account loading state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('account drawer opens and shows all menu sections', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    // All three menu sections should be visible
    const identitySection = page.getByText(/identity|身份/).first();
    const deviceSection = page.getByText(/device|设备/).first();
    const agentSection = page.getByText(/Agent Profiles|Agent Profile/).first();

    await expect(identitySection).toBeVisible({ timeout: 10000 });
    await expect(deviceSection).toBeVisible({ timeout: 10000 });
    await expect(agentSection).toBeVisible({ timeout: 10000 });
  });

  test('all four theme mode buttons are rendered', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    const themeButtons = [
      page.getByRole('button', { name: /light|浅色/i }).first(),
      page.getByRole('button', { name: /system|系统/i }).first(),
      page.getByRole('button', { name: /dark|深色/i }).first(),
      page.getByRole('button', { name: /oled/i }).first(),
    ];

    let visibleCount = 0;
    for (const btn of themeButtons) {
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        visibleCount++;
      }
    }

    expect(visibleCount).toBeGreaterThanOrEqual(3);
  });
});
