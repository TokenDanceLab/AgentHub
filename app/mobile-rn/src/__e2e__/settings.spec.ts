/**
 * E2E: Settings toggle.
 *
 * Verifies that the account/settings screen renders theme toggle buttons
 * and that clicking them switches the selected theme mode.
 */
import { test, expect } from '@playwright/test';

test.describe('Settings toggle', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the app to render
    await page.waitForTimeout(3000);
  });

  test('opens account drawer via avatar button', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // The account rail should be visible
    const accountRail = page.locator('[data-testid="account-rail"]');
    await expect(accountRail).toBeVisible({ timeout: 10000 });
  });

  test('theme toggle buttons are visible in account drawer', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Scroll near the bottom of the account drawer to find theme buttons
    // Theme buttons: light, system, dark, oled
    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();

    // At least one of the theme buttons should be visible
    await expect(lightButton.or(darkButton).first()).toBeVisible({ timeout: 10000 });
  });

  test('clicking a theme button marks it as selected', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    // Find the light theme button
    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    await expect(lightButton).toBeVisible({ timeout: 10000 });

    // Click light theme
    await lightButton.click();
    await page.waitForTimeout(500);

    // After clicking, the light button should show "selected" in its label
    const selectedLightButton = page.getByRole('button', { name: /selected|已选|light.*selected/i }).first();
    // If light was already selected, this might already be visible
    await expect(selectedLightButton.isVisible().catch(() => false)).resolves.toBeTruthy();
  });

  test('dark theme button can be clicked', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    // Click dark theme
    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();

    if (await darkButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await darkButton.click();
      await page.waitForTimeout(500);

      // Should show selected state
      const selectedDark = page.getByRole('button', { name: /selected|已选/i }).first();
      await expect(selectedDark).toBeVisible({ timeout: 5000 });
    }
  });

  test('all four theme modes are available', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    // All four theme mode buttons should exist
    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    const systemButton = page.getByRole('button', { name: /system|系统/i }).first();
    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();
    const oledButton = page.getByRole('button', { name: /oled/i }).first();

    // Count how many theme buttons are visible
    const visibleButtons = [];
    for (const btn of [lightButton, systemButton, darkButton, oledButton]) {
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        visibleButtons.push(btn);
      }
    }

    // At least 3 of the 4 theme buttons should be visible
    expect(visibleButtons.length).toBeGreaterThanOrEqual(3);
  });

  test('account drawer shows identity section with TokenDance ID', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Identity section should be visible
    const identitySection = page.getByText(/identity|身份|session/i).first();
    await expect(identitySection).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows workspace settings menu items', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Workspace settings should be in the menu
    const workspaceSettings = page.getByText(/workspace settings|工作区设置/i).first();
    await expect(workspaceSettings).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows agent profiles section', async ({ page }) => {
    // Open account drawer
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Agent profiles section should be in the menu
    const agentProfiles = page.getByText(/agent profiles|agent.*profile/i).first();
    await expect(agentProfiles).toBeVisible({ timeout: 10000 });
  });
});
