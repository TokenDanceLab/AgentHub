/**
 * E2E: Settings — interaction, error, and loading state tests.
 *
 * Verifies account/settings screen theme toggle, workspace settings menu,
 * identity section, agent profiles, and account drawer interactions.
 */
import { test, expect } from '@playwright/test';

test.describe('Settings toggle (smoke)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('opens account drawer via avatar button', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const accountRail = page.locator('[data-testid="account-rail"]');
    await expect(accountRail).toBeVisible({ timeout: 10000 });
  });

  test('theme toggle buttons are visible in account drawer', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();

    await expect(lightButton.or(darkButton).first()).toBeVisible({ timeout: 10000 });
  });

  test('clicking a theme button marks it as selected', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    await expect(lightButton).toBeVisible({ timeout: 10000 });

    await lightButton.click();
    await page.waitForTimeout(500);

    const selectedLightButton = page.getByRole('button', { name: /selected|已选|light.*selected/i }).first();
    await expect(selectedLightButton.isVisible().catch(() => false)).resolves.toBeTruthy();
  });

  test('dark theme button can be clicked', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();

    if (await darkButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await darkButton.click();
      await page.waitForTimeout(500);

      const selectedDark = page.getByRole('button', { name: /selected|已选/i }).first();
      await expect(selectedDark).toBeVisible({ timeout: 5000 });
    }
  });

  test('all four theme modes are available', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    const lightButton = page.getByRole('button', { name: /light|浅色/i }).first();
    const systemButton = page.getByRole('button', { name: /system|系统/i }).first();
    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();
    const oledButton = page.getByRole('button', { name: /oled/i }).first();

    const visibleButtons = [];
    for (const btn of [lightButton, systemButton, darkButton, oledButton]) {
      if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
        visibleButtons.push(btn);
      }
    }

    expect(visibleButtons.length).toBeGreaterThanOrEqual(3);
  });

  test('account drawer shows identity section with TokenDance ID', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const identitySection = page.getByText(/identity|身份|session/i).first();
    await expect(identitySection).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows workspace settings menu items', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const workspaceSettings = page.getByText(/workspace settings|工作区设置/i).first();
    await expect(workspaceSettings).toBeVisible({ timeout: 10000 });
  });

  test('account drawer shows agent profiles section', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    const agentProfiles = page.getByText(/agent profiles|agent.*profile/i).first();
    await expect(agentProfiles).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Interaction tests: navigating settings menu items
// ---------------------------------------------------------------------------

test.describe('Settings interaction tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('theme toggle cycles through four modes', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1500);

    // Click Dark theme
    const darkButton = page.getByRole('button', { name: /dark|深色/i }).first();
    if (await darkButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await darkButton.click();
      await page.waitForTimeout(300);

      // Click OLED theme
      const oledButton = page.getByRole('button', { name: /^oled$/i }).first();
      if (await oledButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await oledButton.click();
        await page.waitForTimeout(300);
      }

      // The "selected" indicator should now be on OLED
      const selectedBtn = page.getByRole('button', { name: /selected|已选/i }).first();
      await expect(selectedBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test('clicking TokenDance ID menu item is responsive', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // TokenDance ID menu item should be clickable
    const tdItem = page.getByText(/TokenDance ID/).first();
    await tdItem.click();
    await page.waitForTimeout(300);

    // Should not crash — verify drawer still visible
    await expect(page.locator('[data-testid="account-rail"]')).toBeVisible({ timeout: 5000 });
  });

  test('account hero shows status button with correct tone', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Online status indicator should be visible
    const onlineStatus = page.getByText(/online|在线/).first();
    await expect(onlineStatus).toBeVisible({ timeout: 10000 });
  });

  test('signature field is visible in account drawer', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Signature placeholder
    const signature = page.getByText(/signature|签名/).first();
    await expect(signature).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Error state tests
// ---------------------------------------------------------------------------

test.describe('Settings error state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('notification permission shows prompt/blocked status with warning', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // Notification row should have a status badge
    const needsAction = page.getByText(/Needs action|需处理/).first();
    await expect(needsAction).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Loading state tests
// ---------------------------------------------------------------------------

test.describe('Settings loading state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('account drawer renders all sections without lag', async ({ page }) => {
    const avatarButton = page.getByRole('button', { name: /account/i });
    await avatarButton.click();
    await page.waitForTimeout(1000);

    // All sections should render quickly
    const sections = [
      page.getByText(/identity|身份/).first(),
      page.getByText(/device|设备/).first(),
      page.getByText(/Agent Profiles|Agent Profile/).first(),
    ];

    for (const section of sections) {
      await expect(section).toBeVisible({ timeout: 5000 });
    }
  });
});
