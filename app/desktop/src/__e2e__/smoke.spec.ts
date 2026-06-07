import { test, expect } from '@playwright/test';

test.describe('AgentHub Desktop smoke', () => {
  test('app loads without crash', async ({ page }) => {
    await page.goto('/');
    // Wait for React to hydrate by confirming #root has child content
    const root = page.locator('#root');
    await root.waitFor({ state: 'visible' });
    // Ensure at least one child element was rendered by React
    await expect(root.locator('> *').first()).toBeAttached();
  });

  test('StatusBar is visible', async ({ page }) => {
    await page.goto('/');
    const statusBar = page.locator('[role="status"]');
    await expect(statusBar).toBeVisible();
    // StatusBar also carries aria-atomic="true" set by the component
    await expect(statusBar).toHaveAttribute('aria-atomic', 'true');
  });

  test('v4 composer is visible and has textarea', async ({ page }) => {
    await page.goto('/');
    // The textarea exists but may be disabled when the backend is offline.
    // Verify it is present in the DOM and visible.
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    // Verify the textarea has the correct initial state
    await expect(textarea).toHaveValue('');
  });

  test('agent mention button exists', async ({ page }) => {
    await page.goto('/');
    // The v4 composer renders a button that shows @Agent (or @<name>) to open the agent selector.
    const agentBtn = page.locator('button').filter({ hasText: '@' });
    await expect(agentBtn).toBeVisible();
    // The button displays the current agent or the placeholder "@Agent"
    const btnText = await agentBtn.textContent();
    expect(btnText).toMatch(/@(Agent|\w+)/);
  });

  test('v4 sidebar navigation is rendered', async ({ page }) => {
    await page.goto('/');
    // Verify shared workbench navigation is present.
    const navs = page.getByRole('navigation');
    await expect(navs.first()).toBeVisible();
    // v4 rail and conversation sidebar both expose navigation landmarks.
    await expect(navs).toHaveCount(2);
  });
});
